import { withApi } from "@/lib/api/handler";
import { getAIStatus } from "@/services/ai/providers/factory";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => getAIStatus());
