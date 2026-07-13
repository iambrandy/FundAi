"""
Quant Engine API
================
Internal-only FastAPI service. Called by the Node/Express backend — never
exposed directly to the internet. Auth is a shared internal service token,
not user-facing JWTs.
"""

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import pandas as pd
import os
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

from app.scoring.factor_scoring import compute_factor_scores, generate_rationale, FactorWeights
from app.portfolio.construction import construct_model_portfolio, ConstructionConstraints, diff_against_current_holdings
from app.scoring.regime_detection import detect_market_regime, MarketRegime, get_geopolitical_macro_context
from app.data.providers import get_provider
from app.data.macro_events import MacroEventStore

app = FastAPI(title="FundAI Quant Engine", version="0.2.0")

INTERNAL_SERVICE_TOKEN = os.environ.get("INTERNAL_SERVICE_TOKEN", "")


def verify_internal_token(x_internal_token: str = Header(default="")):
    if not INTERNAL_SERVICE_TOKEN or x_internal_token != INTERNAL_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized: invalid internal service token")


class StockInput(BaseModel):
    stock_id: str
    symbol: str
    sector: str
    pe_ratio: float | None = None
    pb_ratio: float | None = None
    roe: float | None = None
    debt_to_equity: float | None = None
    eps_growth_yoy: float | None = None
    revenue_growth_yoy: float | None = None
    return_6m: float | None = None
    return_12m: float | None = None


class PriceHistoryInput(BaseModel):
    """Price history for low volatility factor calculation"""
    stock_id: str
    dates: list[str]  # ISO dates
    closes: list[float]


class IndexPriceInput(BaseModel):
    """Index (e.g., Nifty 50) price history for beta calculation and regime detection"""
    dates: list[str]
    closes: list[float]


class ScoreRequest(BaseModel):
    universe: list[StockInput]
    sector_neutral: bool = True
    price_history: list[PriceHistoryInput] | None = None  # NEW
    index_prices: IndexPriceInput | None = None  # NEW
    use_regime_weights: bool = True  # NEW


class ConstructRequest(BaseModel):
    scored_universe: list[dict]  # output of /score, as dicts
    max_position_weight_pct: float = 8.0
    max_sector_weight_pct: float = 25.0
    min_positions: int = 15
    max_positions: int = 30
    min_composite_score: float = 55.0


class RegimeDetectionRequest(BaseModel):
    """Request to detect current market regime"""
    index_prices: IndexPriceInput


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.2.0"}


@app.get("/data-health")
def data_health():
    """
    Connectivity probe for the market data provider.
    Returns a structured dict: {ok, latency_ms, error}.
    Safe to call frequently — fetches a single ^NSEI quote.
    """
    provider = get_provider()
    return provider.health_check()


@app.post("/refresh-macro-events")
def refresh_macro_events(x_internal_token: str = Header(default="")):
    """
    Seed the macro event store (idempotent) and run a staleness check.
    Called weekly by the BullMQ refreshMacroEvents job.
    Returns any staleness warnings so the job can write them to SystemEvent.
    """
    verify_internal_token(x_internal_token)
    store = MacroEventStore()
    seeded = store.seed_from_hardcoded()
    warnings = store.check_staleness(threshold_days=90)
    return {
        "seeded_events": seeded,
        "staleness_warnings": warnings,
        "warning_count": len(warnings),
    }


@app.post("/detect-regime")
def detect_regime_endpoint(req: RegimeDetectionRequest, x_internal_token: str = Header(default="")):
    """
    Detect current market regime from index price history.
    Useful for advisors to understand market context before reviewing recommendations.
    """
    verify_internal_token(x_internal_token)
    
    if len(req.index_prices.dates) < 200:
        raise HTTPException(400, "Need at least 200 days of index history for regime detection")
    
    index_df = pd.DataFrame({
        'date': pd.to_datetime(req.index_prices.dates),
        'close': req.index_prices.closes,
    })
    
    regime, metadata = detect_market_regime(index_df)
    
    return {
        "regime": regime.value,
        "metadata": metadata,
        "interpretation": {
            "BULL": "Strong uptrend - favor momentum and growth stocks",
            "BEAR": "Downtrend - favor quality, low volatility, and value",
            "HIGH_VOLATILITY": "Uncertain market - emphasize quality and defensive positioning",
            "SIDEWAYS": "Range-bound - favor value and quality",
        }[regime.value]
    }


