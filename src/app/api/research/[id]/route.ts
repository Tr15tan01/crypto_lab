import { withApi, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { getResearch } from "@/services/research/research-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async ({ user, params }) =>
  serialize(await getResearch(user.id, parseWith(idSchema, params.id))),
);
