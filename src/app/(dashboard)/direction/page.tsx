import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { DirectionWorkspace } from "@/components/direction/direction-workspace";

export const metadata: Metadata = { title: "Market Direction" };

export default async function DirectionPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Market Direction"
        description="Which way the crypto market is leaning right now, what that reading is made of, and what happened after readings like it."
      />
      <DirectionWorkspace />
    </>
  );
}
