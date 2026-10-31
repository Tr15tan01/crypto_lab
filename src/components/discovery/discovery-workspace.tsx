"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RefreshCw, Sparkles, Star, Telescope, TriangleAlert } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Notice, Panel, PanelHeader, Select, Skeleton } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/radix";
import { Markdown } from "@/components/chat/markdown";
import { ChangeText, Freshness } from "@/components/market/indicators";
import { SIGNAL_INFO, THRESHOLDS, type DiscoverySignal } from "@/services/discovery/signals";
import { cn, formatCompact, formatDateTime, formatPrice } from "@/lib/utils/format";

interface Row {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string | null;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  listedDays: number | null;
  volumeRatio: number | null;
  vsBtc7d: number | null;
  vsBtc30d: number | null;
  goldenCrossDaysAgo: number | null;
  rsi14: number | null;
  fromHigh90d: number | null;
  signals: DiscoverySignal[];
  cautions: string[];
  score: number;
}

interface Payload {
  rows: Row[];
  benchmark: { symbol: string; return7d: number | null; return30d: number | null };
  universe: { quoteAsset: string; minQuoteVolume: number; candidates: number; scanned: number; failed: number };
  watched: string[];
  personalDataAvailable: boolean;
  fetchedAt: string;
  stale: boolean;
}

interface Shortlist {
  _id: string;
  provider: string;
  model: string;
  screen: string;
  symbols: string[];
  content: string;
  scanTimestamp: string;
  scanStale: boolean;
  timestamp: string;
}

type ScreenKey = "top" | "new" | "volume" | "momentum" | "trend";

const TREND_SIGNALS: DiscoverySignal[] = ["golden_cross", "oversold_bounce", "breakout"];

const SCREENS: Array<{
  key: ScreenKey;
  label: string;
  description: string;
  filter: (r: Row, volumeRatio: number) => boolean;
  sort: (a: Row, b: Row) => number;
}> = [
  {
    key: "top",
    label: "Top signals",
    description: "Pairs where two or more independent signals fire at once. Agreement between signals is more informative than any single one.",
    filter: (r) => r.score >= 2,
    sort: (a, b) => b.score - a.score || (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0),
  },
  {
    key: "new",
    label: "New listings",
    description: `Pairs whose first Binance trading data is within the last ${THRESHOLDS.newListingDays} days, newest first. New listings are the most volatile group in both directions.`,
    filter: (r) => r.signals.includes("new_listing"),
    sort: (a, b) => (a.listedDays ?? 999) - (b.listedDays ?? 999),
  },
  {
    key: "volume",
    label: "Unusual volume",
    description: "24h volume compared with the pair's own 30-day median. Rising volume is often the first sign of new interest, but it also accompanies sell-offs and pumps.",
    filter: (r, ratio) => r.volumeRatio !== null && r.volumeRatio >= ratio,
    sort: (a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0),
  },
  {
    key: "momentum",
    label: "Strength vs BTC",
    description: `Pairs beating Bitcoin over 7 days and by ${THRESHOLDS.outperform30dPercent}%+ over 30 days: sustained relative strength rather than a one-day spike.`,
    filter: (r) => r.signals.includes("outperforming_btc"),
    sort: (a, b) => (b.vsBtc30d ?? 0) - (a.vsBtc30d ?? 0),
  },
  {
    key: "trend",
    label: "Trend changes",
    description: "A fresh golden cross (50-day above 200-day average), a bounce from oversold RSI, or a new 90-day high.",
    filter: (r) => r.signals.some((s) => TREND_SIGNALS.includes(s)),
    sort: (a, b) => b.score - a.score || (b.vsBtc30d ?? 0) - (a.vsBtc30d ?? 0),
  },
];

const VOLUME_FLOORS = [
  { value: "250000", label: "≥ 250K" },
  { value: "1000000", label: "≥ 1M" },
  { value: "10000000", label: "≥ 10M" },
];

const RATIO_OPTIONS = [
  { value: "2", label: "≥ 2× usual" },
  { value: "3", label: "≥ 3× usual" },
  { value: "5", label: "≥ 5× usual" },
];

const SHORTLIST_SIZE = 6;
const MAX_ROWS = 100;

