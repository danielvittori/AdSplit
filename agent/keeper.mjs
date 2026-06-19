// AdSplit autonomous settle keeper.
// Watches open battles; once a battle's deadline passes, calls settle() so the
// winning creative's author is paid machine-to-person — no human, no custody.
// settle() is permissionless, so this agent is convenience, not a trust anchor:
// if it's down, anyone can finalize. Run: AGENT_PRIVATE_KEY=0x.. CONTRACT=0x.. node agent/keeper.mjs
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CHAIN = 5042002;
const CONTRACT = process.env.CONTRACT;
const PK = process.env.AGENT_PRIVATE_KEY;
const POLL_MS = Number(process.env.POLL_MS || 30000);

if (!CONTRACT || !PK) { console.error("set CONTRACT and AGENT_PRIVATE_KEY"); process.exit(1); }

const ABI = [
  "function battleCount() view returns (uint256)",
  "function getBattle(uint256) view returns (tuple(uint256 id,address creator,string title,uint64 deadline,uint64 createdAt,uint256 pot,uint8 variantCount,uint8 status,uint8 winner))",
  "function settle(uint256 id)",
  "event Settled(uint256 indexed id, uint8 winner, address indexed author, uint256 amount, address settledBy)",
];

const wallet = new Wallet(PK, new JsonRpcProvider(RPC, CHAIN));
const c = new Contract(CONTRACT, ABI, wallet);
console.log(`AdSplit keeper · agent ${wallet.address} · contract ${CONTRACT}`);

async function tick() {
  try {
    const n = Number(await c.battleCount());
    const now = Math.floor(Date.now() / 1000);
    for (let id = 1; id <= n; id++) {
      const b = await c.getBattle(id);
      if (Number(b.status) === 1 && now >= Number(b.deadline)) {
        process.stdout.write(`settling battle ${id} ("${b.title}")… `);
        try {
          const tx = await c.settle(id);
          await tx.wait();
          console.log("✓", tx.hash);
        } catch (e) { console.log("skip:", e.shortMessage || e.message); }
      }
    }
  } catch (e) { console.error("tick error:", e.message); }
}

await tick();
setInterval(tick, POLL_MS);
