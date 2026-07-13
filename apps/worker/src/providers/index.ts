import { MarketDataProvider } from "./MarketDataProvider";
import { SyntheticProvider } from "./SyntheticProvider";
import { QuantEngineProvider } from "./QuantEngineProvider";


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
  const isProduction = process.env.NODE_ENV === "production";
  const defaultProvider = isProduction ? "quant-engine" : "synthetic";
  const kind = process.env.MARKET_DATA_PROVIDER ?? defaultProvider;
  
  if (isProduction && kind === "synthetic") {
    throw new Error(
      "Configuration Error: Synthetic market data provider cannot be used in production. Please set MARKET_DATA_PROVIDER to a valid production provider (e.g. 'quant-engine')."
    );
  }

  switch (kind) {
    case "synthetic":
      return new SyntheticProvider();
    case "quant-engine":
      return new QuantEngineProvider();
    default:
      throw new Error(
        `Unknown MARKET_DATA_PROVIDER "${kind}". Add a provider implementation and register it in getMarketDataProvider().`
      );
  }
}
