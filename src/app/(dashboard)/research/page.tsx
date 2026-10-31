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
        description="A research assistant grounded in Binance data and your own records. It separates facts from assumptions and never presents predictions as facts."
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
