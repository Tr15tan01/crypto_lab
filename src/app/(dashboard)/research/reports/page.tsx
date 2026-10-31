import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { listResearch } from "@/services/research/research-service";
import { serialize } from "@/types/serialized";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { BiasBadge, OutcomeChips, type ResearchListItem } from "@/components/research/research-panel";
import { formatDateTime, formatPrice } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Analysis reports" };

export default async function ReportsPage() {
  const user = await requireUser();
  const res = await safe(() => listResearch(user.id, { limit: 200 }), "reports.page");
  const items = res.data ? (serialize(res.data) as unknown as ResearchListItem[]) : [];
  return (
    <>
      <Link href="/research" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" /> AI Research
      </Link>
      <PageHeader
        title="Analysis reports"
        description="Every structured AI report, with the price at the time and how its stated lean held up at 1h, 24h, 7d and 30d. Generate new reports from a coin's page."
      />
      <Panel>
        {!res.data ? (
          <EmptyState title="Reports could not be loaded" description={res.error ?? undefined} />
        ) : items.length === 0 ? (
          <EmptyState title="No reports yet" description="Open any coin and choose “Generate analysis”." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Generated</th>
                  <th className="px-3 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 font-medium">Lean</th>
                  <th className="px-3 py-2 text-right font-medium">Price then</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Outcomes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r._id} className="border-b border-border/70 last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/research/reports/${r._id}`} className="hover:text-accent">{formatDateTime(r.timestamp)}</Link>
                    </td>
                    <td className="px-3 py-2"><Link href={`/crypto/${r.symbol}`} className="hover:text-accent">{r.symbol}</Link></td>
                    <td className="px-3 py-2"><BiasBadge bias={r.bias} /></td>
                    <td className="num px-3 py-2 text-right">{formatPrice(r.priceAtAnalysis)}</td>
                    <td className="px-3 py-2 text-xs text-muted">{r.provider} · {r.model}</td>
                    <td className="px-4 py-2"><OutcomeChips evaluations={r.evaluations} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