@app.post("/score")
def score_universe(req: ScoreRequest, x_internal_token: str = Header(default="")):
    verify_internal_token(x_internal_token)
    if len(req.universe) < 10:
        raise HTTPException(400, "Universe too small for meaningful cross-sectional scoring (need >= 10 stocks)")

    df = pd.DataFrame([s.model_dump() for s in req.universe])
    
    # Prepare price history if provided
    price_history_df = None
    if req.price_history:
        # Convert list of PriceHistoryInput to wide DataFrame (columns=stock_ids, index=dates)
        price_data = {}
        for stock_history in req.price_history:
            stock_df = pd.DataFrame({
                'date': pd.to_datetime(stock_history.dates),
                'close': stock_history.closes,
            }).set_index('date')
            price_data[stock_history.stock_id] = stock_df['close']
        
        if price_data:
            price_history_df = pd.DataFrame(price_data)
    
    # Prepare index prices if provided
    index_prices_series = None
    if req.index_prices:
        index_prices_series = pd.Series(
            req.index_prices.closes,
            index=pd.to_datetime(req.index_prices.dates),
        )
    
    scored = compute_factor_scores(
        df,
        sector_neutral=req.sector_neutral,
        price_history=price_history_df,
        index_prices=index_prices_series,
        regime=None,  # Auto-detect from index_prices
        use_regime_weights=req.use_regime_weights,
    )

    scored["rationale"] = scored.apply(generate_rationale, axis=1)

    # --- Build batch-level run_metadata ---
    # macro_context is date-based, not stock-based. Computed once here,
    # broadcast to all recommendations from this run via factorSnapshot.
    scoring_date = str(index_prices_series.index[-1].date()) if index_prices_series is not None else ""
    regime_used = scored["regime_used"].iloc[0] if "regime_used" in scored.columns else "UNKNOWN"
    macro_context = get_geopolitical_macro_context(
        index_prices_series.index[-1] if index_prices_series is not None else None
    )

    from datetime import datetime, timezone
    run_metadata = {
        "scoring_date": scoring_date,
        "regime": regime_used,
        "macro_context": macro_context,
        "macro_context_date": datetime.now(timezone.utc).isoformat(),
    }

    # Convert DataFrame to records, then recursively clean NaN/inf values to None
    records = scored.to_dict(orient="records")
    return {
        "scored_stocks": sanitize_nans(records),
        "run_metadata": run_metadata,
    }


@app.post("/construct-portfolio")
def construct_portfolio(req: ConstructRequest, x_internal_token: str = Header(default="")):
    verify_internal_token(x_internal_token)
    df = pd.DataFrame(req.scored_universe)
    constraints = ConstructionConstraints(
        max_position_weight_pct=req.max_position_weight_pct,
        max_sector_weight_pct=req.max_sector_weight_pct,
        min_positions=req.min_positions,
        max_positions=req.max_positions,
        min_composite_score=req.min_composite_score,
    )
    try:
        result = construct_model_portfolio(df, constraints)
    except ValueError as e:
        raise HTTPException(400, str(e))
    records = result.to_dict(orient="records")
    return sanitize_nans(records)


def sanitize_nans(obj):
    import math
    if isinstance(obj, list):
        return [sanitize_nans(x) for x in obj]
    elif isinstance(obj, dict):
        return {k: sanitize_nans(v) for k, v in obj.items()}
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


class DailyBarsRequest(BaseModel):
    symbol: str
    start_date: str
    end_date: str


class FundamentalsRequest(BaseModel):
    symbol: str


@app.post("/get-daily-bars")
def get_daily_bars_endpoint(req: DailyBarsRequest, x_internal_token: str = Header(default="")):
    verify_internal_token(x_internal_token)
    provider = get_provider()
    try:
        df = provider.get_daily_bars(req.symbol, req.start_date, req.end_date)
        # Convert date column to string format for JSON serialization
        df_json = df.copy()
        df_json['date'] = df_json['date'].astype(str)
        records = df_json.to_dict(orient="records")
        return sanitize_nans(records)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/get-fundamentals")
def get_fundamentals_endpoint(req: FundamentalsRequest, x_internal_token: str = Header(default="")):
    verify_internal_token(x_internal_token)
    provider = get_provider()
    try:
        data = provider.get_fundamentals(req.symbol)
        if data is None:
            raise HTTPException(status_code=404, detail=f"Fundamentals not found for {req.symbol}")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

