import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getAIStatus } from "@/services/ai/providers/factory";
import { PageHeader } from "@/components/layout/page-header";
import { DiscoveryWorkspace } from "@/components/discovery/discovery-workspace";

export const metadata: Metadata = { title: "Discovery" };

export default async function DiscoverPage() {
  await requireUser();
  const ai = getAIStatus();
  return (
    <>
      <PageHeader
        title="Discovery"
        description="Screens for coins showing early signs of interest: new listings, unusual volume, strength against Bitcoin and trend changes. A starting point for research, not a buy list."
      />
      <DiscoveryWorkspace aiConfigured={ai.configured} aiProblem={ai.problems.join("; ") || null} />
    </>
  );
}
