"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import SplitMeter from "@/components/SplitMeter";
import CreateBattleModal, { NewVariant } from "@/components/CreateBattleModal";
import { useWallet } from "@/lib/useWallet";
import { ARCSCAN, switchToArc } from "@/lib/arcNetwork";
import { pickProvider } from "@/lib/wallet";
import {
  CONTRACT_ADDRESS, ADSPLIT_ABI, hasContract, readContract,
  fetchStats, fetchFeed, fetchBattle, fetchBattlesOf, fetchOwed,
  fmtUsdc, shortAddr, share, timeLeft, timeAgo, isExpired,
  STAKE_CHIPS, OPEN, SETTLED, VOID,
  type Battle, type Stats, EMPTY_STATS,
} from "@/lib/adsplit";

const VC = ["var(--volt)", "var(--magenta)", "var(--cyan)", "#f59e0b"];

function Icon({ n, s = 20 }: { n: string; s?: number }) {
  const p: Record<string, React.ReactNode> = {
    home: <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
    explore: <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4-4M11 7l1.5 3.5L16 12l-3.5 1.5L11 17l-1.5-3.5L6 12l3.5-1.5z" /></>,
    library: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    bell: <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 01-4 0v-.1A1.6 1.6 0 007 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 14.6H3a2 2 0 010-4h.1A1.6 1.6 0 004.6 7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V3a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 2.4z" /></>,
    heart: <path d="M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0012 5 4.5 4.5 0 002 8.5c0 2.2 1.5 4 3 5.5l7 7z" />,
    download: <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />,
    more: <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>,
    prev: <path d="M19 20L9 12l10-8zM5 19V5" />,
    next: <path d="M5 4l10 8-10 8zM19 5v14" />,
    shuffle: <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
    repeat: <path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />,
    plus: <path d="M12 5v14M5 12h14" />,
    coin: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h3.5a1.5 1.5 0 010 3h-2a1.5 1.5 0 000 3H15" /></>,
    trophy: <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0zM7 4H4v2a3 3 0 003 3M17 4h3v2a3 3 0 01-3 3" />,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[n]}</svg>;
}

function Cover({ b, size = "100%", radius = 12 }: { b: Battle; size?: number | string; radius?: number }) {
  const imgs = b.variants.slice(0, 4);
  const grid = imgs.length >= 4 ? "1fr 1fr" : imgs.length === 3 ? "1fr 1fr" : "1fr";
  return (
    <div style={{ width: size, aspectRatio: "1", borderRadius: radius, overflow: "hidden", display: "grid", gridTemplateColumns: grid, gridAutoRows: "1fr", background: "var(--raise)", border: "1px solid var(--line)" }}>
      {imgs.map((v, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={v.image} alt={v.label} style={{ width: "100%", height: "100%", objectFit: "cover", gridColumn: imgs.length === 3 && i === 0 ? "1 / -1" : undefined }} />
      ))}
    </div>
  );
}

export default function Home() {
  const { account, balance, chainOk, connecting, connect, disconnect, refreshBalance } = useWallet();

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [feed, setFeed] = useState<Battle[]>([]);
  const [mine, setMine] = useState<Battle[]>([]);
  const [owed, setOwed] = useState<bigint>(0n);
  const [nav, setNav] = useState<"stage" | "explore" | "library">("stage");
  const [sel, setSel] = useState<Battle | null>(null);
  const [aud, setAud] = useState(0);
  const [chip, setChip] = useState("0.10");
  const [createOpen, setCreateOpen] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);

  const epoch = useRef(0);
  const accountRef = useRef(account);
  const inFlight = useRef(false);
  useEffect(() => { accountRef.current = account; }, [account]);

  const load = useCallback(async () => {
    if (!hasContract()) return;
    const e = ++epoch.current;
    try {
      const c = readContract();
      const [s, f] = await Promise.all([fetchStats(c), fetchFeed(24, c)]);
      if (e !== epoch.current) return;
      setStats(s); setFeed(f);
      if (account) {
        const [created, ow] = await Promise.all([fetchBattlesOf(account, "created", c), fetchOwed(account, c)]);
        if (e !== epoch.current) return;
        setMine(created); setOwed(ow);
      } else { setMine([]); setOwed(0n); }
    } catch { /* keep last good */ }
  }, [account]);

  useEffect(() => { load(); }, [load]);

  // keep the selected battle fresh after reloads
  useEffect(() => {
    if (!sel) return;
    const fromFeed = feed.find((b) => b.id === sel.id) || mine.find((b) => b.id === sel.id);
    if (fromFeed) setSel(fromFeed);
  }, [feed, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openBattle(id: number) {
    const local = feed.find((b) => b.id === id) || mine.find((b) => b.id === id);
    if (local) { setSel(local); setAud(0); }
    const fresh = await fetchBattle(id);
    if (fresh) { setSel(fresh); }
  }

  async function writeC() {
    const inj = pickProvider();
    if (!inj) throw new Error("No wallet found");
    await switchToArc(inj);
    const provider = new ethers.BrowserProvider(inj);
    const signer = await provider.getSigner(account);
    return new ethers.Contract(CONTRACT_ADDRESS, ADSPLIT_ABI, signer);
  }
  function reason(e: unknown): string {
    const err = e as { code?: string | number; reason?: string; shortMessage?: string; message?: string };
    if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Cancelled";
    return (err?.reason || err?.shortMessage || err?.message || "Failed").slice(0, 90);
  }
  function flash(t: string) { setToast(t); setTimeout(() => setToast(""), 3600); }

  async function run(key: string, fn: (c: ethers.Contract) => Promise<ethers.ContractTransactionResponse>, done: string): Promise<boolean> {
    if (!account) { if (!pickProvider()) { flash("✗ No wallet — install Rabby or MetaMask"); return false; } connect(); return false; }
    if (inFlight.current) return false;
    inFlight.current = true; const cap = account; setBusy(key); flash("Confirm in your wallet…");
    let ok = false;
    try {
      const c = await writeC(); const tx = await fn(c); flash("Settling on ARC…"); await tx.wait();
      if (accountRef.current !== cap) return false;
      flash(done); await load(); await refreshBalance(cap);
      if (sel) { const fresh = await fetchBattle(sel.id); if (fresh) setSel(fresh); }
      ok = true;
    } catch (e) { flash("✗ " + reason(e)); } finally { inFlight.current = false; setBusy(null); }
    return ok;
  }

  const doStake = (id: number, v: number) => run("stake", (c) => c.stake(id, v, { value: ethers.parseEther(chip) }), `✓ Staked $${chip} — split updated`);
  const doSettle = (id: number) => run("settle", (c) => c.settle(id), "✓ Settled — pot routed to the winner");
  const doWithdraw = () => run("withdraw", (c) => c.withdraw(), "✓ Withdrawn to your wallet");
  async function doCreate(title: string, vs: NewVariant[], dur: number) {
    const ok = await run("create", (c) => c.createBattle(title, vs.map((v) => v.label), vs.map((v) => v.image), dur), "✓ Battle is live");
    if (ok) { setCreateOpen(false); setCreateMsg(""); }
    else setCreateMsg("✗ Could not create — check the fields and try again");
  }

  const featured = sel ?? feed[0] ?? null;
  const fv = featured?.variants ?? [];
  const audIdx = Math.min(aud, Math.max(0, fv.length - 1));
  const audV = fv[audIdx];
  const staked = fv.map((v) => v.staked);
  const list = (nav === "library" ? mine : feed).filter((b) => !search || b.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="shell">
      {/* ── sidebar ── */}
      <aside className="pane pane--side pane--scroll sidebar">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="5" y="13" width="5" height="16" rx="2.5" fill="#8b5cf6" /><rect x="13.5" y="4" width="5" height="25" rx="2.5" fill="#f0379b" /><rect x="22" y="9" width="5" height="20" rx="2.5" fill="#22d3ee" />
          </svg>
          <span className="display" style={{ fontSize: 21 }}>AdSplit</span>
        </div>
        <button className="nav-item" data-on={nav === "stage" && !sel} onClick={() => { setNav("stage"); setSel(null); }}><Icon n="home" /> Stage</button>
        <button className="nav-item" data-on={nav === "explore" && !sel} onClick={() => { setNav("explore"); setSel(null); }}><Icon n="explore" /> Explore</button>
        <button className="nav-item" data-on={nav === "library" && !sel} onClick={() => { setNav("library"); setSel(null); }}><Icon n="library" /> My Rack</button>

        <div className="side-head"><span className="label">Your battles</span><button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setCreateOpen(true)} aria-label="New battle"><Icon n="plus" s={15} /></button></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mine.length === 0 && <div style={{ padding: "6px 11px", fontSize: 12.5, color: "var(--faint)" }}>Drop a battle to test your creatives.</div>}
          {mine.map((b) => (
            <button key={b.id} className="bat-item" onClick={() => openBattle(b.id)}>
              <Cover b={b} size={38} radius={8} />
              <div style={{ minWidth: 0, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title}</div>
                <div className="mono" style={{ fontSize: 11, color: b.status === OPEN ? "var(--cyan)" : "var(--mute)" }}>{b.status === SETTLED ? "settled" : b.status === VOID ? "void" : isExpired(b) ? "closing" : timeLeft(b.deadline)}</div>
              </div>
            </button>
          ))}
        </div>

        {owed > 0n && (
          <button onClick={doWithdraw} disabled={!!busy} className="btn btn--lime btn--sm" style={{ margin: "14px 6px 0" }}>
            <Icon n="coin" s={16} /> Withdraw ${fmtUsdc(owed)}
          </button>
        )}
      </aside>

      {/* ── center ── */}
      <main className="pane">
        <div className="topbar">
          <div className="search"><Icon n="explore" s={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search battles…" /></div>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" aria-label="Activity"><Icon n="bell" s={18} /></button>
          <button onClick={() => setCreateOpen(true)} className="btn btn--volt btn--sm"><Icon n="plus" s={15} /> New battle</button>
          {account ? (
            <div style={{ position: "relative" }}>
              <button onClick={() => setWalletOpen((o) => !o)} className="btn btn--ghost btn--sm"><span className="dot" style={{ background: chainOk ? "var(--good)" : "var(--bad)" }} /><span className="mono">{shortAddr(account, 4, 4)}</span></button>
              {walletOpen && (<>
                <div onClick={() => setWalletOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div className="card" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 61, minWidth: 230, background: "var(--surface)", overflow: "hidden" }}>
                  <div style={{ padding: "13px 15px" }}><div className="label">Wallet</div><div className="mono" style={{ fontSize: 13.5, marginTop: 5 }}>{shortAddr(account, 9, 6)}</div><div className="mono pot-text" style={{ fontSize: 12, marginTop: 5 }}>{balance || "0"} USDC</div></div>
                  {!chainOk && <button className="console-line" style={{ color: "var(--bad)" }} onClick={() => switchToArc().catch(() => {})}>Switch to ARC ↗</button>}
                  <a className="console-line" href={`${ARCSCAN}/address/${account}`} target="_blank" rel="noopener noreferrer">View on ArcScan ↗</a>
                  <button className="console-line danger" onClick={() => { setWalletOpen(false); disconnect(); }}>Disconnect</button>
                </div>
              </>)}
            </div>
          ) : (
            <button onClick={connect} disabled={connecting} className="btn btn--ghost btn--sm">{connecting ? "…" : "Connect wallet"}</button>
          )}
        </div>

        <div className="pane--scroll" style={{ flex: 1, padding: 26 }}>
          {!hasContract() && (
            <div className="card" style={{ padding: "12px 16px", marginBottom: 20, color: "var(--bad)", fontSize: 13.5 }}>Contract not deployed yet — deploy it from <a href="/deploy" style={{ color: "var(--volt)", fontWeight: 600 }}>/deploy</a>.</div>
          )}

          {sel ? (
            /* ── battle album view ── */
            <div className="mix">
              <div style={{ display: "flex", gap: 24, alignItems: "flex-end", marginBottom: 26, flexWrap: "wrap" }}>
                <div style={{ width: 200, flexShrink: 0 }}><Cover b={sel} size={200} radius={16} /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="label">Creative battle · {sel.variantCount} variants</div>
                  <h1 className="display" style={{ fontSize: "clamp(30px, 4vw, 52px)", margin: "8px 0 12px" }}>{sel.title}</h1>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="pill pill--pot"><Icon n="coin" s={13} /> ${fmtUsdc(sel.pot)} pot</span>
                    {sel.status === OPEN && !isExpired(sel) && <span className="pill pill--live"><span className="dot" style={{ background: "var(--cyan)" }} /> {timeLeft(sel.deadline)} left</span>}
                    {sel.status === OPEN && isExpired(sel) && <span className="pill">Voting closed</span>}
                    {sel.status === SETTLED && <span className="pill pill--pot"><Icon n="trophy" s={13} /> Settled</span>}
                    {sel.status === VOID && <span className="pill">No contest — refundable</span>}
                    <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>by {shortAddr(sel.creator)} · {timeAgo(sel.createdAt)}</span>
                  </div>
                </div>
              </div>

              {sel.status === OPEN && isExpired(sel) && (
                <div className="card" style={{ padding: "14px 18px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, color: "var(--mute)" }}>The window closed. The AdSplit agent settles automatically — or finalize it now.</span>
                  <button onClick={() => doSettle(sel.id)} disabled={!!busy} className="btn btn--lime btn--sm"><Icon n="coin" s={15} /> Settle now</button>
                </div>
              )}

              {sel.status === OPEN && !isExpired(sel) && fv[audIdx] && (
                <div className="card" style={{ padding: 16, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", background: "var(--bg)" }}>
                  <div style={{ fontSize: 14, color: "var(--mute)" }}>Stake on <b style={{ color: "var(--ink)" }}>{fv[audIdx].label}</b> <span style={{ color: "var(--faint)", fontSize: 13 }}>· tap a row to switch</span></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {STAKE_CHIPS.map((c) => <button key={c} className="chip" data-on={chip === c} onClick={() => setChip(c)}>${c}</button>)}
                    <button onClick={() => doStake(sel.id, audIdx)} disabled={!!busy} className="btn btn--lime btn--sm"><Icon n="coin" s={16} /> {busy === "stake" ? "Staking…" : `Stake $${chip}`}</button>
                  </div>
                </div>
              )}

              <div className="trackhead label"><span>#</span><span>Variant</span><span>Author</span><span style={{ textAlign: "right" }}>Split</span></div>
              {sel.variants.map((v, i) => {
                const sh = share(v.staked, sel.pot);
                const win = sel.status === SETTLED && sel.winner === i;
                return (
                  <button key={i} className="track" data-on={audIdx === i} onClick={() => setAud(i)} style={{ width: "100%", textAlign: "left" }}>
                    <span className="mono" style={{ color: win ? "var(--pot)" : "var(--mute)", display: "flex", alignItems: "center", gap: 4 }}>{win ? <Icon n="trophy" s={15} /> : i + 1}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.image} alt="" className="track-thumb" />
                      <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.label}</span><span className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>{v.backers} backer{v.backers === 1 ? "" : "s"} · ${fmtUsdc(v.staked)}</span></span>
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>{shortAddr(v.author, 4, 4)}</span>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                      <span style={{ width: 56 }}><SplitMeter staked={[v.staked, sel.pot - v.staked]} pot={sel.pot} bars={10} variant="mini" /></span>
                      <span className="mono" style={{ width: 38, textAlign: "right", color: win ? "var(--pot)" : "var(--ink)" }}>{sh}%</span>
                    </span>
                  </button>
                );
              })}

              {/* Agent Signal · x402 — agentic micropayment surface */}
              <div className="card" style={{ marginTop: 26, padding: 18, background: "var(--bg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="pill" style={{ borderColor: "rgba(139,92,246,0.4)", color: "var(--volt)" }}>Agent Signal · x402</span>
                    <span className="pill pill--pot">0.01 USDC / call</span>
                    {sel.status === SETTLED && <span className="pill pill--pot"><Icon n="trophy" s={12} /> Auto-settled by agent</span>}
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => { const u = `${window.location.origin}/api/x402/signal/${sel.id}`; navigator.clipboard?.writeText(`curl -i ${u}`); flash("✓ curl copied"); }}>Copy curl</button>
                </div>
                <div className="mono" style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 12 }}>GET /api/x402/signal/{sel.id}</div>
                <p style={{ fontSize: 13, color: "var(--mute)", lineHeight: 1.55, marginTop: 8 }}>An ad-buying agent pays a native-USDC micropayment over the x402 (HTTP 402) standard to pull this battle&apos;s live leader + pot split, then front-loads budget before the campaign even runs.</p>
                <div className="mono" style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>Arc testnet · native USDC (18 dec) · eip155:5042002 · self-verified pay-then-prove, no facilitator</div>
              </div>
            </div>
          ) : (
            /* ── stage / explore / library feed ── */
            <div className="mix">
              <h1 className="display" style={{ fontSize: 34, marginBottom: 4 }}>{nav === "library" ? "My Rack" : nav === "explore" ? "Explore" : "Stage"}</h1>
              <p style={{ color: "var(--mute)", fontSize: 14.5, marginBottom: 22 }}>
                {nav === "library" ? "Battles you've created." : "Live creative battles — stake on the one that hooks you. The best creative takes the whole USDC pot."}
              </p>
              {list.length === 0 ? (
                <div className="card" style={{ padding: 50, textAlign: "center", color: "var(--mute)" }}>{hasContract() ? "No battles yet — drop the first one." : "Deploy the contract to begin."}</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                  {list.map((b) => (
                    <div key={b.id} className="card card--hover" style={{ padding: 14 }} onClick={() => openBattle(b.id)}>
                      <Cover b={b} radius={12} />
                      <div className="display" style={{ fontSize: 17, marginTop: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 10px" }}>
                        <span className="mono pot-text" style={{ fontSize: 13 }}>${fmtUsdc(b.pot)}</span>
                        <span className="mono" style={{ fontSize: 11.5, color: b.status === OPEN && !isExpired(b) ? "var(--cyan)" : "var(--mute)" }}>{b.status === SETTLED ? "settled" : b.status === VOID ? "void" : isExpired(b) ? "closing" : timeLeft(b.deadline)}</span>
                      </div>
                      <SplitMeter staked={b.variants.map((v) => v.staked)} pot={b.pot} bars={20} variant="mini" live={b.status === OPEN && !isExpired(b)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── now auditioning ── */}
      <aside className="pane pane--now">
        {featured && audV ? (
          <div className="pane--scroll pane-pad" style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
            <div className="label">Now auditioning</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={audV.image} alt={audV.label} className="cover" />
            <div>
              <div className="display" style={{ fontSize: 22 }}>{audV.label}</div>
              <div className="mono" style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 4 }}>
                <span style={{ color: VC[audIdx % VC.length] }}>●</span> {featured.title} · by {shortAddr(audV.author, 4, 4)}
              </div>
            </div>

            <SplitMeter staked={staked} pot={featured.pot} live={featured.status === OPEN && !isExpired(featured)} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 12.5, color: VC[audIdx % VC.length] }}>${fmtUsdc(audV.staked)} on this</span>
              <span className="mono" style={{ fontSize: 12.5, color: "var(--mute)" }}>${fmtUsdc(featured.pot)} pot · {share(audV.staked, featured.pot)}%</span>
            </div>

            <div className="transport">
              <button className="tp-btn" aria-label="Shuffle"><Icon n="shuffle" s={17} /></button>
              <button className="tp-btn" onClick={() => setAud((audIdx - 1 + fv.length) % fv.length)} aria-label="Previous"><Icon n="prev" s={20} /></button>
              <button className="stake-btn" disabled={!!busy || featured.status !== OPEN || isExpired(featured)} onClick={() => doStake(featured.id, audIdx)} aria-label="Stake" title="Stake on this variant">
                {busy === "stake" ? <span className="mono" style={{ fontSize: 12 }}>…</span> : <Icon n="coin" s={26} />}
              </button>
              <button className="tp-btn" onClick={() => setAud((audIdx + 1) % fv.length)} aria-label="Next"><Icon n="next" s={20} /></button>
              <button className="tp-btn" aria-label="Re-back"><Icon n="repeat" s={17} /></button>
            </div>

            {featured.status === OPEN && !isExpired(featured) ? (
              <>
                <div style={{ display: "flex", gap: 7, justifyContent: "center" }}>
                  {STAKE_CHIPS.map((c) => <button key={c} className="chip" data-on={chip === c} onClick={() => setChip(c)}>${c}</button>)}
                </div>
                <button onClick={() => doStake(featured.id, audIdx)} disabled={!!busy} className="btn btn--lime btn--block"><Icon n="coin" s={17} /> Stake ${chip} on {audV.label.slice(0, 18)}</button>
              </>
            ) : (
              <div className="card" style={{ padding: "14px 16px", textAlign: "center", fontSize: 13.5, color: "var(--mute)" }}>
                {featured.status === SETTLED ? <>Winner: <b className="pot-text">{fv[featured.winner]?.label}</b> took ${fmtUsdc(0n)}</> : isExpired(featured) ? "Voting closed — awaiting settle." : "Voting closed."}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 8 }}>
              <button className="icon-btn" aria-label="Back it"><Icon n="heart" s={18} /></button>
              <button className="icon-btn" aria-label="Save"><Icon n="download" s={18} /></button>
              <a className="icon-btn" href={hasContract() ? `${ARCSCAN}/address/${CONTRACT_ADDRESS}` : "#"} target="_blank" rel="noopener noreferrer" aria-label="More"><Icon n="more" s={18} /></a>
            </div>
          </div>
        ) : (
          <div className="pane-pad" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", color: "var(--mute)", gap: 14 }}>
            <svg width="40" height="40" viewBox="0 0 32 32" fill="none"><rect x="5" y="13" width="5" height="16" rx="2.5" fill="#8b5cf6" /><rect x="13.5" y="4" width="5" height="25" rx="2.5" fill="#f0379b" /><rect x="22" y="9" width="5" height="20" rx="2.5" fill="#22d3ee" /></svg>
            <div className="display" style={{ fontSize: 19, color: "var(--ink)" }}>Pick a battle</div>
            <div style={{ fontSize: 13.5, maxWidth: 220 }}>Open a creative battle and audition each variant here — then stake the one that hooks you.</div>
          </div>
        )}
      </aside>

      {toast && <div className="card mono mix" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 300, padding: "11px 18px", fontSize: 13, background: "var(--raise)", color: toast.startsWith("✓") ? "var(--good)" : toast.startsWith("✗") ? "var(--bad)" : "var(--ink)" }}>{toast}</div>}

      <CreateBattleModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={doCreate} busy={busy === "create"} msg={createMsg} />
    </div>
  );
}
