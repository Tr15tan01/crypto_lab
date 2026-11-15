import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { StrategyLab } from "@/components/strategies/strategy-lab";

export const metadata: Metadata = { title: "Strategies" };

export default async function StrategiesPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Strategies"
        description="Ten complete strategies (entry and exit rules) replayed on real history: what each one earned, when it worked, and which coins trigger it today."
      />
      <StrategyLab />
    </>
  );
}
