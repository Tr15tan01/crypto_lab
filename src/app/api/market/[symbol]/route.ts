import { withApi } from "@/lib/api/handler";
import { getSymbolOverview } from "@/services/market/symbol";
import { normalizeSymbol } from "@/services/binance";

export const dynamic = "force-dynamic";

export const GET = withApi<{ symbol: string }>(async ({ params }) => {
  return getSymbolOverview(normalizeSymbol(params.symbol));
});
