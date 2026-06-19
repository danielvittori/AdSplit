import { ethers } from "ethers";
import { ARC_RPC } from "./arcNetwork";

// ─────────────────────────────────────────────────────────────
// AdSplit — creative battles settled in native USDC.
// One deployed contract; the single source of truth.
// ─────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS = "0xD72527099590782dF705283997f060EdA008cfAf";

export const ADSPLIT_ABI = [
  "function createBattle(string title, string[] labels, string[] images, uint64 durationSecs) returns (uint256)",
  "function stake(uint256 id, uint8 variant) payable",
  "function settle(uint256 id)",
  "function withdraw()",
  "function refund(uint256 id, uint8 variant)",
  "function cancelBattle(uint256 id)",
  "function battleCount() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function totalPaid() view returns (uint256)",
  "function settledCount() view returns (uint256)",
  "function owed(address) view returns (uint256)",
  "function myStake(uint256, uint8, address) view returns (uint256)",
  "function getBattle(uint256) view returns (tuple(uint256 id, address creator, string title, uint64 deadline, uint64 createdAt, uint256 pot, uint8 variantCount, uint8 status, uint8 winner))",
  "function getVariant(uint256, uint8) view returns (tuple(address author, string label, string image, uint256 staked, uint32 backers))",
  "function leaderState(uint256) view returns (uint8 leadingIdx, bool tie, uint256[] staked)",
  "function createdOf(address) view returns (uint256[])",
  "function backedOf(address) view returns (uint256[])",
  "event BattleCreated(uint256 indexed id, address indexed creator, string title, uint8 variantCount, uint64 deadline)",
  "event Staked(uint256 indexed id, uint8 indexed variant, address indexed backer, uint256 amount, uint256 newPot)",
  "event Settled(uint256 indexed id, uint8 winner, address indexed author, uint256 amount, address settledBy)",
  "event Voided(uint256 indexed id)",
];

export const OPEN = 1;
export const SETTLED = 2;
export const VOID = 3;

export const MIN_STAKE = ethers.parseEther("0.05");
export const MAX_STAKE = ethers.parseEther("1");
export const STAKE_CHIPS = ["0.05", "0.10", "0.15", "0.20"];
export const MAX_VARIANTS = 4;
export const MAX = 60; // read window

export interface Variant {
  author: string;
  label: string;
  image: string;
  staked: bigint;
  backers: number;
}

export interface Battle {
  id: number;
  creator: string;
  title: string;
  deadline: number;
  createdAt: number;
  pot: bigint;
  variantCount: number;
  status: number;
  winner: number;
  variants: Variant[];
}

export interface Stats {
  battles: number;
  staked: bigint;
  paid: bigint;
  settled: number;
}

export const EMPTY_STATS: Stats = { battles: 0, staked: 0n, paid: 0n, settled: 0 };

// ── connection ───────────────────────────────────────────────
export function readProvider() {
  return new ethers.JsonRpcProvider(ARC_RPC);
}
export function readContract(provider?: ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS, ADSPLIT_ABI, provider ?? readProvider());
}
export function hasContract(): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const failed: T[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const settled = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    settled.forEach((s, j) => (s.status === "fulfilled" ? out.push(s.value) : failed.push(items.slice(i, i + limit)[j])));
  }
  const still: T[] = [];
  for (let i = 0; i < failed.length; i += limit) {
    const settled = await Promise.allSettled(failed.slice(i, i + limit).map(fn));
    settled.forEach((s, j) => (s.status === "fulfilled" ? out.push(s.value) : still.push(failed.slice(i, i + limit)[j])));
  }
  if (still.length) console.warn(`adsplit: ${still.length} read(s) failed after retry`);
  return out;
}

type RawVariant = { author: string; label: string; image: string; staked: bigint; backers: bigint };
type RawBattle = {
  id: bigint; creator: string; title: string; deadline: bigint; createdAt: bigint;
  pot: bigint; variantCount: bigint; status: bigint; winner: bigint;
};

function toVariant(v: RawVariant): Variant {
  return { author: v.author, label: v.label, image: v.image, staked: v.staked, backers: Number(v.backers) };
}

export async function fetchBattle(id: number, contract?: ethers.Contract): Promise<Battle | null> {
  const c = contract ?? readContract();
  try {
    const b: RawBattle = await c.getBattle(id);
    if (b.creator === ethers.ZeroAddress) return null;
    const count = Number(b.variantCount);
    // ≤4 variants — read them in index order so v[i] is variant i
    const variants = await Promise.all(
      Array.from({ length: count }, (_, i) => c.getVariant(id, i).then(toVariant)),
    );
    return {
      id: Number(b.id), creator: b.creator, title: b.title,
      deadline: Number(b.deadline), createdAt: Number(b.createdAt),
      pot: b.pot, variantCount: count, status: Number(b.status), winner: Number(b.winner),
      variants,
    };
  } catch {
    return null;
  }
}

export async function fetchStats(contract?: ethers.Contract): Promise<Stats> {
  const c = contract ?? readContract();
  const [battles, staked, paid, settled] = await Promise.all([
    c.battleCount(), c.totalStaked(), c.totalPaid(), c.settledCount(),
  ]);
  return { battles: Number(battles), staked, paid, settled: Number(settled) };
}

/** Latest battles (descending id), capped. */
export async function fetchFeed(count: number, contract?: ethers.Contract): Promise<Battle[]> {
  const c = contract ?? readContract();
  const total = Number(await c.battleCount());
  if (total === 0) return [];
  const ids: number[] = [];
  for (let i = total; i >= 1 && ids.length < count; i--) ids.push(i);
  const out = await mapLimit(ids, 6, (id) => fetchBattle(id, c));
  return out.filter((b): b is Battle => !!b).sort((a, b) => b.id - a.id);
}

export async function fetchBattlesOf(addr: string, which: "created" | "backed", contract?: ethers.Contract): Promise<Battle[]> {
  const c = contract ?? readContract();
  const ids: bigint[] = which === "created" ? await c.createdOf(addr) : await c.backedOf(addr);
  const out = await mapLimit(ids.slice(-MAX).map(Number), 6, (id) => fetchBattle(id, c));
  return out.filter((b): b is Battle => !!b).sort((a, b) => b.id - a.id);
}

export async function fetchOwed(addr: string, contract?: ethers.Contract): Promise<bigint> {
  const c = contract ?? readContract();
  return await c.owed(addr);
}

// ── formatting / helpers ─────────────────────────────────────
export function shortAddr(addr: string, lead = 6, tail = 4): string {
  if (!addr) return "";
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function fmtUsdc(wei: bigint, dp = 2): string {
  const n = parseFloat(ethers.formatEther(wei));
  if (n === 0) return "0";
  if (n < 0.01) {
    const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return s === "0" ? "<0.01" : s;
  }
  const s = n.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Share of the pot a variant holds, 0-100 (rounded). */
export function share(staked: bigint, pot: bigint): number {
  if (pot === 0n) return 0;
  return Math.round(Number((staked * 10000n) / pot) / 100);
}

export function isOpen(b: Battle): boolean {
  return b.status === OPEN && Math.floor(Date.now() / 1000) < b.deadline;
}
export function isExpired(b: Battle): boolean {
  return b.status === OPEN && Math.floor(Date.now() / 1000) >= b.deadline;
}

export function timeLeft(deadline: number): string {
  let diff = deadline - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "closed";
  const d = Math.floor(diff / 86400); diff -= d * 86400;
  const h = Math.floor(diff / 3600); diff -= h * 3600;
  const m = Math.floor(diff / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = diff - m * 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
