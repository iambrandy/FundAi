import { MarketDataProvider } from "./MarketDataProvider";
import { SyntheticProvider } from "./SyntheticProvider";

/**
 * Add real vendor providers here as they're implemented, e.g.:
 *   import { KiteConnectProvider } from "./KiteConnectProvider";
 *   case "kite": return new KiteConnectProvider(process.env.KITE_API_KEY!, process.env.KITE_API_SECRET!);
 *
 * Selection is entirely env-driven so switching vendors, or falling back to
 * synthetic in a dev environment with no API keys configured, never touches
 * job code.
 */
export function getMarketDataProvider(): MarketDataProvider {
  const kind = process.env.MARKET_DATA_PROVIDER ?? "synthetic";

  switch (kind) {
    case "synthetic":
      return new SyntheticProvider();
    // case "kite": return new KiteConnectProvider(...);
    // case "alpha_vantage": return new AlphaVantageProvider(...);
    default:
      throw new Error(
        `Unknown MARKET_DATA_PROVIDER "${kind}". Add a provider implementation and register it in getMarketDataProvider().`
      );
  }
}
