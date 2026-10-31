import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { MarketScanner } from "@/components/market/market-scanner";

export const metadata: Metadata = { title: "Market Scanner" };

export default function MarketPage() {
  return (
    <>
      <PageHeader
        title="Market Scanner"
        description="Every pair currently tradable on Binance Spot. Click a pair for charts, indicators and simulated trading."
      />
      <MarketScanner />
    </>
  );
}
