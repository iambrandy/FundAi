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

from app.scoring.factor_scoring import compute_factor_scores, generate_rationale, FactorWeights
from app.portfolio.construction import construct_model_portfolio, ConstructionConstraints, diff_against_current_holdings
from app.scoring.regime_detection import detect_market_regime, MarketRegime

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
    
    return scored.to_dict(orient="records")


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
    return result.to_dict(orient="records")