function SignalBadges({ signals }: { signals: DiscoverySignal[] }) {
  if (!signals.length) return <span className="text-xs text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {signals.map((s) => (
        <Badge key={s} tone={s === "new_listing" ? "info" : "accent"} title={SIGNAL_INFO[s].description}>
          {SIGNAL_INFO[s].label}
        </Badge>
      ))}
    </span>
  );
}

function Cautions({ cautions }: { cautions: string[] }) {
  if (!cautions.length) return null;
  return (
    <Tooltip
      content={
        <ul className="list-disc space-y-1 pl-4">
          {cautions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      }
    >
      <button type="button" className="rounded-sm p-0.5 text-warn" aria-label={`Cautions: ${cautions.join(" ")}`}>
        <TriangleAlert className="size-3.5" />
      </button>
    </Tooltip>
  );
}

function ScreenTable({
  rows,
  watched,
  pending,
  onWatch,
}: {
  rows: Row[];
  watched: Set<string>;
  pending: string | null;
  onWatch: (symbol: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Telescope className="size-5" />}
        title="Nothing passes this screen right now"
        description="That is normal in quiet markets. Try another screen or lower the volume floor."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-[13px]">
        <thead>
          <tr className="border-y border-border text-left text-[11px] text-muted">
            <th className="w-10 px-3 py-2 font-medium" aria-label="Watchlist" />
            <th className="px-3 py-2 font-medium">Pair</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">24h</th>
            <th className="px-3 py-2 text-right font-medium">24h volume</th>
            <th className="px-3 py-2 text-right font-medium" title="24h volume ÷ median daily volume of the last 30 days">
              Vol. vs usual
            </th>
            <th className="px-3 py-2 text-right font-medium" title="Performance relative to BTC over 7 days">
              7d vs BTC
            </th>
            <th className="px-3 py-2 text-right font-medium" title="Performance relative to BTC over 30 days">
              30d vs BTC
            </th>
            <th className="px-3 py-2 text-right font-medium" title="Days since the first Binance trading data (shown for pairs under 300 days)">
              Trading for
            </th>
            <th className="px-3 py-2 font-medium">Signals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isWatched = watched.has(r.symbol);
            return (
              <tr key={r.symbol} className="group border-b border-border/70 transition-colors hover:bg-surface-2">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onWatch(r.symbol)}
                    disabled={isWatched || pending === r.symbol}
                    aria-label={isWatched ? `${r.symbol} is on your watchlist` : `Add ${r.symbol} to watchlist`}
                    title={isWatched ? "On your watchlist" : "Add to watchlist"}
                    className="rounded-sm p-0.5 text-faint transition-colors hover:text-accent disabled:cursor-default"
                  >
                    <Star className={cn("size-3.5", isWatched && "fill-accent text-accent")} />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <Link href={`/crypto/${r.symbol}`} className="flex items-baseline gap-2">
                      <span className="font-medium text-fg group-hover:text-accent">
                        {r.baseAsset}
                        <span className="text-faint">/{r.quoteAsset}</span>
                      </span>
                      {r.name ? <span className="truncate text-xs text-muted">{r.name}</span> : null}
                    </Link>
                    <Cautions cautions={r.cautions} />
                  </span>
                </td>
                <td className="num px-3 py-2 text-right">{formatPrice(r.price)}</td>
                <td className="px-3 py-2 text-right">
                  <ChangeText value={r.change24h} />
                </td>
                <td className="num px-3 py-2 text-right text-muted">{formatCompact(r.quoteVolume24h)}</td>
                <td
                  className={cn(
                    "num px-3 py-2 text-right",
                    r.volumeRatio !== null && r.volumeRatio >= THRESHOLDS.volumeSurgeRatio ? "text-accent" : "text-muted",
                  )}
                >
                  {r.volumeRatio !== null ? `${r.volumeRatio.toFixed(1)}×` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <ChangeText value={r.vsBtc7d} showIcon={false} />
                </td>
                <td className="px-3 py-2 text-right">
                  <ChangeText value={r.vsBtc30d} showIcon={false} />
                </td>
                <td className="num px-3 py-2 text-right text-muted">{r.listedDays !== null ? `${r.listedDays}d` : "—"}</td>
                <td className="px-3 py-2">
                  <SignalBadges signals={r.signals} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShortlistPanel({
  screen,
  candidates,
  aiConfigured,
  aiProblem,
}: {
  screen: (typeof SCREENS)[number];
  candidates: Row[];
  aiConfigured: boolean;
  aiProblem: string | null;
}) {
  const { data: history, setData: setHistory } = useApi<Shortlist[]>("/api/discovery/shortlist");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = history?.find((s) => s._id === selectedId) ?? history?.[0] ?? null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = await apiFetch<Shortlist>("/api/discovery/shortlist", {
        method: "POST",
        json: { screen: screen.key, symbols: candidates.map((c) => c.symbol) },
      });
      setHistory([doc, ...(history ?? [])]);
      setSelectedId(doc._id);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The review could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="AI shortlist review"
        description="The AI reviews the top candidates of the current screen and lays out the case for and against each one. It does not recommend buying."
        actions={
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!aiConfigured || candidates.length === 0}
            onClick={() => void generate()}
          >
            {!busy ? <Sparkles className="size-3.5" /> : null}
            {busy
              ? "Reviewing… (up to a minute)"
              : candidates.length
                ? `Review top ${candidates.length} of “${screen.label}”`
                : "No candidates to review"}
          </Button>
        }
      />
      {!aiConfigured ? (
        <Notice tone="warn" className="m-4" title="AI is not configured">
          {aiProblem ?? "Set the AI provider variables on the server to enable reviews."}
        </Notice>
      ) : null}
      {error ? <Notice tone="down" className="m-4">{error}</Notice> : null}
      {candidates.length ? (
        <p className="border-b border-border px-4 py-2 text-[11px] text-muted">
          Next review would cover: {candidates.map((c) => c.baseAsset).join(", ")}
        </p>
      ) : null}
      {!history ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : !selected ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="No reviews yet"
          description="Pick a screen above, then generate a review. Reviews are saved with the exact data the AI saw."
        />
      ) : (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {history.length > 1 ? (
              <Select
                value={selected._id}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Saved reviews"
                className="h-7 w-auto text-xs"
              >
                {history.map((s) => (
                  <option key={s._id} value={s._id}>
                    {formatDateTime(s.timestamp)} · {s.symbols.length} pairs · {SCREENS.find((x) => x.key === s.screen)?.label ?? s.screen}
                  </option>
                ))}
              </Select>
            ) : (
              <span>{formatDateTime(selected.timestamp)}</span>
            )}
            <span>
              Scan data from {formatDateTime(selected.scanTimestamp)} · {selected.provider}/{selected.model}
            </span>
            {selected.scanStale ? <Badge tone="warn">Based on stale scan</Badge> : null}
          </div>
          <Markdown>{selected.content}</Markdown>
        </div>
      )}
    </Panel>
  );
}

export function DiscoveryWorkspace({ aiConfigured, aiProblem }: { aiConfigured: boolean; aiProblem: string | null }) {
  const { data, error, loading, refresh, setData } = useApi<Payload>("/api/discovery", { refreshInterval: 5 * 60_000 });
  const [screen, setScreen] = useState<ScreenKey>("top");
  const [minVolume, setMinVolume] = useState("250000");
  const [minRatio, setMinRatio] = useState("2");
  const [hideCautions, setHideCautions] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const watched = useMemo(() => new Set(data?.watched ?? []), [data]);

  const results = useMemo(() => {
    const out = {} as Record<ScreenKey, Row[]>;
    const vol = Number(minVolume);
    const ratio = Number(minRatio);
    const base = (data?.rows ?? []).filter((r) => r.quoteVolume24h >= vol && (!hideCautions || r.cautions.length === 0));
    for (const s of SCREENS) out[s.key] = base.filter((r) => s.filter(r, ratio)).sort(s.sort);
    return out;
  }, [data, minVolume, minRatio, hideCautions]);

  const active = SCREENS.find((s) => s.key === screen)!;

  const addToWatchlist = async (symbol: string) => {
    setPending(symbol);
    setActionError(null);
    try {
      await apiFetch("/api/watchlist", {
        method: "POST",
        json: { symbol, reason: `Flagged by discovery screen “${active.label}”` },
      });
      if (data) setData({ ...data, watched: [...data.watched, symbol] });
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Could not add to watchlist.");
    } finally {
      setPending(null);
    }
  };

  const btc = data?.benchmark;

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Screens find unusual activity, not future winners">
        Every list below is a mechanical filter on Binance data. Most coins that pass a screen do not go on to large gains, and
        the biggest movers often reverse just as fast. Treat a hit as a reason to research, then test the idea with the paper
        portfolio. See the <Link href="/guide#discovery" className="text-accent hover:underline">guide</Link> for how each
        screen works.
      </Notice>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select value={minVolume} onChange={(e) => setMinVolume(e.target.value)} aria-label="Minimum 24h volume" className="w-28">
            {VOLUME_FLOORS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
          {screen === "volume" ? (
            <Select value={minRatio} onChange={(e) => setMinRatio(e.target.value)} aria-label="Minimum volume ratio" className="w-32">
              {RATIO_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            size="sm"
            variant={hideCautions ? "primary" : "secondary"}
            aria-pressed={hideCautions}
            onClick={() => setHideCautions((v) => !v)}
            title="Hide pairs with thin liquidity, very short history, or signs of a pump"
          >
            <TriangleAlert className="size-3.5" /> Hide flagged risks
          </Button>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
            {btc ? (
              <span>
                BTC 7d <ChangeText value={btc.return7d} showIcon={false} /> · 30d <ChangeText value={btc.return30d} showIcon={false} />
              </span>
            ) : null}
            <Button size="icon" variant="ghost" onClick={() => void refresh()} aria-label="Reload discovery scan">
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] text-muted">
          <span>
            {data
              ? `${data.universe.scanned} USDT pairs with ≥ ${formatCompact(data.universe.minQuoteVolume)} daily volume scanned` +
                (data.universe.failed ? ` · ${data.universe.failed} could not be loaded` : "") +
                " · refreshes every 15 minutes"
              : "Running the discovery scan… the first scan of the day can take up to 30 seconds."}
          </span>
          {data ? <Freshness fetchedAt={data.fetchedAt} stale={data.stale} /> : null}
        </div>

        {actionError ? <Notice tone="down" className="mx-4 mb-3">{actionError}</Notice> : null}
        {data && !data.personalDataAvailable ? (
          <Notice tone="warn" className="mx-4 mb-3">
            The database is unreachable, so watchlist markers are not shown. The scan is unaffected.
          </Notice>
        ) : null}
        {data?.stale ? (
          <Notice tone="warn" className="mx-4 mb-3" title="Showing the last successful scan">
            Binance could not be reached for a new scan. Values below are not live.
          </Notice>
        ) : null}

        {error && !data ? (
          <EmptyState
            title="The discovery scan is unavailable"
            description={error.message}
            action={
              <Button size="sm" onClick={() => void refresh()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        ) : !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <Tabs value={screen} onValueChange={(v) => setScreen(v as ScreenKey)}>
            <div className="px-4 pb-2">
              <TabsList className="flex-wrap">
                {SCREENS.map((s) => (
                  <TabsTrigger key={s.key} value={s.key}>
                    {s.label} <span className="ml-1 text-faint">{results[s.key].length}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {SCREENS.map((s) => (
              <TabsContent key={s.key} value={s.key}>
                <p className="px-4 pb-3 text-xs text-muted">{s.description}</p>
                <ScreenTable rows={results[s.key].slice(0, MAX_ROWS)} watched={watched} pending={pending} onWatch={(sym) => void addToWatchlist(sym)} />
                {results[s.key].length > MAX_ROWS ? (
                  <p className="px-4 py-2 text-[11px] text-faint">
                    Showing the first {MAX_ROWS} of {results[s.key].length}. Raise the volume floor to narrow the list.
                  </p>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </Panel>

      {data ? (
        <ShortlistPanel
          screen={active}
          candidates={results[screen].slice(0, SHORTLIST_SIZE)}
          aiConfigured={aiConfigured}
          aiProblem={aiProblem}
        />
      ) : null}

      {data ? (
        <p className="text-[11px] text-faint">
          Signal definitions:{" "}
          {Object.values(SIGNAL_INFO)
            .map((s) => `${s.label}: ${s.description}`)
            .join(" · ")}
          . “vs BTC” columns show how much better (+) or worse (−) a coin did than Bitcoin over the same window.
        </p>
      ) : null}
    </div>
  );
}
