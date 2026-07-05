import React, { useState, useEffect, useRef } from "react";
import { 
  TrendingUp, 
  TrendingDown, 
  Check, 
  X, 
  ChevronRight, 
  Circle, 
  LogOut, 
  ShieldAlert, 
  Cpu, 
  Layers, 
  Activity, 
  DollarSign, 
  Percent, 
  ArrowRightLeft,
  Search,
  Sparkles,
  Info
} from "lucide-react";
import { 
  getRecommendations, 
  decideRecommendation, 
  getMarketRegime, 
  getClients, 
  getPortfolio, 
  createClient, 
  createPortfolio 
} from "../api.js";

// ---------------------------------------------------------------------------
// Fallback Mock Data for rich visualization
// ---------------------------------------------------------------------------
const defaultModelPortfolio = {
  name: "Adaptive Alpha Core (India)",
  compositeAvg: 78.4,
  factors: { value: 68, momentum: 84, quality: 89, growth: 72, low_volatility: 78 },
  historicalReturn: [
    { month: "Jan", return: 4.2 },
    { month: "Feb", return: 5.8 },
    { month: "Mar", return: 3.1 },
    { month: "Apr", return: 8.5 },
    { month: "May", return: 6.2 },
    { month: "Jun", return: 9.7 }
  ]
};

const defaultTapeItems = [
  { symbol: "RELIANCE", score: 84.5, delta: 1.2 },
  { symbol: "HDFCBANK", score: 79.8, delta: -0.4 },
  { symbol: "INFY", score: 81.2, delta: 2.3 },
  { symbol: "TCS", score: 76.5, delta: -1.1 },
  { symbol: "ICICIBANK", score: 82.1, delta: 0.8 },
  { symbol: "TITAN", score: 68.3, delta: -2.0 },
  { symbol: "BAJFINANCE", score: 88.6, delta: 3.4 },
  { symbol: "SUNPHARMA", score: 77.4, delta: 0.5 },
  { symbol: "TATAMOTORS", score: 83.2, delta: 2.1 },
  { symbol: "HINDUNILVR", score: 71.8, delta: -0.2 }
];

const mockHoldings = [
  { symbol: "HDFCBANK", sector: "Financial Services", qty: 140, avgPrice: 1510.4, ltp: 1612.8, weight: 14.5, pnl: 14336 },
  { symbol: "INFY", sector: "Technology", qty: 95, avgPrice: 1380.2, ltp: 1465.2, weight: 10.2, pnl: 8075 },
  { symbol: "RELIANCE", sector: "Energy & Utilities", qty: 75, avgPrice: 2390.0, ltp: 2489.6, weight: 13.8, pnl: 7470 },
  { symbol: "ICICIBANK", sector: "Financial Services", qty: 160, avgPrice: 1060.0, ltp: 1142.9, weight: 11.2, pnl: 13264 },
  { symbol: "TCS", sector: "Technology", qty: 35, avgPrice: 3820.0, ltp: 3765.0, weight: 9.6, pnl: -1925 },
  { symbol: "BAJFINANCE", sector: "Financial Services", qty: 30, avgPrice: 6980.5, ltp: 7214.2, weight: 15.8, pnl: 7011 }
];

const mockRecommendations = [
  {
    id: "REC-2208",
    action: "BUY",
    symbol: "BAJFINANCE",
    weightDrift: 3.2,
    rationale: "Quant score rose to 88.6/100 following exceptional Q1 ROE updates and robust asset quality metrics. Rebalancing to secure dynamic momentum targets.",
    status: "PENDING",
    timestamp: "10:42"
  },
  {
    id: "REC-2209",
    action: "SELL",
    symbol: "TITAN",
    weightDrift: -2.4,
    rationale: "Underperformed momentum limits relative to consumer cyclical benchmarks. Target weight trim secures defensive cash liquidity ratios.",
    status: "PENDING",
    timestamp: "10:43"
  },
  {
    id: "REC-2210",
    action: "REBALANCE",
    symbol: "RELIANCE",
    weightDrift: 1.8,
    rationale: "Position has drifted 1.8% below target profile under recent range-bound consolidation phases. Increasing weight allocation to target.",
    status: "PENDING",
    timestamp: "10:45"
  }
];

