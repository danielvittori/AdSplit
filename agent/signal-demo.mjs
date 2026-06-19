// x402 Agent Signal demo — an ad-buying agent pays a tiny native-USDC micropayment
// on Arc, then GETs a battle's live signal to decide ad-budget allocation pre-launch.
// Speaks the real x402 wire format (402 challenge -> X-PAYMENT -> X-PAYMENT-RESPONSE).
// Pay-then-prove (native USDC, no facilitator). Run:
//   BUYER_PK=0x.. AGENT_WALLET=0x.. API_BASE=https://adsplit-arc.vercel.app node agent/signal-demo.mjs <battleId>
import { JsonRpcProvider, Wallet } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CHAIN = 5042002;
const API = process.env.API_BASE || "http://localhost:3000";
const id = process.argv[2] || "1";

const wallet = new Wallet(process.env.BUYER_PK, new JsonRpcProvider(RPC, CHAIN));

// 1) read the 402 challenge to discover the price + payTo
const ch = await fetch(`${API}/api/x402/signal/${id}`);
const req = (await ch.json()).accepts[0];
console.log(`402 challenge → ${req.maxAmountRequired} wei (0.01 USDC) to ${req.payTo} on ${req.network}`);

// 2) pay: native-USDC transfer (value = msg.value, no ERC-20 approve)
const tx = await wallet.sendTransaction({ to: req.payTo, value: BigInt(req.maxAmountRequired) });
const rc = await tx.wait(1);
console.log("paid:", rc.hash);

// 3) call again with X-PAYMENT carrying the tx hash (pay-then-prove)
const xpay = Buffer.from(JSON.stringify({
  x402Version: 1, scheme: "exact", network: req.network,
  payload: { txHash: rc.hash, payer: wallet.address },
})).toString("base64");

const res = await fetch(`${API}/api/x402/signal/${id}`, { headers: { "X-PAYMENT": xpay } });
if (!res.ok) { console.error("denied:", res.status, await res.text()); process.exit(1); }

const settle = res.headers.get("X-PAYMENT-RESPONSE");
const signal = await res.json();
console.log("X-PAYMENT-RESPONSE:", JSON.parse(Buffer.from(settle, "base64").toString()));
console.log("SIGNAL:", JSON.stringify(signal, null, 2));

// 4) act on the signal: pour budget into the leader if the gap is decisive
if (!signal.settled && signal.leader != null) {
  const lead = signal.variants[signal.leader];
  console.log(`\n→ decision: front-load budget on "${lead.label}" (${lead.pct}% of pot) before launch.`);
}
