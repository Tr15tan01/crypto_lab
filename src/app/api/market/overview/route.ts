import { withApi } from "@/lib/api/handler";
import { marketData } from "@/services/binance";
import { buildOverview } from "@/services/market/overview";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const res = await marketData().allTickers();
  return {
    overview: buildOverview(res.data, "USDT"),
    fetchedAt: new Date(res.fetchedAt).toISOString(),
    stale: res.stale,
  };
});
