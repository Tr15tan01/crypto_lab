import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { TradersWorkspace } from "@/components/traders/traders-workspace";

export const metadata: Metadata = { title: "Top Traders" };

export default async function TradersPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Top Traders"
        description="See what successful traders buy and sell: returns, drawdown, entries and exits, holding times, and whether their strategy is changing."
      />
      <TradersWorkspace />
    </>
  );
}
