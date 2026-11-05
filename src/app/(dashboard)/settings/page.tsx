import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { appEnv } from "@/lib/env";
import { getCollections } from "@/lib/mongodb/collections";
import { googleAuthEnabled } from "@/lib/auth/auth";
import { getActivePortfolio } from "@/services/portfolio/portfolio-service";
import { getUserSettings } from "@/services/settings/settings-service";
import { getAIStatus } from "@/services/ai/providers/factory";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { AlertIntervalForm, FeeSettingsForm, ResetPortfolioForm } from "@/components/settings/settings-forms";
import { TextSizeForm } from "@/components/settings/text-size-form";
import { formatDateTime, formatUsd } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2 text-xs last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const [portfolioRes, settingsRes, jobsRes, archivedRes] = await Promise.all([
    safe(() => getActivePortfolio(user.id), "settings.portfolio"),
    safe(() => getUserSettings(user.id), "settings.user"),
    safe(async () => (await getCollections()).jobState.find({ _id: { $regex: /^cron:/ } }).toArray(), "settings.jobs"),
    safe(async () => (await getCollections()).portfolios.countDocuments({ userId: user.id, status: "archived" }), "settings.archived"),
  ]);
  const ai = getAIStatus();
  let env: ReturnType<typeof appEnv> | null = null;
  try {
    env = appEnv();
  } catch {
    env = null;
  }
  const p = portfolioRes.data;

  return (
    <>
      <PageHeader title="Settings" description="Display, paper-portfolio configuration, alerts, and the status of external services." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Display" description="Text size for the whole app. Light/dark theme is in the top bar." />
          <PanelBody>
            <TextSizeForm />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Paper portfolio" description="Theoretical funds only — nothing here touches Binance." />
          <PanelBody className="space-y-5">
            {p ? (
              <>
                <div>
                  <Row label="Started">{formatDateTime(p.createdAt)}</Row>
                  <Row label="Starting balance">{formatUsd(p.initialBalance)} {p.quoteAsset}</Row>
                  <Row label="Available cash">{formatUsd(p.availableBalance)}</Row>
                  <Row label="Accounting method">Average cost basis (fees included in cost)</Row>
                  <Row label="Archived portfolios">{archivedRes.data ?? "—"}</Row>
                </div>
                <FeeSettingsForm enabled={p.feeConfiguration.enabled} ratePercent={p.feeConfiguration.ratePercent} />
              </>
            ) : (
              <Notice tone="down">{portfolioRes.error}</Notice>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Start a new portfolio" />
          <PanelBody>{p ? <ResetPortfolioForm currentQuote={p.quoteAsset} /> : null}</PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="AI provider" description="Selected with AI_PROVIDER and the model variables on the server." />
          <PanelBody>
            <Row label="Status">{ai.configured ? <Badge tone="up">Configured</Badge> : <Badge tone="down">Not configured</Badge>}</Row>
            <Row label="Provider">{ai.provider ?? "—"}</Row>
            <Row label="Model">{ai.model ?? "—"}</Row>
            {ai.problems.length ? (
              <Notice tone="down" className="mt-3" title="Configuration problems">
                <ul className="list-disc pl-4">{ai.problems.map((x) => <li key={x}>{x}</li>)}</ul>
              </Notice>
            ) : null}
            <p className="mt-3 text-[0.6875rem] text-faint">
              Changing the provider or model takes effect on the next request. The app never switches providers on its own; if the
              configured provider fails you see an error and can retry.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Alerts & background work" />
          <PanelBody className="space-y-4">
            {settingsRes.data ? <AlertIntervalForm seconds={settingsRes.data.alertPollIntervalSeconds} /> : <Notice tone="down">{settingsRes.error}</Notice>}
            <div>
              <Row label="Snapshot interval">{env ? `${env.SNAPSHOT_INTERVAL_MINUTES} minutes` : "—"}</Row>
              <Row label="Scheduled job (cron)">{env?.CRON_SECRET ? <Badge tone="up">Enabled</Badge> : <Badge>Disabled — CRON_SECRET not set</Badge>}</Row>
              {(jobsRes.data ?? []).map((j) => (
                <Row key={j._id} label={`Last ${j._id.replace("cron:", "").replace("_", " ")}`}>
                  {formatDateTime(j.lastRunAt)} {j.lastStatus === "ok" ? <Badge tone="up">ok</Badge> : <Badge tone="down">error</Badge>}
                </Row>
              ))}
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Market data" />
          <PanelBody>
            <Row label="Source">Binance Spot public market data (no API key, read-only)</Row>
            <Row label="Endpoint">{env?.BINANCE_API_BASE ?? "—"}</Row>
            <Row label="Ticker cache">{env ? `${env.MARKET_TICKER_TTL_SECONDS} s` : "—"}</Row>
            <p className="mt-3 text-[0.6875rem] text-faint">
              The app never requests Binance account access, trading permissions, withdrawal permissions, seed phrases or private keys.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Account & security" />
          <PanelBody>
            <Row label="Administrator">{user.email}</Row>
            <Row label="Sign-in methods">Email + password{googleAuthEnabled() ? " · Google (restricted to one address)" : ""}</Row>
            <Row label="Registration">Disabled — single-user application</Row>
            <p className="mt-3 text-[0.6875rem] text-faint">
              To change the password, generate a new hash with <code>npm run hash-password</code> and update ADMIN_PASSWORD_HASH.
            </p>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
