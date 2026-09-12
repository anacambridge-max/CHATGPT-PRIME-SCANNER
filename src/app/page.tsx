"use client";

import { useMemo, useState } from "react";

type Result = {
  symbol: string; price: number; state: string; direction: string; score: number; maxScore: number;
  yh: number | null; yl: number | null; ema20: number | null; vwap: number | null; rvol: number;
  atr14: number | null; rr: number | null; volumeStars: number; nr4: boolean; nr7: boolean;
  breakout: boolean; retest: boolean; fnoConfirm: boolean; oiConfirm: boolean;
  entry: number | null; stop: number | null; target: number | null; reasons: string[];
};

const money = (v: number | null) => v == null || !Number.isFinite(v) ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function Home() {
  const [rows, setRows] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("ALL");
  const [selected, setSelected] = useState<Result | null>(null);
  const [limit, setLimit] = useState(40);

  async function scan() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/scan?limit=${limit}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Scan failed");
      setRows(data.results || []);
      if (data.errors?.length) console.warn("Scanner warnings", data.errors);
    } catch (e) { setError(e instanceof Error ? e.message : "Scan failed"); }
    finally { setBusy(false); }
  }

  const filtered = useMemo(() => rows.filter(r =>
    (state === "ALL" || r.state === state) && r.symbol.toLowerCase().includes(query.toLowerCase())
  ), [rows, state, query]);

  const counts = useMemo(() => ({
    confirmed: rows.filter(r => r.state === "CONFIRMED").length,
    setup: rows.filter(r => r.state === "SETUP").length,
    watch: rows.filter(r => r.state === "WATCH").length,
  }), [rows]);

  return <main className="shell">
    <header className="topbar">
      <div><div className="brand"><span className="mark">P</span> PRIME <span className="muted">SCANNER</span></div><div className="subtitle">F&O technical intelligence · Upstox read-only market data</div></div>
      <div className="status"><span className="dot" /> ANALYTICS TOKEN MODE</div>
    </header>

    <section className="hero">
      <div><div className="eyebrow">PRIME ENGINE V1</div><h1>Find the strongest setups.</h1><p>1-minute candles · YH/YL · EMA20 · VWAP · RVOL · NR4/NR7 · ATR · F&O/OI confirmation</p></div>
      <button className="scan" onClick={scan} disabled={busy}>{busy ? "SCANNING 1M…" : "SCAN F&O UNIVERSE"}</button>
    </section>

    <section className="stats">
      <div className="stat"><span>SCANNED</span><b>{rows.length}</b></div><div className="stat hot"><span>CONFIRMED</span><b>{counts.confirmed}</b></div><div className="stat"><span>SETUPS</span><b>{counts.setup}</b></div><div className="stat"><span>WATCH</span><b>{counts.watch}</b></div>
    </section>

    <section className="toolbar">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search symbol…" />
      <select value={state} onChange={e => setState(e.target.value)}><option value="ALL">All states</option><option value="CONFIRMED">Confirmed</option><option value="SETUP">Setup</option><option value="WATCH">Watch</option><option value="NO_TRADE">No trade</option></select>
      <select value={limit} onChange={e => setLimit(Number(e.target.value))}><option value="20">20 stocks</option><option value="40">40 stocks</option><option value="60">60 stocks</option><option value="80">80 stocks</option></select>
    </section>

    {error && <div className="error">{error}<span>Check UPSTOX_ANALYTICS_TOKEN in Vercel Environment Variables.</span></div>}

    <section className="tablewrap">
      <table><thead><tr><th>RANK</th><th>SYMBOL</th><th>STATE</th><th>SCORE</th><th>DIRECTION</th><th>LTP</th><th>RVOL</th><th>EMA20</th><th>VWAP</th><th>YH</th><th>YL</th><th>F&O</th><th>OI</th></tr></thead>
      <tbody>{filtered.map((r, i) => <tr key={r.symbol} onClick={() => setSelected(r)}><td>{i + 1}</td><td className="symbol">{r.symbol}</td><td><span className={`badge ${r.state.toLowerCase()}`}>{r.state}</span></td><td className="score">{r.score}/{r.maxScore}</td><td className={r.direction === "LONG" ? "long" : r.direction === "SHORT" ? "short" : ""}>{r.direction}</td><td>{money(r.price)}</td><td>{r.rvol.toFixed(1)}x {"★".repeat(r.volumeStars)}</td><td>{money(r.ema20)}</td><td>{money(r.vwap)}</td><td>{money(r.yh)}</td><td>{money(r.yl)}</td><td>{r.fnoConfirm ? "✓" : "—"}</td><td>{r.oiConfirm ? "✓" : "—"}</td></tr>)}</tbody></table>
      {!busy && !filtered.length && <div className="empty">Press <b>SCAN F&O UNIVERSE</b> to load live Upstox 1-minute data.</div>}
      {busy && <div className="empty">Fetching 1-minute candles and calculating PRIME conditions…</div>}
    </section>

    <footer>READ-ONLY · No order placement · No OAuth redirect · Token stays server-side · 1-minute scanner</footer>

    {selected && <div className="overlay" onClick={() => setSelected(null)}><aside className="drawer" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelected(null)}>×</button><div className="eyebrow">PRIME DETAIL · 1M</div><h2>{selected.symbol}</h2><div className="bigscore">{selected.score}<small>/{selected.maxScore}</small></div><span className={`badge ${selected.state.toLowerCase()}`}>{selected.state}</span><div className="detailgrid"><div><small>LTP</small><b>{money(selected.price)}</b></div><div><small>DIRECTION</small><b>{selected.direction}</b></div><div><small>ENTRY</small><b>{money(selected.entry)}</b></div><div><small>STOP</small><b>{money(selected.stop)}</b></div><div><small>TARGET</small><b>{money(selected.target)}</b></div><div><small>R:R</small><b>{selected.rr ? `${selected.rr}:1` : "—"}</b></div><div><small>RVOL</small><b>{selected.rvol.toFixed(2)}x</b></div><div><small>ATR14</small><b>{money(selected.atr14)}</b></div></div><h3>Checks</h3><ul>{selected.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul></aside></div>}
  </main>;
}
