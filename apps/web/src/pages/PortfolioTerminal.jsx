import React, { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Check, X, ChevronRight, Circle } from "lucide-react";

// ---------------------------------------------------------------------------
// Mock data — shape matches the real API responses (Recommendation, Holding,
// FactorScore models from the Prisma schema) so wiring to the live backend
// later is a drop-in swap of these constants for fetch() calls.
// ---------------------------------------------------------------------------

const modelPortfolio = {
  name: "Quality Growth — India Core",
  compositeAvg: 71.4,
  factors: { value: 58, momentum: 74, quality: 82, growth: 76 },
};

const tapeItems = [
  { symbol: "HDFCBANK", score: 78.2, delta: 1.4 },
  { symbol: "INFY", score: 81.6, delta: 2.1 },
  { symbol: "TCS", score: 69.3, delta: -0.8 },
  { symbol: "RELIANCE", score: 74.5, delta: 0.6 },
  { symbol: "ICICIBANK", score: 76.8, delta: 1.9 },
  { symbol: "TITAN", score: 65.1, delta: -1.2 },
  { symbol: "ASIANPAINT", score: 71.9, delta: 0.3 },
  { symbol: "BAJFINANCE", score: 79.4, delta: 2.7 },
];

const holdings = [
  { symbol: "HDFCBANK", sector: "Banking", qty: 120, avgPrice: 1542.3, ltp: 1612.8, weight: 8.1 },
  { symbol: "INFY", sector: "IT", qty: 85, avgPrice: 1398.0, ltp: 1465.2, weight: 7.4 },
  { symbol: "TCS", sector: "IT", qty: 40, avgPrice: 3812.5, ltp: 3765.0, weight: 9.0 },
  { symbol: "RELIANCE", sector: "Energy", qty: 60, avgPrice: 2410.0, ltp: 2489.6, weight: 8.9 },
  { symbol: "ICICIBANK", sector: "Banking", qty: 150, avgPrice: 1085.4, ltp: 1142.9, weight: 10.3 },
  { symbol: "TITAN", sector: "Consumer", qty: 45, avgPrice: 3298.0, ltp: 3241.5, weight: 8.1 },
];

const recommendations = [
  {
    id: "REC-0412",
    action: "BUY",
    symbol: "BAJFINANCE",
    weightDrift: 2.8,
    rationale:
      "Scores strongly on balance sheet quality and earnings growth relative to peers. Composite score 79.4/100, up from 76.7 last cycle on improved ROE.",
    status: "PENDING",
  },
  {
    id: "REC-0413",
    action: "SELL",
    symbol: "TITAN",
    weightDrift: -1.9,
    rationale:
      "Comparatively weak on price momentum and valuation versus consumer discretionary peers. Composite score 65.1/100, trimming to fund higher-conviction names.",
    status: "PENDING",
  },
  {
    id: "REC-0414",
    action: "REBALANCE",
    symbol: "TCS",
    weightDrift: -1.1,
    rationale:
      "Position has drifted 1.1pp above target weight after recent price strength. Trimming back to model allocation to maintain sector discipline.",
    status: "PENDING",
  },
];

// ---------------------------------------------------------------------------