function useTapeScroll() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf;
    let x = 0;
    const step = () => {
      x -= 0.5;
      if (Math.abs(x) >= el.scrollWidth / 2) x = 0;
      el.style.transform = `translateX(${x}px)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return ref;
}

const mockScreenerStocks = [
  { stock_id: "s1", symbol: "RELIANCE", name: "Reliance Industries Ltd.", sector: "Energy & Utilities", industry: "Oil & Gas", scores: { value: 74, momentum: 89, quality: 81, growth: 67, lowVolatility: 65, composite: 84.5 }, fundamentals: { peRatio: 26.4, pbRatio: 2.1, roe: 8.5, debtToEquity: 0.38, marketCap: 1.6e13, dividendYield: 0.6 } },
  { stock_id: "s2", symbol: "HDFCBANK", name: "HDFC Bank Ltd.", sector: "Financial Services", industry: "Banking", scores: { value: 68, momentum: 78, quality: 88, growth: 76, lowVolatility: 74, composite: 79.8 }, fundamentals: { peRatio: 18.2, pbRatio: 2.6, roe: 14.5, debtToEquity: 0.95, marketCap: 1.2e13, dividendYield: 1.1 } },
  { stock_id: "s3", symbol: "INFY", name: "Infosys Ltd.", sector: "Technology", industry: "IT Services", scores: { value: 62, momentum: 86, quality: 92, growth: 70, lowVolatility: 78, composite: 81.2 }, fundamentals: { peRatio: 24.5, pbRatio: 7.2, roe: 28.5, debtToEquity: 0.05, marketCap: 6.2e12, dividendYield: 2.3 } },
  { stock_id: "s4", symbol: "TCS", name: "Tata Consultancy Services Ltd.", sector: "Technology", industry: "IT Services", scores: { value: 58, momentum: 81, quality: 94, growth: 68, lowVolatility: 82, composite: 76.5 }, fundamentals: { peRatio: 28.1, pbRatio: 9.6, roe: 38.2, debtToEquity: 0.02, marketCap: 1.3e13, dividendYield: 2.9 } },
  { stock_id: "s5", symbol: "ICICIBANK", name: "ICICI Bank Ltd.", sector: "Financial Services", industry: "Banking", scores: { value: 71, momentum: 84, quality: 86, growth: 79, lowVolatility: 70, composite: 82.1 }, fundamentals: { peRatio: 17.5, pbRatio: 3.1, roe: 16.2, debtToEquity: 0.88, marketCap: 8.1e12, dividendYield: 0.9 } },
  { stock_id: "s6", symbol: "TITAN", name: "Titan Company Ltd.", sector: "Consumer Cyclical", industry: "Luxury Goods", scores: { value: 45, momentum: 68, quality: 85, growth: 74, lowVolatility: 58, composite: 68.3 }, fundamentals: { peRatio: 65.4, pbRatio: 15.2, roe: 24.3, debtToEquity: 0.22, marketCap: 3.1e12, dividendYield: 0.3 } },
  { stock_id: "s7", symbol: "BAJFINANCE", name: "Bajaj Finance Ltd.", sector: "Financial Services", industry: "NBFC", scores: { value: 64, momentum: 94, quality: 89, growth: 85, lowVolatility: 62, composite: 88.6 }, fundamentals: { peRatio: 32.5, pbRatio: 6.8, roe: 21.8, debtToEquity: 1.25, marketCap: 4.2e12, dividendYield: 0.5 } },
  { stock_id: "s8", symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries Ltd.", sector: "Healthcare", industry: "Pharmaceuticals", scores: { value: 59, momentum: 82, quality: 80, growth: 72, lowVolatility: 76, composite: 77.4 }, fundamentals: { peRatio: 34.2, pbRatio: 3.8, roe: 11.2, debtToEquity: 0.12, marketCap: 3.5e12, dividendYield: 0.8 } },
  { stock_id: "s9", symbol: "TATAMOTORS", name: "Tata Motors Ltd.", sector: "Consumer Cyclical", industry: "Auto Manufacturers", scores: { value: 78, momentum: 90, quality: 78, growth: 81, lowVolatility: 54, composite: 83.2 }, fundamentals: { peRatio: 12.8, pbRatio: 2.9, roe: 22.4, debtToEquity: 1.55, marketCap: 3.8e12, dividendYield: 0.4 } },
  { stock_id: "s10", symbol: "HINDUNILVR", name: "Hindustan Unilever Ltd.", sector: "Consumer Defensive", industry: "Personal Care", scores: { value: 50, momentum: 70, quality: 96, growth: 62, lowVolatility: 85, composite: 71.8 }, fundamentals: { peRatio: 52.4, pbRatio: 11.8, roe: 86.4, debtToEquity: 0.01, marketCap: 5.6e12, dividendYield: 1.8 } }
];

export default function FundAITerminal({ user, onLogout }) {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [clientsList, setClientsList] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStock, setSelectedStock] = useState(null);
  
  // Loaded dataset
  const [recs, setRecs] = useState(mockRecommendations);
  const [holdings, setHoldings] = useState(mockHoldings);
  const [modelPortfolio, setModelPortfolio] = useState(defaultModelPortfolio);
  const [tapeItems, setTapeItems] = useState(defaultTapeItems);
  
  const [marketRegime, setMarketRegime] = useState({
    regime: "BULL",
    interpretation: "Index trading above the 200-day Simple Moving Average (SMA) with positive momentum. Standard regime weight allocation shifts focus towards growth and momentum components, following strict trailing-window validation."
  });

  // Screener state variables
  const [activeTab, setActiveTab] = useState("holdings");
  const [screenerSearch, setScreenerSearch] = useState("");
  const [screenerSector, setScreenerSector] = useState("");
  const [screenerSortBy, setScreenerSortBy] = useState("compositeScore");
  const [screenerSortOrder, setScreenerSortOrder] = useState("desc");
  const [screenerResults, setScreenerResults] = useState(mockScreenerStocks);
  const [screenerTotal, setScreenerTotal] = useState(mockScreenerStocks.length);
  const [screenerLoading, setScreenerLoading] = useState(false);

  // Fetch/Filter screener stocks
  useEffect(() => {
    if (isDemoMode) {
      // Filter mock stocks client-side
      let filtered = [...mockScreenerStocks];
      if (screenerSearch) {
        const query = screenerSearch.toLowerCase();
        filtered = filtered.filter(s => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query));
      }
      if (screenerSector) {
        filtered = filtered.filter(s => s.sector === screenerSector);
      }
      // Sorting
      filtered.sort((a, b) => {
        let valA, valB;
        if (screenerSortBy === "symbol") {
          valA = a.symbol;
          valB = b.symbol;
        } else if (screenerSortBy === "name") {
          valA = a.name;
          valB = b.name;
        } else if (screenerSortBy === "sector") {
          valA = a.sector;
          valB = b.sector;
        } else {
          // map score keys
          const keyMap = {
            compositeScore: "composite",
            valueScore: "value",
            momentumScore: "momentum",
            qualityScore: "quality",
            growthScore: "growth",
            lowVolatilityScore: "lowVolatility"
          };
          const key = keyMap[screenerSortBy] || "composite";
          valA = a.scores[key];
          valB = b.scores[key];
        }

        if (typeof valA === "string") {
          return screenerSortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
          return screenerSortOrder === "asc" ? valA - valB : valB - valA;
        }
      });

      setScreenerResults(filtered);
      setScreenerTotal(filtered.length);
      return;
    }

    // Fetch from real API in database mode
    const delayDebounceFn = setTimeout(async () => {
      setScreenerLoading(true);
      try {
        const params = {
          search: screenerSearch,
          sector: screenerSector,
          sortBy: screenerSortBy,
          sortOrder: screenerSortOrder,
          limit: 50,
          offset: 0
        };
        // Fetch from API
        const { getScreener } = await import("../api.js");
        const res = await getScreener(params);
        if (res && res.stocks) {
          setScreenerResults(res.stocks);
          setScreenerTotal(res.total);
        }
      } catch (err) {
        console.error("Failed to load screener data from API", err);
      } finally {
        setScreenerLoading(false);
      }
    }, 300); // 300ms debounce for search inputs

    return () => clearTimeout(delayDebounceFn);
  }, [screenerSearch, screenerSector, screenerSortBy, screenerSortOrder, isDemoMode]);

  const getRegimeStyles = (regime) => {
    switch (regime) {
      case "BULL":
        return {
          glowColor: "rgba(62, 207, 142, 0.2)",
          borderColor: "rgba(62, 207, 142, 0.4)",
          textColor: "var(--neon-green)",
          shadowColor: "62, 207, 142",
          label: "Volume Confirmed Bull Market",
        };
      case "BEAR":
        return {
          glowColor: "rgba(255, 74, 107, 0.2)",
          borderColor: "rgba(255, 74, 107, 0.4)",
          textColor: "var(--neon-rose)",
          shadowColor: "255, 74, 107",
          label: "Defensive Bear Market",
        };
      case "HIGH_VOLATILITY":
        return {
          glowColor: "rgba(255, 170, 0, 0.2)",
          borderColor: "rgba(255, 170, 0, 0.4)",
          textColor: "var(--neon-amber)",
          shadowColor: "255, 170, 0",
          label: "High Volatility Regime",
        };
      case "SIDEWAYS":
      default:
        return {
          glowColor: "rgba(0, 240, 255, 0.2)",
          borderColor: "rgba(0, 240, 255, 0.4)",
          textColor: "var(--neon-cyan)",
          shadowColor: "0, 240, 255",
          label: "Range-bound Sideways Market",
        };
    }
  };
  
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  // Portfolio calculations
  const totalValue = holdings.reduce((sum, h) => sum + h.qty * h.ltp, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.qty * h.avgPrice, 0);
  const totalPnl = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  useEffect(() => {
    async function loadMarketState() {
      try {
        const regimeRes = await getMarketRegime();
        if (regimeRes) setMarketRegime(regimeRes);
      } catch (err) {
        console.warn("Could not retrieve online market indicators.");
      }
    }
    loadMarketState();
  }, []);

  useEffect(() => {
    setSelectedStock(null);
    if (isDemoMode) {
      setRecs(mockRecommendations);
      setHoldings(mockHoldings);
      setModelPortfolio(defaultModelPortfolio);
      return;
    }

    async function loadDatabaseState() {
      setLoading(true);
      try {
        const clients = await getClients();
        setClientsList(clients);
        if (clients && clients.length > 0) {
          setSelectedClient(clients[0]);
          if (clients[0].portfolios && clients[0].portfolios.length > 0) {
            loadPortfolioDetails(clients[0].portfolios[0].id);
          } else {
            setHoldings([]);
            setRecs([]);
          }
        } else {
          setSelectedClient(null);
          setSelectedPortfolio(null);
          setHoldings([]);
          setRecs([]);
        }
      } catch (err) {
        showToast("Database server offline. Reverting to sandbox demo.");
        setIsDemoMode(true);
      } finally {
        setLoading(false);
      }
    }
    loadDatabaseState();
  }, [isDemoMode]);

  async function loadPortfolioDetails(portId) {
    try {
      const port = await getPortfolio(portId);
      setSelectedPortfolio(port);
      if (port.holdings) {
        const mapped = port.holdings.map(h => {
          const qty = parseFloat(h.quantity);
          const avgPrice = parseFloat(h.avgBuyPrice);
          const ltp = parseFloat(h.stock.priceHistory?.[0]?.close || h.avgBuyPrice);
          return {
            symbol: h.stock.symbol,
            sector: h.stock.sector || "Other",
            qty,
            avgPrice,
            ltp,
            weight: 0,
            pnl: (ltp - avgPrice) * qty
          };
        });
        const totalPortValue = mapped.reduce((sum, item) => sum + item.qty * item.ltp, 0);
        mapped.forEach(item => {
          item.weight = totalPortValue > 0 ? (item.qty * item.ltp / totalPortValue) * 100 : 0;
        });
        setHoldings(mapped);
      }
      const pendingRecs = await getRecommendations(portId);
      if (pendingRecs) {
        setRecs(pendingRecs.map(r => ({
          id: r.id,
          action: r.action,
          symbol: r.stock?.symbol || "Stock",
          weightDrift: parseFloat(r.suggestedWeightPct || 0),
          rationale: r.rationaleText,
          status: r.status,
          timestamp: new Date(r.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })));
      }
    } catch (e) {
      showToast("Error retrieving database portfolio");
    }
  }

  async function handleCreateMockAsset() {
    setLoading(true);
    try {
      const cli = await createClient({
        displayName: "Sandeep Rao (HNI Account)",
        email: "sandeep@outlook.com",
        phone: "+919830094801"
      });
      const port = await createPortfolio({
        clientId: cli.id,
        name: "Equity Dynamic Alpha Focus",
        baseCurrency: "INR"
      });
      showToast("Created model data in database.");
      setIsDemoMode(false);
    } catch (e) {
      showToast(`Creation failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const handleCopyWhatsApp = (rec) => {
    const clientName = !isDemoMode && selectedClient ? selectedClient.displayName : "Valued Client";
    const text = `*FundAI Portfolio Proposal for ${clientName}*\n\n` +
      `*Action*: ${rec.action} ${rec.symbol}\n` +
      `*Rebalance Drift*: ${rec.weightDrift >= 0 ? "+" : ""}${rec.weightDrift.toFixed(1)}%\n` +
      `*Rationale*: ${rec.rationale}\n\n` +
      `_This is a quantitative calculation generated for client review. Final execution requires your explicit consent._`;
    
    navigator.clipboard.writeText(text);
    showToast(`WhatsApp draft copied to clipboard! Ready to paste.`);
  };

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleDecide(id, decision) {
    if (isDemoMode) {
      setRecs(prev => prev.map(r => r.id === id ? { ...r, status: decision } : r));
      showToast(`${id} decision recorded as: ${decision}`);
      return;
    }
    try {
      await decideRecommendation(id, decision);
      showToast(`${id} ${decision.toLowerCase()} successfully.`);
      if (selectedPortfolio) loadPortfolioDetails(selectedPortfolio.id);
    } catch (e) {
      showToast(`Error applying recommendation: ${e.message}`);
    }
  }

  const tapeRef = useTapeScroll();
  const pendingRecs = recs.filter(r => r.status === "PENDING");
  const filteredTape = tapeItems.filter(item => 
    item.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="hq-terminal">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');

        :root {
          --panel-border: 1px solid rgba(255, 255, 255, 0.05);
          --neon-cyan: #00f0ff;
          --neon-amber: #ffaa00;
          --neon-green: #3ecf8e;
          --neon-rose: #ff4a6b;
          --bg-dark: #070b19;
          --panel-bg: rgba(16, 24, 48, 0.45);
        }

        .hq-terminal {
          background: var(--bg-dark);
          color: #eaedf5;
          font-family: 'Plus Jakarta Sans', sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
          position: relative;
        }

        .hq-terminal * {
          box-sizing: border-box;
          font-family: inherit;
        }

        .mono {
          font-family: 'JetBrains Mono', monospace;
        }

        /* --- Header Signal Tape --- */
        .tape-wrap {
          background: #090e21;
          border-bottom: var(--panel-border);
          overflow: hidden;
          padding: 8px 0;
          position: relative;
        }
        .tape-track {
          display: inline-flex;
          white-space: nowrap;
          will-change: transform;
        }
        .tape-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          padding: 0 20px;
          color: #8c9bb0;
          border-right: 1px solid rgba(255, 255, 255, 0.03);
        }
        .tape-symbol {
          color: #eaedf5;
          font-weight: 700;
        }
        .tape-score {
          color: var(--neon-cyan);
        }
        .tape-delta.up { color: var(--neon-green); }
        .tape-delta.down { color: var(--neon-rose); }

        /* --- Navigation & Controls --- */
        .nav-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(13, 20, 41, 0.85);
          border-bottom: var(--panel-border);
          padding: 12px 30px;
          backdrop-filter: blur(10px);
        }
        .brand-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .brand-icon {
          width: 24px;
          height: 24px;
          background: linear-gradient(135deg, var(--neon-cyan) 0%, #0055ff 100%);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .brand-title {
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          font-size: 16px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .brand-badge {
          font-size: 9px;
          background: rgba(0, 240, 255, 0.1);
          color: var(--neon-cyan);
          border: 1px solid rgba(0, 240, 255, 0.25);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .auth-widget {
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 12.5px;
        }
        .mode-toggle-group {
          display: flex;
          background: rgba(0, 0, 0, 0.25);
          border-radius: 8px;
          padding: 3px;
          border: 1px solid rgba(255, 255, 255, 0.03);
        }
        .mode-btn {
          border: none;
          background: transparent;
          color: #8c9bb0;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .mode-btn.active {
          background: rgba(255, 255, 255, 0.05);
          color: #eaedf5;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        .signout-btn {
          background: transparent;
          border: none;
          color: #8c9bb0;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          font-weight: 500;
          transition: color 0.2s;
        }
        .signout-btn:hover {
          color: var(--neon-rose);
        }

        /* --- Dashboard Grid --- */
        .grid-layout {
          display: grid;
          grid-template-columns: 2.2fr 1fr;
          gap: 20px;
          padding: 24px 30px;
        }
        @media (max-width: 1100px) {
          .grid-layout {
            grid-template-columns: 1fr;
          }
        }

        /* --- Panel Card Component --- */
        .glass-panel {
          background: var(--panel-bg);
          border: var(--panel-border);
          border-radius: 16px;
          padding: 24px;
          backdrop-filter: blur(15px);
          position: relative;
          overflow: hidden;
        }
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
          padding-bottom: 12px;
        }
        .panel-title {
          font-size: 13.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #8c9bb0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pulse-dot {
          width: 6px;
          height: 6px;
          background: var(--neon-cyan);
          border-radius: 50%;
          box-shadow: 0 0 8px var(--neon-cyan);
          animation: pulse 2s infinite alternate;
        }
        @keyframes pulse {
          0% { opacity: 0.4; }
          100% { opacity: 1; }
        }

        /* --- Financial Metrics Bar --- */
        .metrics-banner {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        @media (max-width: 600px) {
          .metrics-banner {
            grid-template-columns: 1fr 1fr;
          }
        }
        .metric-card {
          background: rgba(0, 0, 0, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.02);
          border-radius: 10px;
          padding: 14px 18px;
        }
        .metric-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #8c9bb0;
          margin-bottom: 6px;
        }
        .metric-val {
          font-size: 18px;
          font-weight: 700;
          color: #eaedf5;
        }

        /* --- Ledger Table Styling --- */
        .table-wrap {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8c9bb0;
          font-weight: 600;
          padding: 10px 12px;
          border-bottom: var(--panel-border);
        }
        td {
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.02);
          font-size: 13px;
        }
        tr:hover td {
          background: rgba(255, 255, 255, 0.01);
        }
        .ticker-symbol {
          font-weight: 700;
          color: #eaedf5;
        }
        .sector-badge {
          display: inline-block;
          font-size: 9.5px;
          color: var(--neon-cyan);
          background: rgba(0, 240, 255, 0.06);
          border: 1px solid rgba(0, 240, 255, 0.15);
          padding: 2px 6px;
          border-radius: 4px;
          margin-left: 8px;
        }
        .val-gain { color: var(--neon-green); }
        .val-loss { color: var(--neon-rose); }

        /* --- Custom mini chart --- */
        .sparkline-row {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 24px;
          width: 80px;
        }
        .spark-bar {
          flex: 1;
          background: rgba(0, 240, 255, 0.15);
          border-radius: 2px;
          transition: background 0.3s;
        }
        .spark-bar:hover {
          background: var(--neon-cyan);
        }

        /* --- Recommendation Tickets --- */
        .recs-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .rec-ticket {
          background: rgba(14, 22, 45, 0.65);
          border: var(--panel-border);
          border-radius: 12px;
          padding: 16px 20px;
          transition: transform 0.2s, border-color 0.2s;
        }
        .rec-ticket:hover {
          border-color: rgba(255, 255, 255, 0.1);
        }
        .ticket-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .badge-action {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid transparent;
        }
        .badge-action.buy {
          background: rgba(62, 207, 142, 0.08);
          color: var(--neon-green);
          border-color: rgba(62, 207, 142, 0.2);
        }
        .badge-action.sell {
          background: rgba(255, 74, 107, 0.08);
          color: var(--neon-rose);
          border-color: rgba(255, 74, 107, 0.2);
        }
        .badge-action.rebalance {
          background: rgba(255, 170, 0, 0.08);
          color: var(--neon-amber);
          border-color: rgba(255, 170, 0, 0.2);
        }
        .rec-desc {
          font-size: 12.5px;
          color: #8c9bb0;
          line-height: 1.5;
          margin-bottom: 14px;
        }
        .ticket-controls {
          display: flex;
          gap: 10px;
        }
        .action-button {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          padding: 8px 16px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: transparent;
          color: #eaedf5;
          cursor: pointer;
          transition: all 0.2s;
        }
        .action-button.approve:hover {
          background: rgba(62, 207, 142, 0.08);
          border-color: var(--neon-green);
          color: var(--neon-green);
        }
        .action-button.reject:hover {
          background: rgba(255, 74, 107, 0.08);
          border-color: var(--neon-rose);
          color: var(--neon-rose);
        }

        /* --- Right Sidebar Widgets --- */
        .right-sidebar {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* --- Factor Score Bars --- */
        .factor-card {
          margin-bottom: 16px;
        }
        .factor-title-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .factor-bar-bg {
          height: 6px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 3px;
          overflow: hidden;
        }
        .factor-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--neon-cyan) 0%, #0088ff 100%);
          border-radius: 3px;
        }

        /* --- Market Intelligence Widget --- */
        .intel-badge {
          background: rgba(255, 255, 255, 0.02);
          border: var(--panel-border);
          border-radius: 12px;
          padding: 18px;
        }
        .regime-status {
          font-size: 15px;
          font-weight: 700;
          color: var(--neon-amber);
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
        }
        .regime-text {
          font-size: 12.5px;
          color: #8c9bb0;
          line-height: 1.5;
        }

        /* --- Toast Notifications --- */
        .hq-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: rgba(13, 20, 41, 0.95);
          border: 1px solid var(--neon-cyan);
          border-radius: 8px;
          padding: 12px 20px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: #eaedf5;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
          z-index: 10000;
          display: flex;
          align-items: center;
          gap: 10px;
        }
      `}</style>

      {/* 1. Rolling ticker bar */}
      <div className="tape-wrap">
        <div className="tape-track" ref={tapeRef}>
          {tapeItems.map((item, idx) => (
            <span className="tape-item" key={idx}>
              <span className="tape-symbol">{item.symbol}</span>
              <span className="tape-score">{item.score.toFixed(1)}</span>
              <span className={`tape-delta ${item.delta >= 0 ? "up" : "down"}`}>
                {item.delta >= 0 ? "+" : ""}{item.delta.toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* 2. Sleek Menu Bar */}
      <div className="nav-bar">
        <div className="brand-container">
          <div className="brand-icon" style={{ background: "var(--neon-green)" }}>
            <Cpu size={14} color="#060913" />
          </div>
          <span className="brand-title">FundAI Partner Portal</span>
          <span className="brand-badge" style={{ background: "rgba(62,207,142,0.1)", color: "var(--neon-green)" }}>RIA Sentinel v0.2</span>
        </div>

        <div className="auth-widget">
          <div className="mode-toggle-group">
            <button 
              className={`mode-btn ${isDemoMode ? "active" : ""}`}
              onClick={() => setIsDemoMode(true)}
            >
              Demo Sandbox
            </button>
            <button 
              className={`mode-btn ${!isDemoMode ? "active" : ""}`}
              onClick={() => setIsDemoMode(false)}
            >
              Live Database Mode
            </button>
          </div>
          
          <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>

          <span className="mono" style={{ color: "#8c9bb0" }}>{user.email}</span>
          <button className="signout-btn" onClick={onLogout}>
            <LogOut size={14} /> Exit
          </button>
        </div>
      </div>

      {/* 3. Multi-Pane Grid Layout */}
      <div className="grid-layout">
        
        {/* Left Side Panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* Portfolio Performance & Holdings Table */}
          <div className="glass-panel">
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "12px" }}>
                <button 
                  className={`mode-btn ${activeTab === "holdings" ? "active" : ""}`}
                  style={{ fontSize: "13px", padding: "4px 12px" }}
                  onClick={() => setActiveTab("holdings")}
                >
                  Holdings Dashboard
                </button>
                <button 
                  className={`mode-btn ${activeTab === "screener" ? "active" : ""}`}
                  style={{ fontSize: "13px", padding: "4px 12px" }}
                  onClick={() => setActiveTab("screener")}
                >
                  Stock Screener
                </button>
              </div>
              <span className="mono" style={{ fontSize: 11, color: "#8c9bb0" }}>
                {activeTab === "holdings" 
                  ? (!isDemoMode && selectedClient ? `${selectedClient.displayName}` : "ADAPTIVE_ALPHA_INDEX")
                  : `SCREENING_${screenerTotal}_STOCKS`}
              </span>
            </div>

            {activeTab === "holdings" && (
              <>
                {/* Advisor client account selector */}
                {user.role === "ADVISOR" && !isDemoMode && clientsList.length > 0 && (
                  <div style={{ padding: "16px 16px 0", marginBottom: "8px" }}>
                    <label style={{ fontSize: "11px", color: "#8c9bb0", display: "block", marginBottom: "6px", fontWeight: "bold" }} className="mono">
                      CLIENT ACCOUNT ACCOUNT:
                    </label>
                    <select
                      className="form-input"
                      style={{ width: "100%", height: "32px", fontSize: "13px", padding: "0 8px", background: "rgba(14,22,45,0.7)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "6px" }}
                      value={selectedClient ? selectedClient.id : ""}
                      onChange={(e) => {
                        const client = clientsList.find(c => c.id === e.target.value);
                        setSelectedClient(client || null);
                        setSelectedStock(null);
                        if (client && client.portfolios && client.portfolios.length > 0) {
                          loadPortfolioDetails(client.portfolios[0].id);
                        } else {
                          setHoldings([]);
                          setRecs([]);
                        }
                      }}
                    >
                      {clientsList.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.displayName} ({c.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Premium Metric Bar */}
                <div className="metrics-banner">
                  <div className="metric-card">
                    <div className="metric-label">NAV Valuation</div>
                    <div className="metric-val mono" style={{ color: "var(--neon-cyan)" }}>
                      ₹{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Cost Basis</div>
                    <div className="metric-val mono">
                      ₹{totalCost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Cumulative P&amp;L</div>
                    <div className="metric-val mono" style={{ color: totalPnl >= 0 ? "var(--neon-green)" : "var(--neon-rose)" }}>
                      ₹{totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Relative Return</div>
                    <div className="metric-val mono" style={{ color: totalGainPct >= 0 ? "var(--neon-green)" : "var(--neon-rose)" }}>
                      {totalGainPct >= 0 ? "+" : ""}{totalGainPct.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* Holdings Table */}
                {holdings.length === 0 ? (
                  <div className="empty-state">
                    <ShieldAlert size={24} style={{ color: "var(--neon-amber)", marginBottom: 12 }} />
                    <p style={{ fontSize: 13, color: "#8c9bb0" }}>No linked holdings found in this active database.</p>
                    {user.role === "ADVISOR" && (
                      <button 
                        className="action-button approve" 
                        style={{ margin: "16px auto 0" }}
                        onClick={handleCreateMockAsset}
                        disabled={loading}
                      >
                        Generate Sandbox Assets
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Ticker &amp; Sector</th>
                          <th className="mono" style={{ textAlign: "right" }}>Quantity</th>
                          <th className="mono" style={{ textAlign: "right" }}>Avg Price</th>
                          <th className="mono" style={{ textAlign: "right" }}>Last Traded</th>
                          <th className="mono" style={{ textAlign: "right" }}>Allocation</th>
                          <th className="mono" style={{ textAlign: "right" }}>Performance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h, i) => {
                          const returnPct = ((h.ltp - h.avgPrice) / h.avgPrice) * 100;
                          return (
                            <tr 
                              key={h.symbol + i} 
                              style={{ cursor: "pointer" }}
                              onClick={() => {
                                const fullStock = mockScreenerStocks.find(s => s.symbol === h.symbol) || {
                                  stock_id: h.symbol,
                                  symbol: h.symbol,
                                  name: h.symbol + " Corp",
                                  sector: h.sector,
                                  scores: { value: 50, momentum: 50, quality: 50, growth: 50, lowVolatility: 50, composite: 50 },
                                  fundamentals: null
                                };
                                setSelectedStock(fullStock);
                              }}
                            >
                              <td>
                                <span className="ticker-symbol">{h.symbol}</span>
                                <span className="sector-badge">{h.sector}</span>
                              </td>
                              <td className="mono" style={{ textAlign: "right" }}>{h.qty}</td>
                              <td className="mono" style={{ textAlign: "right" }}>₹{h.avgPrice.toFixed(1)}</td>
                              <td className="mono" style={{ textAlign: "right" }}>₹{h.ltp.toFixed(1)}</td>
                              <td className="mono" style={{ textAlign: "right" }}>{h.weight.toFixed(1)}%</td>
                              <td className={`mono ${returnPct >= 0 ? "val-gain" : "val-loss"}`} style={{ textAlign: "right" }}>
                                {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {activeTab === "screener" && (
              <div style={{ padding: "16px" }}>
                {/* Screener Query Bar */}
                <div style={{ 
                  display: "flex", 
                  gap: "12px", 
                  flexWrap: "wrap", 
                  marginBottom: "16px",
                  padding: "12px",
                  background: "rgba(255, 255, 255, 0.02)",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.05)"
                }}>
                  {/* Search input */}
                  <div style={{ flex: 1, minWidth: "180px", position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: "10px", top: "10px", color: "#8c9bb0" }} />
                    <input 
                      type="text" 
                      placeholder="Search symbol or name..." 
                      className="form-input" 
                      style={{ paddingLeft: "32px", width: "100%", height: "32px", fontSize: "12px", boxSizing: "border-box" }}
                      value={screenerSearch}
                      onChange={(e) => setScreenerSearch(e.target.value)}
                    />
                  </div>

                  {/* Sector Dropdown */}
                  <div style={{ minWidth: "150px" }}>
                    <select 
                      className="form-input" 
                      style={{ height: "32px", fontSize: "12px", padding: "0 8px", width: "100%" }}
                      value={screenerSector}
                      onChange={(e) => setScreenerSector(e.target.value)}
                    >
                      <option value="">All Sectors</option>
                      <option value="Technology">Technology</option>
                      <option value="Financial Services">Financial Services</option>
                      <option value="Energy & Utilities">Energy & Utilities</option>
                      <option value="Consumer Cyclical">Consumer Cyclical</option>
                      <option value="Consumer Defensive">Consumer Defensive</option>
                      <option value="Healthcare">Healthcare</option>
                    </select>
                  </div>

                  {/* Sort By Dropdown */}
                  <div style={{ minWidth: "150px" }}>
                    <select 
                      className="form-input" 
                      style={{ height: "32px", fontSize: "12px", padding: "0 8px", width: "100%" }}
                      value={screenerSortBy}
                      onChange={(e) => setScreenerSortBy(e.target.value)}
                    >
                      <option value="compositeScore">Sort: Composite Score</option>
                      <option value="valueScore">Sort: Value Score</option>
                      <option value="momentumScore">Sort: Momentum Score</option>
                      <option value="qualityScore">Sort: Quality Score</option>
                      <option value="growthScore">Sort: Growth Score</option>
                      <option value="lowVolatilityScore">Sort: Low Volatility Score</option>
                      <option value="symbol">Sort: Ticker Symbol</option>
                    </select>
                  </div>

                  {/* Sort Order Switcher */}
                  <button 
                    className="mode-btn"
                    style={{ height: "32px", padding: "0 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
                    onClick={() => setScreenerSortOrder(prev => prev === "desc" ? "asc" : "desc")}
                  >
                    {screenerSortOrder === "desc" ? "▲ Descending" : "▼ Ascending"}
                  </button>
                </div>

                {/* Screener Results Table */}
                {screenerLoading ? (
                  <div className="empty-state" style={{ height: "180px" }}>
                    <div className="pulse-dot" style={{ width: "12px", height: "12px" }} />
                    <p style={{ fontSize: "13px", color: "#8c9bb0", marginTop: "12px" }}>Querying factor models...</p>
                  </div>
                ) : screenerResults.length === 0 ? (
                  <div className="empty-state" style={{ height: "180px" }}>
                    <Info size={24} style={{ color: "var(--neon-amber)", marginBottom: "12px" }} />
                    <p style={{ fontSize: "13px", color: "#8c9bb0" }}>No stocks match your query limits.</p>
                  </div>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: "400px", overflowY: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Ticker &amp; Name</th>
                          <th>Sector</th>
                          <th className="mono" style={{ textAlign: "right" }}>Composite</th>
                          <th className="mono" style={{ textAlign: "right" }}>VAL</th>
                          <th className="mono" style={{ textAlign: "right" }}>MOM</th>
                          <th className="mono" style={{ textAlign: "right" }}>QLT</th>
                          <th className="mono" style={{ textAlign: "right" }}>GRW</th>
                          <th className="mono" style={{ textAlign: "right" }}>VOL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {screenerResults.map((s, idx) => (
                          <tr 
                            key={s.symbol + idx} 
                            style={{ transition: "background 0.2s", cursor: "pointer" }} 
                            className="screener-row"
                            onClick={() => setSelectedStock(s)}
                          >
                            <td>
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <span className="ticker-symbol" style={{ fontWeight: "bold" }}>{s.symbol}</span>
                                <span style={{ fontSize: "10px", color: "#8c9bb0" }}>{s.name}</span>
                              </div>
                            </td>
                            <td>
                              <span className="sector-badge">{s.sector}</span>
                            </td>
                            <td className="mono" style={{ textAlign: "right", fontWeight: "bold", color: "var(--neon-cyan)" }}>
                              {s.scores.composite.toFixed(1)}
                            </td>
                            <td className="mono" style={{ textAlign: "right", color: s.scores.value >= 70 ? "var(--neon-green)" : s.scores.value <= 30 ? "var(--neon-rose)" : "#fff" }}>
                              {s.scores.value.toFixed(0)}
                            </td>
                            <td className="mono" style={{ textAlign: "right", color: s.scores.momentum >= 70 ? "var(--neon-green)" : s.scores.momentum <= 30 ? "var(--neon-rose)" : "#fff" }}>
                              {s.scores.momentum.toFixed(0)}
                            </td>
                            <td className="mono" style={{ textAlign: "right", color: s.scores.quality >= 70 ? "var(--neon-green)" : s.scores.quality <= 30 ? "var(--neon-rose)" : "#fff" }}>
                              {s.scores.quality.toFixed(0)}
                            </td>
                            <td className="mono" style={{ textAlign: "right", color: s.scores.growth >= 70 ? "var(--neon-green)" : s.scores.growth <= 30 ? "var(--neon-rose)" : "#fff" }}>
                              {s.scores.growth.toFixed(0)}
                            </td>
                            <td className="mono" style={{ textAlign: "right", color: s.scores.lowVolatility >= 70 ? "var(--neon-green)" : s.scores.lowVolatility <= 30 ? "var(--neon-rose)" : "#fff" }}>
                              {s.scores.lowVolatility.toFixed(0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actionable Recommendations Panel */}
          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">
                <Layers size={14} style={{ color: "var(--neon-amber)" }} /> Pending Adaptive Rebalances
              </h3>
              <span className="mono" style={{ fontSize: 11, color: "var(--neon-amber)" }}>
                {pendingRecs.length} ACTIONABLE_TASKS
              </span>
            </div>

            {pendingRecs.length === 0 ? (
              <div className="empty-state">
                <Check size={24} style={{ color: "var(--neon-green)", marginBottom: 12 }} />
                <p style={{ fontSize: 13, color: "#8c9bb0" }}>All target weights matched. Portfolio balanced.</p>
              </div>
            ) : (
              <div className="recs-container">
                {pendingRecs.map((rec) => (
                  <div className="rec-ticket" key={rec.id}>
                    <div className="ticket-header-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ fontSize: 11, color: "#8c9bb0" }}>{rec.id}</span>
                        <span className={`badge-action ${rec.action.toLowerCase()}`}>{rec.action}</span>
                        <strong className="mono" style={{ fontSize: 14 }}>{rec.symbol}</strong>
                      </div>
                      <span className={`mono ${rec.action === "BUY" ? "val-gain" : "val-loss"}`} style={{ fontSize: "12px", fontWeight: "600" }}>
                        {rec.action === "BUY" 
                          ? `Under-allocated: +${Math.abs(rec.weightDrift).toFixed(1)}%` 
                          : `Over-allocated: -${Math.abs(rec.weightDrift).toFixed(1)}%`}
                      </span>
                    </div>
                    <p className="rec-desc">{rec.rationale}</p>
                    <div className="ticket-controls">
                      <button className="action-button approve" onClick={() => handleDecide(rec.id, "APPROVED")}>
                        <Check size={14} /> Approve Order
                      </button>
                      <button 
                        className="action-button" 
                        style={{ borderColor: "rgba(37, 211, 102, 0.3)", color: "#25D366" }}
                        onClick={() => handleCopyWhatsApp(rec)}
                      >
                        Copy for WhatsApp
                      </button>
                      <button className="action-button reject" onClick={() => handleDecide(rec.id, "REJECTED")}>
                        <X size={14} /> Skip Drift
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Sidebar Widgets */}
        <div className="right-sidebar">
          
          {/* Stock Analytics Profile (Conditional) */}
          {selectedStock && (
            <div className="glass-panel" style={{ borderColor: "var(--neon-cyan)", transition: "all 0.3s ease", marginBottom: "10px" }}>
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 className="panel-title" style={{ color: "var(--neon-cyan)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Cpu size={14} /> Stock Factor Analytics
                </h3>
                <button 
                  className="mode-btn" 
                  style={{ fontSize: "10px", padding: "2px 8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  onClick={() => setSelectedStock(null)}
                >
                  Close
                </button>
              </div>

              <div style={{ marginTop: "12px", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", paddingBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="mono" style={{ fontSize: "20px", fontWeight: "bold", color: "#fff" }}>{selectedStock.symbol}</span>
                  <span className="mono" style={{ fontSize: "16px", fontWeight: "bold", color: "var(--neon-cyan)" }}>
                    {selectedStock.scores.composite.toFixed(1)} Composite
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#8c9bb0", marginTop: "4px" }}>{selectedStock.name}</div>
                <div style={{ marginTop: "8px" }}>
                  <span className="sector-badge" style={{ background: "rgba(0,240,255,0.08)", color: "var(--neon-cyan)", border: "1px solid rgba(0,240,255,0.2)" }}>{selectedStock.sector}</span>
                </div>
              </div>

              {/* Factor Scores Grid */}
              <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <span className="mono" style={{ fontSize: "10px", color: "#8c9bb0" }}>FACTOR METRIC PROFILE:</span>
                
                {Object.entries({
                  Value: selectedStock.scores.value,
                  Momentum: selectedStock.scores.momentum,
                  Quality: selectedStock.scores.quality,
                  Growth: selectedStock.scores.growth,
                  "Low Volatility": selectedStock.scores.lowVolatility
                }).map(([label, val]) => (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                      <span style={{ color: "#8c9bb0" }}>{label}</span>
                      <span className="mono" style={{ color: val >= 70 ? "var(--neon-green)" : val <= 30 ? "var(--neon-rose)" : "#fff" }}>{val.toFixed(0)}</span>
                    </div>
                    <div className="factor-bar-bg" style={{ height: "4px" }}>
                      <div 
                        className="factor-bar-fill" 
                        style={{ 
                          width: `${val}%`, 
                          height: "100%", 
                          background: val >= 70 ? "var(--neon-green)" : val <= 30 ? "var(--neon-rose)" : "var(--neon-cyan)" 
                        }} 
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Fundamental Metrics Grid */}
              {selectedStock.fundamentals && (
                <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
                  <span className="mono" style={{ fontSize: "10px", color: "#8c9bb0", display: "block", marginBottom: "8px" }}>
                    QUARTERLY FUNDAMENTALS:
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ background: "rgba(255,255,255,0.02)", padding: "6px 8px", borderRadius: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#8c9bb0", display: "block" }}>P/E Ratio</span>
                      <span className="mono" style={{ fontSize: "12px", color: "#fff" }}>{selectedStock.fundamentals.peRatio?.toFixed(1) || "N/A"}</span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.02)", padding: "6px 8px", borderRadius: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#8c9bb0", display: "block" }}>P/B Ratio</span>
                      <span className="mono" style={{ fontSize: "12px", color: "#fff" }}>{selectedStock.fundamentals.pbRatio?.toFixed(1) || "N/A"}</span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.02)", padding: "6px 8px", borderRadius: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#8c9bb0", display: "block" }}>ROE</span>
                      <span className="mono" style={{ fontSize: "12px", color: "#fff" }}>{selectedStock.fundamentals.roe ? `${selectedStock.fundamentals.roe.toFixed(1)}%` : "N/A"}</span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.02)", padding: "6px 8px", borderRadius: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#8c9bb0", display: "block" }}>D/E Ratio</span>
                      <span className="mono" style={{ fontSize: "12px", color: "#fff" }}>{selectedStock.fundamentals.debtToEquity?.toFixed(2) || "N/A"}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Factor Profile */}
          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">
                <Activity size={14} style={{ color: "var(--neon-cyan)" }} /> Model Factor Profile
              </h3>
            </div>
            
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: "bold" }}>{modelPortfolio.name}</span>
                <span className="mono" style={{ color: "var(--neon-cyan)" }}>{modelPortfolio.compositeAvg} Index</span>
              </div>
            </div>

            {Object.entries(modelPortfolio.factors).map(([label, val]) => (
              <div className="factor-card" key={label}>
                <div className="factor-title-row">
                  <span style={{ fontSize: 12, textTransform: "capitalize", color: "#8c9bb0" }}>{label.replace("_", " ")}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{val}</span>
                </div>
                <div className="factor-bar-bg">
                  <div className="factor-bar-fill" style={{ width: `${val}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Market Intel */}
          {(() => {
            const regimeStyles = getRegimeStyles(marketRegime.regime);
            const confidenceOpacity = marketRegime.metadata ? Math.max(0.15, Math.min(0.65, marketRegime.metadata.vol_percentile)) : 0.35;
            return (
              <div className="glass-panel" style={{ transition: "all 0.3s ease" }}>
                <div className="panel-header">
                  <h3 className="panel-title">
                    <Sparkles size={14} style={{ color: regimeStyles.textColor }} /> Market Regime Sentinel
                  </h3>
                </div>
                <div 
                  className="intel-badge"
                  style={{
                    boxShadow: `0 0 20px rgba(${regimeStyles.shadowColor}, ${confidenceOpacity})`,
                    borderColor: regimeStyles.borderColor,
                    borderWidth: "1px",
                    borderStyle: "solid",
                    transition: "all 0.3s ease-in-out"
                  }}
                >
                  <div className="regime-status" style={{ color: regimeStyles.textColor, display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Cpu size={16} /> REGIME: {marketRegime.regime}
                    </span>
                    <span style={{ fontSize: "11px", opacity: 0.8, fontWeight: "normal", textTransform: "none" }}>
                      Status: {regimeStyles.label}
                    </span>
                  </div>
                  <p className="regime-text" style={{ fontSize: "12px", color: "#8c9bb0", margin: "8px 0 16px 0", lineHeight: "1.4" }}>
                    {marketRegime.interpretation}
                  </p>
                  
                  {/* Volatility & Volume Progress Meters */}
                  {marketRegime.metadata && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "12px" }}>
                      <div>
                        <div style={{ display: "flex", justifyItems: "center", justifyContent: "space-between", fontSize: "11px", color: "#8c9bb0", marginBottom: "4px" }}>
                          <span>Volatility Percentile</span>
                          <span className="mono">{(marketRegime.metadata.vol_percentile * 100).toFixed(0)}%</span>
                        </div>
                        <div className="factor-bar-bg" style={{ height: "4px" }}>
                          <div 
                            className="factor-bar-fill" 
                            style={{ 
                              width: `${marketRegime.metadata.vol_percentile * 100}%`,
                              height: "100%",
                              background: marketRegime.metadata.vol_percentile > 0.75 ? "var(--neon-rose)" : "var(--neon-cyan)"
                            }} 
                          />
                        </div>
                      </div>
                      
                      <div>
                        <div style={{ display: "flex", justifyItems: "center", justifyContent: "space-between", fontSize: "11px", color: "#8c9bb0", marginBottom: "4px" }}>
                          <span>Market Volume Participation</span>
                          <span className="mono">{(marketRegime.metadata.volume_ratio || 1.0).toFixed(2)}x</span>
                        </div>
                        <div className="factor-bar-bg" style={{ height: "4px" }}>
                          <div 
                            className="factor-bar-fill" 
                            style={{ 
                              width: `${Math.min(100, (marketRegime.metadata.volume_ratio || 1.0) * 50)}%`,
                              height: "100%",
                              background: (marketRegime.metadata.volume_ratio || 1.0) > 1.1 ? "var(--neon-green)" : "rgba(255, 255, 255, 0.15)"
                            }} 
                          />
                        </div>
                      </div>
                      
                      {/* Macro Context Overlay */}
                      {marketRegime.metadata.macro_context && (
                        <div style={{ marginTop: "6px", fontSize: "11px", borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: "8px" }}>
                          <span style={{ color: "var(--neon-amber)", fontWeight: "600", display: "block", marginBottom: "2px" }}>
                            Macro / Geopolitical Overlay:
                          </span>
                          <p style={{ color: "#7a8a9e", margin: 0, lineHeight: "1.3" }}>
                            {marketRegime.metadata.macro_context}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Decision Logs */}
          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">
                <ArrowRightLeft size={14} style={{ color: "#8c9bb0" }} /> Transaction Audit
              </h3>
            </div>

            {recs.filter(r => r.status !== "PENDING").length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>No transactions logged this session.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {recs
                  .filter(r => r.status !== "PENDING")
                  .map((r, i) => (
                    <div key={r.id + i} style={{ display: "flex", justifyItems: "center", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.02)" }} className="mono">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Circle size={6} fill={r.status === "APPROVED" ? "var(--neon-green)" : "var(--neon-rose)"} color="transparent" />
                        <span style={{ color: "#8c9bb0" }}>{r.id}</span>
                        <span>{r.symbol}</span>
                      </div>
                      <span style={{ color: r.status === "APPROVED" ? "var(--neon-green)" : "var(--neon-rose)", fontWeight: "bold" }}>
                        {r.status}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {toast && (
        <div className="hq-toast">
          <Info size={14} style={{ color: "var(--neon-cyan)" }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
