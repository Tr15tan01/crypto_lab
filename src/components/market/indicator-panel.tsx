import { Info } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";
import { cn, formatDateTime, formatPercent, formatPrice } from "@/lib/utils/format";
import type { IndicatorSummary } from "@/services/indicators/summary";

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted">
        {label}
        {hint ? <span className="sr-only"> — {hint}</span> : null}
      </dt>
      <dd className="num text-right text-xs">{value}</dd>
    </div>
  );
}

export function IndicatorPanel({ s, error }: { s: IndicatorSummary | null; error: string | null }) {
  if (!s) return <EmptyState className="py-8" title="Indicators unavailable" description={error ?? undefined} />;
  return (
    <div className="space-y-4 p-4">
      <p className="flex items-center gap-1.5 text-[11px] text-faint">
        Daily candles · {s.candles} closed · as of {formatDateTime(s.asOf)}
        <Tooltip content="Indicators are calculated deterministically by the app from Binance candles. They describe the past, lag price, and produce false signals — especially in thin or news-driven markets.">
          <Info className="size-3" aria-label="About indicators" />
        </Tooltip>
      </p>
      <dl className="divide-y divide-border/60">
        <Row label="RSI (14)" value={s.rsi14 !== null ? s.rsi14.toFixed(1) : "—"} />
        <Row label="MACD / signal" value={s.macd ? `${formatPrice(s.macd.macd)} / ${formatPrice(s.macd.signal)}` : "—"} />
        <Row label="EMA 20" value={formatPrice(s.ema20)} />
        <Row label="EMA 50" value={formatPrice(s.ema50)} />
        <Row label="EMA 200" value={formatPrice(s.ema200)} />
        <Row label="Bollinger (20,2)" value={s.bollinger ? `${formatPrice(s.bollinger.lower)} – ${formatPrice(s.bollinger.upper)}` : "—"} />
        <Row label="ATR (14)" value={s.atr14 !== null ? `${formatPrice(s.atr14)} (${formatPercent(s.atrPercent, { sign: false })})` : "—"} />
        <Row label="Volatility (30d, annualised)" value={formatPercent(s.volatility.annualizedPercent, { sign: false, digits: 1 })} />
        <Row label="Volume vs 20d avg" value={s.volume.ratio !== null ? `${s.volume.ratio.toFixed(2)}×` : "—"} />
        <Row label="Return 7d / 30d / 90d" value={`${formatPercent(s.returns["7d"])} · ${formatPercent(s.returns["30d"])} · ${formatPercent(s.returns["90d"])}`} />
        <Row label="Swing support" value={s.levels.support.length ? s.levels.support.map((v) => formatPrice(v)).join(" · ") : "—"} />
        <Row label="Swing resistance" value={s.levels.resistance.length ? s.levels.resistance.map((v) => formatPrice(v)).join(" · ") : "—"} />
      </dl>
      <div>
        <p className="label-caps mb-2">Conventional readings</p>
        <ul className="space-y-2">
          {s.signals.map((sig) => (
            <li key={sig.name} className="text-xs">
              <span
                className={cn(
                  "mr-1.5 font-medium",
                  sig.reading === "bullish" ? "text-up" : sig.reading === "bearish" ? "text-down" : "text-muted",
                )}
              >
                {sig.reading === "bullish" ? "▲" : sig.reading === "bearish" ? "▼" : "◆"} {sig.name}
              </span>
              <span className="text-muted">{sig.note}</span>
            </li>
          ))}
        </ul>
      </div>
      {s.warnings.length ? (
        <ul className="space-y-1 text-[11px] text-warn">
          {s.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