function useTapeScroll() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    let raf;
    let x = 0;
    const step = () => {
      x -= 0.4;
      if (Math.abs(x) >= el.scrollWidth / 2) x = 0;
      el.style.transform = `translateX(${x}px)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return ref;
}

function SignalTape() {
  const ref = useTapeScroll();
  const items = [...tapeItems, ...tapeItems];
  return (
    <div className="tape-wrap">
      <div className="tape-track" ref={ref}>
        {items.map((t, i) => (
          <span className="tape-item" key={i}>
            <span className="tape-symbol">{t.symbol}</span>
            <span className="tape-score">{t.score.toFixed(1)}</span>
            <span className={`tape-delta ${t.delta >= 0 ? "up" : "down"}`}>
              {t.delta >= 0 ? "▲" : "▼"} {Math.abs(t.delta).toFixed(1)}
            </span>
            <span className="tape-sep">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FactorBar({ label, value }) {
  return (
    <div className="factor-row">
      <span className="factor-label">{label}</span>
      <div className="factor-track">
        <div className="factor-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="factor-value">{value}</span>
    </div>
  );
}

function RecommendationTicket({ rec, onDecide }) {
  const actionColor =
    rec.action === "BUY" ? "var(--gain)" : rec.action === "SELL" ? "var(--loss)" : "var(--gold)";
  return (
    <div className="ticket">
      <div className="ticket-head">
        <span className="ticket-id">{rec.id}</span>
        <span className="ticket-action" style={{ color: actionColor, borderColor: actionColor }}>
          {rec.action}
        </span>
        <span className="ticket-symbol">{rec.symbol}</span>
        <span className={`ticket-drift ${rec.weightDrift >= 0 ? "up" : "down"}`}>
          {rec.weightDrift >= 0 ? "+" : ""}
          {rec.weightDrift.toFixed(1)}pp
        </span>
      </div>
      <p className="ticket-rationale">{rec.rationale}</p>
      <div className="ticket-actions">
        <button className="btn btn-approve" onClick={() => onDecide(rec.id, "APPROVED")}>
          <Check size={14} strokeWidth={2.5} /> Approve
        </button>
        <button className="btn btn-reject" onClick={() => onDecide(rec.id, "REJECTED")}>
          <X size={14} strokeWidth={2.5} /> Reject
        </button>
      </div>
    </div>
  );
}

export default function FundAITerminal() {
  const [recs, setRecs] = useState(recommendations);
  const [toast, setToast] = useState(null);

  const totalValue = holdings.reduce((sum, h) => sum + h.qty * h.ltp, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.qty * h.avgPrice, 0);
  const totalGainPct = ((totalValue - totalCost) / totalCost) * 100;

  function handleDecide(id, decision) {
    setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: decision } : r)));
    setToast(`${id} ${decision === "APPROVED" ? "approved" : "rejected"}`);
    setTimeout(() => setToast(null), 2200);
  }

  const pending = recs.filter((r) => r.status === "PENDING");

  return (
    <div className="terminal">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        * { box-sizing: border-box; }
        .terminal {
          --ink: #0A0F1C;
          --surface: #131B2E;
          --surface-2: #17203690;
          --hairline: #232C42;
          --text: #EAEDF5;
          --muted: #8A93AC;
          --gold: #E3A857;
          --gain: #3ECF8E;
          --loss: #FF6B6B;
          background: var(--ink);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          min-height: 100vh;
          padding-bottom: 48px;
        }
        .terminal * { font-family: inherit; }
        .mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }

        /* --- Signal tape --- */
        .tape-wrap {
          border-bottom: 1px solid var(--hairline);
          background: #0D1424;
          overflow: hidden;
          white-space: nowrap;
          padding: 9px 0;
        }
        .tape-track { display: inline-flex; will-change: transform; }
        .tape-item {
          display: inline-flex; align-items: center; gap: 8px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px; padding: 0 16px;
          color: var(--muted);
        }
        .tape-symbol { color: var(--gold); font-weight: 600; letter-spacing: 0.03em; }
        .tape-score { color: var(--text); }
        .tape-delta.up { color: var(--gain); }
        .tape-delta.down { color: var(--loss); }
        .tape-sep { color: var(--hairline); }

        /* --- Header --- */
        .header {
          display: flex; justify-content: space-between; align-items: flex-end;
          padding: 32px 40px 24px; border-bottom: 1px solid var(--hairline);
        }
        .brand { display: flex; align-items: center; gap: 10px; }
        .brand-mark {
          width: 8px; height: 8px; background: var(--gold);
        }
        .brand-name {
          font-family: 'Fraunces', serif; font-size: 15px; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--text);
        }
        .brand-sub { font-size: 11px; color: var(--muted); letter-spacing: 0.04em; margin-top: 2px;}
        .header-value { text-align: right; }
        .header-value .label { font-size: 11px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
        .header-value .num {
          font-family: 'Fraunces', serif; font-size: 40px; font-weight: 500;
          line-height: 1.1; margin-top: 4px;
        }
        .header-value .delta { font-size: 13px; margin-top: 4px; }
        .header-value .delta.up { color: var(--gain); }
        .header-value .delta.down { color: var(--loss); }

        /* --- Layout --- */
        .body { display: grid; grid-template-columns: 1.4fr 1fr; gap: 0; }
        @media (max-width: 900px) { .body { grid-template-columns: 1fr; } }
        .panel { padding: 32px 40px; }
        .panel + .panel { border-left: 1px solid var(--hairline); }
        @media (max-width: 900px) { .panel + .panel { border-left: none; border-top: 1px solid var(--hairline); } }

        .section-title {
          font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--muted); margin-bottom: 18px; display: flex; align-items: center; gap: 8px;
        }
        .section-title .rule { flex: 1; height: 1px; background: var(--hairline); }

        /* --- Holdings ledger --- */
        table { width: 100%; border-collapse: collapse; }
        thead th {
          text-align: left; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--muted); font-weight: 500; padding-bottom: 10px; border-bottom: 1px solid var(--hairline);
        }
        thead th.num { text-align: right; }
        tbody td {
          padding: 12px 0; border-bottom: 1px solid var(--hairline); font-size: 13px;
        }
        tbody td.num { text-align: right; }
        .sym { font-weight: 600; }
        .sector-tag { font-size: 10px; color: var(--muted); margin-left: 8px; }
        .gain-cell.up { color: var(--gain); }
        .gain-cell.down { color: var(--loss); }

        /* --- Factor panel --- */
        .factor-panel { margin-bottom: 32px; }
        .factor-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
        .factor-name { font-family: 'Fraunces', serif; font-size: 18px; }
        .factor-composite { font-size: 22px; color: var(--gold); }
        .factor-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
        .factor-label { width: 84px; font-size: 12px; color: var(--muted); }
        .factor-track { flex: 1; height: 5px; background: var(--hairline); }
        .factor-fill { height: 100%; background: var(--gold); }
        .factor-value { width: 28px; text-align: right; font-size: 12px; }

        /* --- Recommendation tickets --- */
        .ticket {
          border: 1px solid var(--hairline); padding: 16px; margin-bottom: 12px; background: var(--surface);
        }
        .ticket-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .ticket-id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); }
        .ticket-action {
          font-size: 10px; letter-spacing: 0.05em; border: 1px solid; padding: 2px 6px; font-weight: 600;
        }
        .ticket-symbol { font-weight: 600; font-size: 13px; }
        .ticket-drift { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
        .ticket-drift.up { color: var(--gain); }
        .ticket-drift.down { color: var(--loss); }
        .ticket-rationale { font-size: 12.5px; color: var(--muted); line-height: 1.55; margin: 0 0 14px; }
        .ticket-actions { display: flex; gap: 8px; }
        .btn {
          display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
          padding: 7px 12px; border: 1px solid var(--hairline); background: transparent; color: var(--text);
          cursor: pointer; transition: border-color 0.15s, color 0.15s;
        }
        .btn-approve:hover { border-color: var(--gain); color: var(--gain); }
        .btn-reject:hover { border-color: var(--loss); color: var(--loss); }

        .empty-state { font-size: 12.5px; color: var(--muted); padding: 20px 0; border: 1px dashed var(--hairline); text-align: center; }

        .toast {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: var(--surface); border: 1px solid var(--gold); color: var(--text);
          padding: 10px 18px; font-size: 12.5px; font-family: 'IBM Plex Mono', monospace;
        }
      `}</style>

      <SignalTape />

      <div className="header">
        <div>
          <div className="brand">
            <div className="brand-mark" />
            <span className="brand-name">FundAI Terminal</span>
          </div>
          <div className="brand-sub">Advisory portfolio · Model: {modelPortfolio.name}</div>
        </div>
        <div className="header-value">
          <div className="label">Portfolio Value</div>
          <div className="num mono">
            ₹{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          <div className={`delta mono ${totalGainPct >= 0 ? "up" : "down"}`}>
            {totalGainPct >= 0 ? <TrendingUp size={12} style={{display:"inline", marginRight:4}}/> : <TrendingDown size={12} style={{display:"inline", marginRight:4}}/>}
            {totalGainPct >= 0 ? "+" : ""}
            {totalGainPct.toFixed(2)}% since inception
          </div>
        </div>
      </div>

      <div className="body">
        <div className="panel">
          <div className="section-title">Holdings <div className="rule" /></div>
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">Qty</th>
                <th className="num">Avg</th>
                <th className="num">LTP</th>
                <th className="num">Weight</th>
                <th className="num">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const pnlPct = ((h.ltp - h.avgPrice) / h.avgPrice) * 100;
                return (
                  <tr key={h.symbol}>
                    <td>
                      <span className="sym">{h.symbol}</span>
                      <span className="sector-tag">{h.sector}</span>
                    </td>
                    <td className="num mono">{h.qty}</td>
                    <td className="num mono">{h.avgPrice.toFixed(2)}</td>
                    <td className="num mono">{h.ltp.toFixed(2)}</td>
                    <td className="num mono">{h.weight.toFixed(1)}%</td>
                    <td className={`num mono gain-cell ${pnlPct >= 0 ? "up" : "down"}`}>
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 40 }}>
            <div className="section-title">Recommendations — Pending Approval <div className="rule" /></div>
            {pending.length === 0 ? (
              <div className="empty-state">No pending recommendations. All clear.</div>
            ) : (
              pending.map((rec) => (
                <RecommendationTicket key={rec.id} rec={rec} onDecide={handleDecide} />
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="factor-panel">
            <div className="section-title">Model Factor Profile <div className="rule" /></div>
            <div className="factor-header">
              <span className="factor-name">{modelPortfolio.name}</span>
              <span className="factor-composite mono">{modelPortfolio.compositeAvg}</span>
            </div>
            <FactorBar label="Value" value={modelPortfolio.factors.value} />
            <FactorBar label="Momentum" value={modelPortfolio.factors.momentum} />
            <FactorBar label="Quality" value={modelPortfolio.factors.quality} />
            <FactorBar label="Growth" value={modelPortfolio.factors.growth} />
          </div>

          <div className="section-title">Decision Log <div className="rule" /></div>
          {recs.filter((r) => r.status !== "PENDING").length === 0 ? (
            <div className="empty-state">Decisions on recommendations will appear here.</div>
          ) : (
            recs
              .filter((r) => r.status !== "PENDING")
              .map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "8px 0", borderBottom: "1px solid var(--hairline)" }} className="mono">
                  <Circle size={6} fill={r.status === "APPROVED" ? "var(--gain)" : "var(--loss)"} color={r.status === "APPROVED" ? "var(--gain)" : "var(--loss)"} />
                  <span style={{ color: "var(--muted)" }}>{r.id}</span>
                  <span>{r.symbol}</span>
                  <ChevronRight size={12} color="var(--muted)" />
                  <span style={{ color: r.status === "APPROVED" ? "var(--gain)" : "var(--loss)" }}>{r.status}</span>
                </div>
              ))
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
