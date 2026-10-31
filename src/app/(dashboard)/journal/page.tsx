import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { listJournal } from "@/services/journal/journal-service";
import { serialize } from "@/types/serialized";
import type { DecisionType } from "@/models";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import { Freshness } from "@/components/market/indicators";
import { JournalEntryCard, type JournalRowData } from "@/components/journal/journal-entry";
import { NewJournalEntryDialog } from "@/components/journal/new-entry-dialog";
import { cn } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Decision Journal" };

const TYPES: Array<DecisionType | "ALL"> = ["ALL", "BUY", "SELL", "HOLD", "WATCH", "SKIP"];

export default async function JournalPage({ searchParams }: PageProps<"/journal">) {
  const user = await requireUser();
  const sp = await searchParams;
  const symbol = typeof sp.symbol === "string" && /^[A-Z0-9]{2,20}$/.test(sp.symbol) ? sp.symbol : undefined;
  const typeParam = typeof sp.type === "string" ? sp.type.toUpperCase() : "ALL";
  const decisionType = (TYPES.includes(typeParam as DecisionType) && typeParam !== "ALL" ? typeParam : undefined) as DecisionType | undefined;

  const res = await safe(() => listJournal(user.id, { symbol, decisionType, limit: 300 }), "journal.page");
  const rows = res.data ? (serialize(res.data.rows) as unknown as JournalRowData[]) : [];
  const reviewed = rows.filter((r) => r.entry.outcome).length;

  const href = (t: string) => {
    const q = new URLSearchParams();
    if (symbol) q.set("symbol", symbol);
    if (t !== "ALL") q.set("type", t);
    const s = q.toString();
    return s ? `/journal?${s}` : "/journal";
  };

  return (
    <>
      <PageHeader
        title="Decision Journal"
        description="Your reasoning at the moment of each decision, and how it turned out. Entries are never silently rewritten — edits and reviews are kept as history."
        actions={<NewJournalEntryDialog defaultSymbol={symbol} />}
      />
      <Panel>
        <PanelHeader
          title={`${rows.length} decision${rows.length === 1 ? "" : "s"}${symbol ? ` on ${symbol}` : ""}`}
          description={`${reviewed} reviewed · prices compared with the latest Binance data`}
          actions={
            <>
              {res.data ? <Freshness fetchedAt={res.data.pricesFetchedAt} stale={res.data.stale} /> : null}
              {symbol ? (
                <Link href="/journal" className="text-xs text-muted hover:text-fg">
                  Clear {symbol}
                </Link>
              ) : null}
            </>
          }
        />
        <nav aria-label="Filter by decision" className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {TYPES.map((t) => (
            <Link
              key={t}
              href={href(t)}
              aria-current={(decisionType ?? "ALL") === t ? "page" : undefined}
              className={cn(
                "rounded-sm px-2 py-1 text-xs",
                (decisionType ?? "ALL") === t ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t === "ALL" ? "All" : t[0] + t.slice(1).toLowerCase()}
            </Link>
          ))}
        </nav>
        {!res.data ? (
          <EmptyState title="The journal could not be loaded" description={res.error ?? undefined} />
        ) : rows.length === 0 ? (
          <EmptyState title="No decisions yet" description="Simulated trades are logged automatically. Record holds and skipped opportunities here too — they matter for evaluating your judgement." />
        ) : (
          rows.map((row) => <JournalEntryCard key={row.entry._id} row={row} />)
        )}
      </Panel>
    </>
  );
}
