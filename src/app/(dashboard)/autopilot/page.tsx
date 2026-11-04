import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { AutopilotWorkspace } from "@/components/autopilot/autopilot-workspace";

export const metadata: Metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Autopilot"
        description="What to buy, what to sell, when and how much — a plan for your paper portfolio built from market scans, futures positioning, order books and top traders."
      />
      <AutopilotWorkspace />
    </>
  );
}
