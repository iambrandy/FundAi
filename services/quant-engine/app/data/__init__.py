"""
Data Module
===========
Market data fetching and caching utilities.
"""

from app.data.market_data_fetcher import (
    MarketDataFetcher,
    download_nifty_historical,
    download_nifty50_universe,
)

__all__ = [
    "MarketDataFetcher",
    "download_nifty_historical",
    "download_nifty50_universe",
]
