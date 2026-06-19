<h1 align="center">AdSplit</h1>

<p align="center"><em>The chart for ads that haven't run yet.</em></p>

<p align="center">
  <a href="https://adsplit-arc.vercel.app">Live app</a> ·
  <a href="https://testnet.arcscan.app/address/0xD72527099590782dF705283997f060EdA008cfAf">Contract on ArcScan</a> ·
  Native USDC on ARC testnet
</p>

---

## What it is

I run Google Ads for dropship/eCommerce clients. The slow part isn't making creatives — it's *waiting a week of ad spend* to learn which one converts. AdSplit turns that wait into a real-money signal you can read in hours.

A marketer opens a **battle** of 2–4 ad creatives. Viewers stake **$0.05–0.20 in native USDC** on the variant that hooks them. When the window closes, an autonomous Arc agent settles it: the variant with the most USDC staked wins, and the **whole pot goes to that creative's author** — no platform, no fee. The split you see *before* launch is the signal: back the creative the crowd already put money behind.

It's wrapped in a music-console UI — each creative is a "track" you audition, and staking feels like dropping the needle. A **battle** is the album, a **variant** is a track, and the **Split Meter** (an equalizer seek-bar) shows each variant's live share of the pot.

## How a battle works

1. **Drop a battle** — upload 2–4 creatives, set a name and a voting window (5 min – 3 days). The variants' author is you.
2. **Audition & stake** — anyone opens the battle, auditions each variant in the Now-Auditioning pane, and taps **Stake** ($0.05/0.10/0.15/0.20) on the one that hooks them. `msg.value` is the stake — no approve, one tap, sub-second on Arc.
3. **Settle** — after the deadline `settle()` is permissionless; the AdSplit keeper agent calls it automatically and pays the winning author. A tie-for-first or zero-stake battle voids and stakers reclaim their stake.

## The contract

[`AdSplit.sol`](contracts/AdSplit.sol) — one file, no imports, no owner/admin, no fee, no upgrade. It holds USDC and pays out winner-takes-all, with **pull-based** payouts (`withdraw` for winners, `refund` for voids) so a battle can never be bricked by a reverting recipient. Checks-effects-interactions throughout; `settle()` is pure accounting (no external call), so no one can block it. Reviewed adversarially before deploy — zero fund-safety findings.

| | |
|---|---|
| **Network** | ARC testnet (chain `5042002`) |
| **Address** | [`0xD72527099590782dF705283997f060EdA008cfAf`](https://testnet.arcscan.app/address/0xD72527099590782dF705283997f060EdA008cfAf) |
| **Settlement** | native USDC, winner-takes-the-pot |
| **Verified** | yes — source on ArcScan |

## Agents & x402 micropayments

AdSplit leans into Arc's agentic-payments story two ways:

- **Settle keeper** ([`agent/keeper.mjs`](agent/keeper.mjs)) — a funded Arc wallet watches deadlines and calls `settle()`, paying the winning author machine-to-person. Because `settle()` is permissionless, the agent is *convenience, not trust*: if it's down, anyone can finalize.
- **Agent Signal via x402** ([`app/api/x402/signal/[id]/route.ts`](app/api/x402/signal/%5Bid%5D/route.ts)) — an automated ad-buying agent pays a tiny native-USDC micropayment over the **x402** (HTTP `402 Payment Required`) standard to pull a battle's live signal (leader + per-variant split), then front-loads budget before the campaign even runs. Demo client: [`agent/signal-demo.mjs`](agent/signal-demo.mjs).

> **Honest scope.** The endpoint speaks the real x402 wire format (the `402`/`accepts` challenge, `X-PAYMENT`, `X-PAYMENT-RESPONSE`). But Arc's USDC is the **native** 18-decimal coin — there's no ERC-20 and no EIP-3009 gasless `exact` flow — so settlement here is **pay-then-prove**: the client transfers native USDC to the agent wallet and carries the tx hash in `X-PAYMENT`, which the route verifies on-chain (`network: eip155:5042002`, native-asset sentinel, amount `10000000000000000` wei = 0.01 USDC). It's self-verified with no facilitator, and replay is bounded by a freshness window — a faithful testnet demo, not facilitator-settled EIP-3009. Production would route through an Arc-aware x402 facilitator.

## Why ARC

Native USDC is the gas *and* the money, so $0.05 stakes are viable where mainnet gas would dwarf them — the whole premise. Sub-second finality means a stake lands and the Split Meter animates instantly. And settlement is an open call any agent can run, paying the winner directly with zero skim.

## Run it locally

```bash
npm install
npm run dev            # http://localhost:3000
```

Creative uploads use Vercel Blob (`BLOB_READ_WRITE_TOKEN`); without it the create form falls back to pasting an image URL. The agents read `AGENT_WALLET` / `AGENT_PRIVATE_KEY` from the environment (never committed).

## Built with

Next.js 16 · React 19 · ethers v6 · Solidity 0.8.35 · Tailwind v4 · Vercel Blob — on ARC.

---

<p align="center"><sub>Let the crowd settle the creative — in real money, before you spend a cent on ads.</sub></p>
