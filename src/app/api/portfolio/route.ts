import { withApi } from "@/lib/api/handler";
import { getPortfolioState } from "@/services/portfolio/portfolio-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ user }) => serialize(await getPortfolioState(user.id)));
