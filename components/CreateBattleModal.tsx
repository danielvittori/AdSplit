"use client";

import { useState } from "react";

export interface NewVariant { label: string; image: string }

export default function CreateBattleModal({
  open,
  onClose,
  onCreate,
  busy,
  msg,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, variants: NewVariant[], durationSecs: number) => void;
  busy: boolean;
  msg: string;
}) {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(86400);
  const [variants, setVariants] = useState<NewVariant[]>([
    { label: "", image: "" },
    { label: "", image: "" },
  ]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [localErr, setLocalErr] = useState("");

  if (!open) return null;

  function setV(i: number, patch: Partial<NewVariant>) {
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  }

  async function upload(i: number, file: File) {
    setLocalErr("");
    if (!file.type.startsWith("image/")) return setLocalErr("Please choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setLocalErr("Image must be under 5 MB.");
    setUploading(i);
    try {
      const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "upload failed");
      setV(i, { image: data.url });
    } catch (e) {
      setLocalErr("Upload failed — paste an image URL instead. " + ((e as Error).message || ""));
    } finally {
      setUploading(null);
    }
  }

  function submit() {
    setLocalErr("");
    const t = title.trim();
    if (!t) return setLocalErr("Give the battle a name.");
    const clean = variants.map((v) => ({ label: v.label.trim(), image: v.image.trim() }));
    if (clean.some((v) => !v.label)) return setLocalErr("Every variant needs a label.");
    if (clean.some((v) => !/^https?:\/\//.test(v.image))) return setLocalErr("Every variant needs an image (upload or paste a URL).");
    onCreate(t, clean, duration);
  }

  const durations = [
    { s: 300, t: "5 min" },
    { s: 3600, t: "1 hour" },
    { s: 21600, t: "6 hours" },
    { s: 86400, t: "24 hours" },
    { s: 259200, t: "3 days" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,3,9,0.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card mix" style={{ width: "min(660px, 100%)", maxHeight: "92vh", overflow: "auto", padding: 28, background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <div className="label" style={{ color: "var(--volt)" }}>New battle</div>
            <h2 className="display" style={{ fontSize: 28, marginTop: 6 }}>Drop a creative battle</h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">✕</button>
        </div>

        <div className="label" style={{ marginBottom: 8 }}>Battle name</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="input" placeholder="Q3 dropship — hero banner" />

        <div className="label" style={{ margin: "20px 0 9px" }}>Voting window</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {durations.map((d) => (
            <button key={d.s} className="chip" data-on={duration === d.s} onClick={() => setDuration(d.s)}>{d.t}</button>
          ))}
        </div>

        <div className="label" style={{ margin: "22px 0 10px" }}>Variants ({variants.length}/4)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {variants.map((v, i) => (
            <div key={i} className="card" style={{ padding: 12, display: "flex", gap: 12, alignItems: "center", background: "var(--bg)" }}>
              <label style={{ width: 62, height: 62, borderRadius: 10, flexShrink: 0, overflow: "hidden", border: "1px dashed var(--line-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "var(--raise)", position: "relative" }}>
                {v.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{uploading === i ? "…" : "+ IMG"}</span>
                )}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && upload(i, e.target.files[0])} />
              </label>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={v.label} onChange={(e) => setV(i, { label: e.target.value })} maxLength={48} className="input" placeholder={`Variant ${String.fromCharCode(65 + i)} label`} style={{ padding: "9px 12px", fontSize: 14 }} />
                <input value={v.image} onChange={(e) => setV(i, { image: e.target.value })} className="input mono" placeholder="…or paste image URL" style={{ padding: "9px 12px", fontSize: 12.5 }} />
              </div>
              {variants.length > 2 && (
                <button onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))} className="icon-btn" style={{ width: 32, height: 32, flexShrink: 0 }} aria-label="Remove">−</button>
              )}
            </div>
          ))}
        </div>
        {variants.length < 4 && (
          <button onClick={() => setVariants((vs) => [...vs, { label: "", image: "" }])} className="btn btn--ghost btn--sm" style={{ marginTop: 12 }}>+ Add variant</button>
        )}

        {(localErr || msg) && (
          <div className="mono" style={{ fontSize: 12.5, marginTop: 16, color: msg.startsWith("✓") ? "var(--good)" : "var(--bad)" }}>{localErr || msg}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="btn btn--ghost">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn btn--volt">{busy ? "Dropping…" : "Drop the battle"}</button>
        </div>
      </div>
    </div>
  );
}
