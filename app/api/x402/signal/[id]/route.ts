import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { ARC_RPC, ARC_CHAIN_ID } from "@/lib/arcNetwork";
import { CONTRACT_ADDRESS, ADSPLIT_ABI, share } from "@/lib/adsplit";

export const runtime = "nodejs";

// ── AdSplit Agent Signal — a real x402 (HTTP 402) micropayment endpoint ──
// An ad-buying agent pays a tiny native-USDC micropayment on Arc, then GETs a
// battle's live signal (leader + per-variant split) to allocate budget pre-launch.
//
// Honest scope: Arc's USDC is the NATIVE coin (no ERC-20, no EIP-3009 gasless),
// so this is "pay-then-prove": the client transfers native USDC to the agent
// wallet and carries the tx hash in X-PAYMENT; we verify it on-chain. Genuine
// x402 wire format; self-verified, no facilitator. Replay-bounded by a freshness
// window (best-effort for a testnet demo — production needs a spend-ledger/facilitator).

const PRICE_WEI = 10_000_000_000_000_000n; // 0.01 USDC @ 18 decimals
const PAY_TO = (process.env.AGENT_WALLET || ethers.ZeroAddress).toLowerCase();
const FRESH_SECONDS = 120;
const seen = new Set<string>(); // best-effort within a warm instance

function accepts(origin: string, id: string) {
  return [{
    scheme: "exact",
    network: `eip155:${ARC_CHAIN_ID}`,
    maxAmountRequired: PRICE_WEI.toString(),
    resource: `${origin}/api/x402/signal/${id}`,
    description: "AdSplit Agent Signal — live creative-battle leader + pot split. Native USDC (18 dec) on Arc testnet; pay-then-prove (tx hash), self-verified, no facilitator.",
    mimeType: "application/json",
    outputSchema: null,
    payTo: PAY_TO === ethers.ZeroAddress.toLowerCase() ? PAY_TO : ethers.getAddress(PAY_TO),
    maxTimeoutSeconds: FRESH_SECONDS,
    asset: "0x0000000000000000000000000000000000000000",
    extra: { name: "USDC", decimals: 18, native: true },
  }];
}

function challenge(req: NextRequest, id: string, error: string) {
  return NextResponse.json({ x402Version: 1, error, accepts: accepts(req.nextUrl.origin, id) }, { status: 402 });
}

async function getSignal(id: string) {
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const c = new ethers.Contract(CONTRACT_ADDRESS, ADSPLIT_ABI, provider);
  const b = await c.getBattle(id);
  if (b.creator === ethers.ZeroAddress) return null;
  const [leadingIdx, tie, staked] = await c.leaderState(id);
  const pot = b.pot as bigint;
  const variants = [];
  for (let i = 0; i < Number(b.variantCount); i++) {
    const v = await c.getVariant(id, i);
    variants.push({ index: i, label: v.label, author: v.author, stakedWei: (staked[i] as bigint).toString(), pct: share(staked[i] as bigint, pot) });
  }
  const status = Number(b.status);
  return {
    battleId: Number(b.id),
    title: b.title,
    status: status === 2 ? "settled" : status === 3 ? "void" : (Math.floor(Date.now() / 1000) >= Number(b.deadline) ? "closing" : "open"),
    settled: status === 2,
    winner: status === 2 ? Number(b.winner) : null,
    tie: tie && pot > 0n,
    potWei: pot.toString(),
    deadline: Number(b.deadline),
    leader: pot === 0n ? null : Number(leadingIdx),
    variants,
    network: `eip155:${ARC_CHAIN_ID}`,
    source: "AdSplit on Arc — read live from the contract",
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad battle id" }, { status: 400 });
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS)) return NextResponse.json({ error: "contract not configured" }, { status: 503 });

  const hdr = req.headers.get("x-payment");
  if (!hdr) return challenge(req, id, "X-PAYMENT header is required");
  if (PAY_TO === ethers.ZeroAddress.toLowerCase()) return NextResponse.json({ error: "agent wallet not configured" }, { status: 503 });

  let txHash: string;
  try {
    const p = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
    txHash = p?.payload?.txHash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("bad txHash");
  } catch {
    return challenge(req, id, "malformed X-PAYMENT payload");
  }

  if (seen.has(txHash)) return challenge(req, id, "payment already used");

  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC);
    const [tx, rc, tip] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash), provider.getBlockNumber()]);
    const ok = tx && rc && rc.status === 1 && tx.to?.toLowerCase() === PAY_TO && tx.value >= PRICE_WEI && rc.blockNumber != null && tip - rc.blockNumber + 1 >= 1;
    if (!ok) return challenge(req, id, "invalid or unconfirmed payment");
    // freshness window — bounds replay for the demo
    const blk = await provider.getBlock(rc!.blockNumber!);
    if (!blk || Math.floor(Date.now() / 1000) - Number(blk.timestamp) > FRESH_SECONDS) {
      return challenge(req, id, "payment too old — pay again");
    }
    seen.add(txHash);

    const signal = await getSignal(id);
    if (!signal) return NextResponse.json({ error: "battle not found" }, { status: 404 });

    const settlement = { success: true, transaction: txHash, network: `eip155:${ARC_CHAIN_ID}`, payer: tx!.from };
    return NextResponse.json(signal, {
      status: 200,
      headers: { "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settlement)).toString("base64") },
    });
  } catch {
    return NextResponse.json({ error: "verification error" }, { status: 502 });
  }
}
