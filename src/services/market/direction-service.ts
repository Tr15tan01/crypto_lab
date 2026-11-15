import "server-only";
import { marketData, mongoStore, type MarketResult } from "@/services/binance";
import { externalCache } from "@/services/external/http";
import { loadUniverseHistories } from "@/services/backtest/backtest-service";
import { isTrackerOrPegged } from "@/services/market/asset-names";
import { fearGreedHistory } from "@/services/signals/market-intel";
import {
  COMPONENTS,
  ZONES,
  directionSeries,
  regimeOf,
  timeframeTrend,
  zoneHistory,
  zoneOf,
  type DirectionDay,
  type Regime,
  type TimeframeTrend,
  type Zone,
  type ZoneHistory,
} from "./direction";

const KEY = "direction:v1";
const TTL = 30 * 60;

export interface MarketDirection {
  asOf: number;
  /** True when the reading includes today's still-forming daily candle. */
  includesToday: boolean;
  score: number;
  zone: Zone;
  zoneLabel: string;
  regime: Regime;
  scoreWeekAgo: number | null;
  /** Consecutive days (including today) the market has been in this zone. */
  daysInZone: number;
  components: Array<{ key: string; label: string; weight: number; score: number; note: string }>;
  history: ZoneHistory[];
  /** Last 180 days, for the chart. */
  series: Array<{ t: number; score: number; btc: number }>;
  coins: number;
}

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

function notes(d: DirectionDay): string[] {
  const f = d.facts;
  const above = [f.aboveSma20 && "20-day", f.aboveSma50 && "50-day", f.aboveSma200 && "200-day"].filter(Boolean);
  return [
    `BTC is above ${above.length ? `its ${above.join(", ")} average${above.length > 1 ? "s" : ""}` : "none of its 20/50/200-day averages"}; the 50-day is ${f.sma50AboveSma200 ? "above" : "below"} the 200-day`,
    `BTC ${pct(f.btcRet7)} in 7 days, ${pct(f.btcRet30)} in 30 days`,
    f.breadth50 === null ? "not enough coins" : `${Math.round(f.breadth50 * 100)}% of coins are above their 50-day average`,
    f.breadth20 === null ? "not enough coins" : `${Math.round(f.breadth20 * 100)}% of coins are above their 20-day average`,
    f.medianAltRet7 === null ? "not enough coins" : `the typical coin is ${pct(f.medianAltRet7)} over 7 days`,
    f.fearGreed === null ? "Fear & Greed unavailable" : `Fear & Greed index at ${f.fearGreed}`,
  ];
}

/** Daily direction scores over the whole history (closed days only): used to tag backtest trades. */
export async function directionHistory(): Promise<DirectionDay[]> {
  const { pairs, btc } = await loadUniverseHistories();
  if (!btc) return [];
  const alts = pairs.filter((p) => p.symbol !== "BTCUSDT" && !isTrackerOrPegged(p.symbol.replace(/USDT$/, ""), p.candles.map((k) => k.close)));
  return directionSeries(btc, alts, await fearGreedHistory());
}

async function compute(): Promise<MarketDirection> {
  const { pairs, btc, live, loadedAt } = await loadUniverseHistories();
  if (!btc) throw new Error("BTC history unavailable");
  const alts = pairs.filter((p) => p.symbol !== "BTCUSDT" && !isTrackerOrPegged(p.symbol.replace(/USDT$/, ""), p.candles.map((k) => k.close)));
  const fng = await fearGreedHistory();
  const closedSeries = directionSeries(btc, alts, fng);
  // The current reading uses today's forming candles so it follows the market during the day.
  const withToday = (symbol: string, candles: typeof btc) => (live[symbol] ? [...candles, live[symbol]!] : candles);
  const liveSeries = live.BTCUSDT
    ? directionSeries(withToday("BTCUSDT", btc), alts.map((p) => ({ candles: withToday(p.symbol, p.candles) })), fng)
    : closedSeries;
  const today = liveSeries[liveSeries.length - 1];
  if (!today) throw new Error("Not enough history for a direction reading");

  let daysInZone = 1;
  for (let i = closedSeries.length - 1; i >= 0 && zoneOf(closedSeries[i]!.score) === zoneOf(today.score); i--) daysInZone++;
  const partNotes = notes(today);
  return {
    asOf: loadedAt,
    includesToday: Boolean(live.BTCUSDT),
    score: today.score,
    zone: zoneOf(today.score),
    zoneLabel: ZONES.find((z) => z.key === zoneOf(today.score))!.label,
    regime: regimeOf(today.score),
    scoreWeekAgo: closedSeries[closedSeries.length - 7]?.score ?? null,
    daysInZone,
    components: COMPONENTS.map((c, j) => ({ key: c.key, label: c.label, weight: c.weight, score: Math.round(today.parts[j]! * 100) / 100, note: partNotes[j]! })),
    history: zoneHistory(closedSeries, btc, alts),
    series: liveSeries.slice(-180).map((d) => ({ t: d.t, score: d.score, btc: d.btcClose })),
    coins: alts.length,
  };
}

export async function getMarketDirection(): Promise<MarketResult<MarketDirection>> {
  return externalCache().get(KEY, TTL, compute, { persist: true, persistEverySeconds: TTL });
}

/** The last computed reading without triggering a new computation (for fast pages and the chat). */
export async function cachedMarketDirection(): Promise<MarketDirection | null> {
  const mem = externalCache().peek(KEY);
  if (mem) return mem.data as MarketDirection;
  const persisted = await mongoStore.read(KEY).catch(() => null);
  return persisted ? (persisted.data as MarketDirection) : null;
}

export interface CoinTimeframes {
  symbol: string;
  price: number | null;
  trends: TimeframeTrend[];
  /** All three timeframes agree. */
  aligned: "up" | "down" | null;
}

/** Trend on the 4-hour, daily and weekly charts for a few coins. */
export async function timeframeTrends(symbols: string[]): Promise<CoinTimeframes[]> {
  const md = marketData();
  const out: CoinTimeframes[] = [];
  const queue = [...new Set(symbols)].slice(0, 14);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const symbol = s;
        const [h4, d1, w1] = await Promise.all([
          md.klines(symbol, "4h", "90d").then((r) => r.data).catch(() => null),
          md.klines(symbol, "1d", "1y").then((r) => r.data).catch(() => null),
          md.klines(symbol, "1w", "all").then((r) => r.data).catch(() => null),
        ]);
        const price = h4?.length ? h4[h4.length - 1]!.close : d1?.length ? d1[d1.length - 1]!.close : null;
        const trends = price
          ? ([
              h4 ? timeframeTrend("4h", h4.map((k) => k.close), price) : null,
              d1 ? timeframeTrend("1d", d1.map((k) => k.close), price) : null,
              w1 ? timeframeTrend("1w", w1.map((k) => k.close), price) : null,
            ].filter((t): t is TimeframeTrend => t !== null))
          : [];
        out.push({
          symbol,
          price,
          trends,
          aligned: trends.length === 3 && trends.every((t) => t.direction === "up") ? "up" : trends.length === 3 && trends.every((t) => t.direction === "down") ? "down" : null,
        });
      }
    }),
  );
  return symbols.map((s) => out.find((o) => o.symbol === s)).filter((o): o is CoinTimeframes => Boolean(o));
}
