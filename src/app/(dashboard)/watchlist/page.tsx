import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { listWatchlist } from "@/services/watchlist/watchlist-service";
import { listAlerts } from "@/services/alerts/alerts-service";
import { serialize } from "@/types/serialized";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import { WatchlistView } from "@/components/watchlist/watchlist-view";
import { AlertsPanel, type AlertItem } from "@/components/alerts/alerts-panel";

export const metadata: Metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  const user = await requireUser();
  const [watch, alerts] = await Promise.all([
    safe(() => listWatchlist(user.id, { includeRemoved: true }), "watchlist.page"),
    safe(() => listAlerts(user.id), "watchlist.alerts"),
  ]);

  return (
    <>
      <PageHeader
        title="Watchlist"
        description="Coins you are tracking, why you are tracking them, and how they have moved since you started."
      />
      {watch.data ? (
        <WatchlistView initial={watch.data} />
      ) : (
        <Panel>
          <EmptyState title="The watchlist could not be loaded" description={watch.error} />
        </Panel>
      )}
      <Panel className="mt-4" id="alerts">
        <PanelHeader
          title="All price alerts"
          description="Create alerts from a coin's page. Alerts fire once, from live Binance prices only, and appear under the bell icon."
        />
        {alerts.data ? (
          <AlertsPanel alerts={serialize(alerts.data) as AlertItem[]} showSymbol />
        ) : (
          <EmptyState title="Alerts could not be loaded" description={alerts.error} />
        )}
      </Panel>
    </>
  );
}
