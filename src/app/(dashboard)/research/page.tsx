import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { getAIStatus } from "@/services/ai/providers/factory";
import { PageHeader } from "@/components/layout/page-header";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { Badge } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "AI Research" };

export default async function ResearchPage() {
  await requireUser();
  const ai = getAIStatus();
  return (
    <>
      <PageHeader
        title="AI Research"
        description="A forecasting assistant grounded in Binance data and your own records. It gives probability-weighted calls with levels, and every call is scored against real prices afterwards. Not financial advice."
        actions={
          ai.configured ? (
            <Badge tone="neutral">
              {ai.provider} · {ai.model}
            </Badge>
          ) : (
            <Badge tone="down">AI not configured</Badge>
          )
        }
      />
      <Suspense>
        <ChatWorkspace aiConfigured={ai.configured} aiProblem={ai.problems.join("; ") || null} />
      </Suspense>
    </>
  );
}
