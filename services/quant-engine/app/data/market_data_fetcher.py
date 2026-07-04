"""
Market Data Fetcher
===================
Production-grade data fetching for real Indian market data.

Supports multiple data sources:
1. Yahoo Finance (free, 15-min delay)
2. NSE India (official but rate-limited)
3. Alpha Vantage (paid API)
4. Local CSV files (for backtesting)

Usage:
    fetcher = MarketDataFetcher(source="yahoo")
    nifty_data = fetcher.get_index_history("^NSEI", start_date="2020-01-01")
    stock_data = fetcher.get_stock_history("RELIANCE.NS", start_date="2020-01-01")
"""

from __future__ import annotations
from typing import Optional, Literal
import pandas as pd
import requests
from datetime import datetime, timedelta
import time
from pathlib import Path


DataSource = Literal["yahoo", "nse", "alpha_vantage", "csv"]


class MarketDataFetcher:
    """Unified interface for fetching Indian market data"""
    
    def __init__(
        self,
        source: DataSource = "yahoo",
        api_key: Optional[str] = None,
        cache_dir: Optional[str] = None,
    ):
        self.source = source
        self.api_key = api_key
        self.cache_dir = Path(cache_dir) if cache_dir else Path("./cache")
        self.cache_dir.mkdir(exist_ok=True)
        
        # Rate limiting
        self.last_request_time = 0
        self.min_request_interval = 0.5  # 500ms between requests
    
    def _rate_limit(self):
        """Ensure we don't hit API rate limits"""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self.last_request_time = time.time()
    
    def _get_cache_path(self, symbol: str, start_date: str, end_date: str) -> Path:
        """Generate cache file path"""
        return self.cache_dir / f"{symbol}_{start_date}_{end_date}.csv"
    
    def _load_from_cache(self, symbol: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """Try to load from cache"""
        cache_path = self._get_cache_path(symbol, start_date, end_date)
        if cache_path.exists():
            # Check if cache is fresh (< 1 day old for historical data)
            cache_age = time.time() - cache_path.stat().st_mtime
            if cache_age < 86400:  # 24 hours
                try:
                    df = pd.read_csv(cache_path, parse_dates=['date'])
                    return df
                except Exception:
                    pass
        return None
    
    def _save_to_cache(self, df: pd.DataFrame, symbol: str, start_date: str, end_date: str):
        """Save to cache"""
        cache_path = self._get_cache_path(symbol, start_date, end_date)
        df.to_csv(cache_path, index=False)
    
    def get_index_history(
        self,
        symbol: str = "^NSEI",  # Nifty 50
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get historical index data.
        
        Args:
            symbol: Yahoo Finance symbol (^NSEI = Nifty 50, ^NSEBANK = Bank Nifty)
            start_date: YYYY-MM-DD format (default: 3 years ago)
            end_date: YYYY-MM-DD format (default: today)
        
        Returns:
            DataFrame with columns: date, open, high, low, close, volume
        """
        if not start_date:
            start_date = (datetime.now() - timedelta(days=365*3)).strftime("%Y-%m-%d")
        if not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
        
        # Try cache first
        cached = self._load_from_cache(symbol, start_date, end_date)
        if cached is not None:
            return cached
        
        if self.source == "yahoo":
            df = self._fetch_yahoo(symbol, start_date, end_date)
        elif self.source == "csv":
            df = self._fetch_csv(symbol)
        else:
            raise NotImplementedError(f"Source '{self.source}' not yet implemented")
        
        # Save to cache
        self._save_to_cache(df, symbol, start_date, end_date)
        
        return df
    
    def get_stock_history(
        self,
        symbol: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get historical stock data.
        
        Args:
            symbol: Yahoo Finance symbol (e.g., "RELIANCE.NS", "TCS.NS")
            start_date: YYYY-MM-DD format
            end_date: YYYY-MM-DD format
        
        Returns:
            DataFrame with columns: date, open, high, low, close, volume
        """
        # Add .NS suffix if not present (NSE stocks on Yahoo Finance)
        if not symbol.startswith("^") and not symbol.endswith(".NS"):
            symbol = f"{symbol}.NS"
        
        return self.get_index_history(symbol, start_date, end_date)
    
    def _fetch_yahoo(self, symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
        """
        Fetch from Yahoo Finance using yfinance library.
        This is the most reliable free source for Indian market data.
        """
        try:
            import yfinance as yf
        except ImportError:
            raise ImportError(
                "yfinance not installed. Install with: pip install yfinance"
            )
        
        self._rate_limit()
        
        # Download data
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start_date, end=end_date)
        
        if df.empty:
            raise ValueError(f"No data returned for {symbol}")
        
        # Standardize column names
        df = df.reset_index()
        df.columns = df.columns.str.lower()
        
        # Select and rename columns
        df = df.rename(columns={'index': 'date'})[['date', 'open', 'high', 'low', 'close', 'volume']]
        df['date'] = pd.to_datetime(df['date']).dt.date
        
        return df
    
    def _fetch_csv(self, symbol: str) -> pd.DataFrame:
        """Load from local CSV file (for backtesting with pre-downloaded data)"""
        csv_path = self.cache_dir / f"{symbol}.csv"
        if not csv_path.exists():
            raise FileNotFoundError(f"CSV file not found: {csv_path}")
        
        df = pd.read_csv(csv_path, parse_dates=['date'])
        return df[['date', 'open', 'high', 'low', 'close', 'volume']]
    
    def get_nifty50_constituents(self) -> list[str]:
        """
        Get current Nifty 50 constituent symbols.
        
        Returns list of Yahoo Finance symbols (with .NS suffix)
        """
        # Hardcoded list as of 2024 - in production, scrape from NSE website
        constituents = [
            "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
            "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
            "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "HCLTECH",
            "BAJFINANCE", "SUNPHARMA", "TITAN", "WIPRO", "ULTRACEMCO",
            "NESTLEIND", "ONGC", "NTPC", "TATAMOTORS", "POWERGRID",
            "M&M", "TECHM", "BAJAJFINSV", "ADANIPORTS", "COALINDIA",
            "DRREDDY", "INDUSINDBK", "TATASTEEL", "GRASIM", "CIPLA",
            "HINDALCO", "JSWSTEEL", "BRITANNIA", "DIVISLAB", "EICHERMOT",
            "APOLLOHOSP", "SHREECEM", "UPL", "BAJAJ-AUTO", "SBILIFE",
            "HDFCLIFE", "ADANIENT", "HEROMOTOCO", "TATACONSUM", "BPCL",
        ]
        return [f"{s}.NS" for s in constituents]
    
    def bulk_download_stocks(
        self,
        symbols: list[str],
        start_date: str,
        end_date: str,
        progress: bool = True,
    ) -> dict[str, pd.DataFrame]:
        """
        Download multiple stocks efficiently with progress tracking.
        
        Args:
            symbols: List of symbols to download
            start_date: Start date YYYY-MM-DD
            end_date: End date YYYY-MM-DD
            progress: Show progress bar (requires tqdm)
        
        Returns:
            Dict mapping symbol to DataFrame
        """
        results = {}
        
        if progress:
            try:
                from tqdm import tqdm
                iterator = tqdm(symbols, desc="Downloading stocks")
            except ImportError:
                iterator = symbols
        else:
            iterator = symbols
        
        for symbol in iterator:
            try:
                df = self.get_stock_history(symbol, start_date, end_date)
                results[symbol] = df
            except Exception as e:
                print(f"Failed to download {symbol}: {e}")
                continue
        
        return results


def download_nifty_historical(years: int = 10) -> pd.DataFrame:
    """
    Convenience function: Download Nifty 50 historical data.
    
    Usage:
        nifty = download_nifty_historical(years=10)
    """
    fetcher = MarketDataFetcher(source="yahoo")
    start_date = (datetime.now() - timedelta(days=365*years)).strftime("%Y-%m-%d")
    return fetcher.get_index_history("^NSEI", start_date=start_date)


def download_nifty50_universe(years: int = 3) -> dict[str, pd.DataFrame]:
    """
    Convenience function: Download all Nifty 50 stocks.
    
    Usage:
        stocks = download_nifty50_universe(years=3)
        reliance = stocks["RELIANCE.NS"]
    """
    fetcher = MarketDataFetcher(source="yahoo")
    symbols = fetcher.get_nifty50_constituents()
    start_date = (datetime.now() - timedelta(days=365*years)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    
    return fetcher.bulk_download_stocks(symbols, start_date, end_date, progress=True)


if __name__ == "__main__":
    # Demo usage
    print("Downloading Nifty 50 historical data...")
    nifty = download_nifty_historical(years=5)
    print(f"Downloaded {len(nifty)} days of Nifty 50 data")
    print(nifty.tail())
    
    print("\nDownloading sample stocks...")
    fetcher = MarketDataFetcher(source="yahoo")
    reliance = fetcher.get_stock_history("RELIANCE.NS", start_date="2023-01-01")
    print(f"Downloaded {len(reliance)} days of RELIANCE data")
    print(reliance.tail())
