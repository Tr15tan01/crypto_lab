import "server-only";
import { marketData } from "@/services/binance";
import { summarizeIndicators } from "@/services/indicators/summary";
import { buildScorecard } from "@/services/indicators/scorecard";
import { derivatives, fearGreed } from "@/services/signals/market-intel";
import { latestRun, scoreCandles } from "@/services/learning/learning-service";
import type { MarketContext } from "@/models";

/**
 * A snapshot of the market around one pair at a moment in time — mood, BTC trend, the coin's
 * technicals, positioning, and the app's own model — stored with journal decisions and
 * watchlist additions so they can be reviewed later ("what did I know when I did this?").
 * Best effort: every part is optional and the whole capture is capped at a few seconds.
 */
const TIMEOUT_MS = 6000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

const r = (v: number | null | undefined, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

export async function captureMarketContext(symbol: string): Promise<MarketContext | null> {
  const md = marketData();
  const [ticker, daily, btcTicker, btcDaily, fng, deriv, run] = await Promise.all([
    withTimeout(md.ticker(symbol).then((x) => (x.stale ? null : x.data)), TIMEOUT_MS),
    withTimeout(md.klines(symbol, "1d", "1y").then((x) => x.data), TIMEOUT_MS),
    withTimeout(md.ticker("BTCUSDT").then((x) => x.data), TIMEOUT_MS),
    withTimeout(md.klines("BTCUSDT", "1d", "1y").then((x) => x.data), TIMEOUT_MS),
    withTimeout(fearGreed(), TIMEOUT_MS),
    withTimeout(derivatives(symbol), TIMEOUT_MS),
    withTimeout(latestRun(), TIMEOUT_MS),
  ]);
  if (!ticker && !fng && !btcTicker) return null;

  const s = ticker && daily && daily.length > 15 ? summarizeIndicators(daily, "1d", ticker.price) : null;
  const btcS = btcTicker && btcDaily && btcDaily.length > 50 ? summarizeIndicators(btcDaily, "1d", btcTicker.price) : null;
  const card = s && daily ? buildScorecard(daily, s, symbol === "BTCUSDT" ? null : btcDaily) : null;
  const model = run && daily && symbol !== "BTCUSDT" ? scoreCandles(run, daily, btcDaily) : null;

  return {
    capturedAt: new Date(),
    fearGreed: fng ? { value: fng.value, label: fng.label } : null,
    btc: btcTicker
      ? {
          price: btcTicker.price,
          change24hPercent: r(btcTicker.priceChangePercent),
          change7dPercent: r(btcS?.returns["7d"]),
          aboveSma50: btcS?.ema50 != null ? btcTicker.price > btcS.ema50 : null,
          aboveSma200: btcS?.ema200 != null ? btcTicker.price > btcS.ema200 : null,
        }
      : null,
    coin: ticker
      ? {
          price: ticker.price,
          change24hPercent: r(ticker.priceChangePercent),
          change7dPercent: r(s?.returns["7d"]),
          change30dPercent: r(s?.returns["30d"]),
          rsi14: r(s?.rsi14, 1),
          volumeVsAverage: r(s?.volume.ratio),
          vsEma50Percent: s?.ema50 ? r((ticker.price / s.ema50 - 1) * 100) : null,
          vsEma200Percent: s?.ema200 ? r((ticker.price / s.ema200 - 1) * 100) : null,
          atrPercent: r(s?.atrPercent),
          rangePosition90dPercent: r(s?.range?.positionPercent, 0),
          quoteVolume24h: Math.round(ticker.quoteVolume),
        }
      : null,
    scorecard: card ? { composite: card.composite, label: card.label } : null,
    model: model ? { probability: model.probability, trust: model.trust } : null,
    futures: deriv ? { fundingRatePercent: r(deriv.fundingRatePercent, 4), longAccountsPercent: r(deriv.longAccountsPercent, 1) } : null,
  };
}
