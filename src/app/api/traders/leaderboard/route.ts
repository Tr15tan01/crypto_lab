import { withApi } from "@/lib/api/handler";
import { getLeaderboard } from "@/services/traders/trader-service";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const range = q.get("range");
  const sort = q.get("sort");
  return getLeaderboard(
    user.id,
    range === "7D" || range === "90D" ? range : "30D",
    sort === "PNL" ? "PNL" : "ROI",
  );
});
