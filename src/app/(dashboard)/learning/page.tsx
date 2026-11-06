import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { LearningWorkspace } from "@/components/learning/learning-workspace";

export const metadata: Metadata = { title: "Learning" };

export default async function LearningPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Learning"
        description="The app teaches itself from market history every day: what it learned, how well that held up on data it never saw, how its views changed, and how it uses them to assess coins."
      />
      <LearningWorkspace />
    </>
  );
}
