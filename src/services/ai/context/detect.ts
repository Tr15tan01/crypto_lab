import { ASSET_NAMES, assetsMentionedByName } from "@/services/market/asset-names";

/**
 * Detects which assets a question is about and what kind of data it needs.
 * Pure function, so it is unit-tested; the result decides what is shared with the AI provider
 * (data minimisation: private portfolio data is only included when the question needs it).
 */

// Uppercase words that are also tickers but usually just English words.
const STOPWORDS = new Set([
  "I", "A", "AN", "AND", "ARE", "AS", "AT", "BE", "BUT", "BY", "CAN", "DO", "FOR", "GO", "HE", "IF", "IN", "IS", "IT",
  "ME", "MY", "NO", "NOT", "NOW", "OF", "ON", "ONE", "OR", "OUT", "SO", "THE", "TO", "UP", "US", "WE", "WHAT", "WHO",
  "WHY", "YOU", "ALL", "ANY", "HOW", "NEW", "OK", "AI", "PNL", "USD", "ATH", "ATL", "RSI", "EMA", "SMA", "MACD", "ATR",
  "ETF", "TA", "FA", "VS", "BUY", "SELL", "HOLD", "LONG", "SHORT", "TOP", "LOW", "HIGH", "DAY", "WEEK", "YEAR", "GAS",
  "OP", "SUN", "MOVE", "REAL", "BOND", "FUN", "WIN", "KEY", "HOT", "COS", "PEOPLE", "TRUE", "ACT", "AUDIO", "BIG",
]);

const STABLES = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI", "BUSD", "USDP", "EUR"]);

export interface DetectedIntent {
  baseAssets: string[];
  portfolio: boolean;
  history: boolean;
  journal: boolean;
  marketWide: boolean;
  scenarios: Array<{ asset: string; changePercent: number }>;
}

const PORTFOLIO_RE =
  /\b(my|our)\s+(?:\w+\s+)?(portfolio|holdings?|positions?|investments?|purchases?|trades?|balance|cash|coins?|bags?)\b|\bportfolio\b|\bi (own|hold|bought|sold)\b|\bshould i (buy|sell|hold|add|trim)\b/i;
const HISTORY_RE = /\b(previous|past|earlier|my)\s+(purchases?|trades?|transactions?|buys?|sells?|decisions?)\b|\breview my\b/i;
const JOURNAL_RE = /\b(thesis|journal|decision|reasoning|why i (bought|sold))\b/i;
const MARKET_RE = /\b(market|overall|crypto in general|conditions|sentiment|breadth|altcoins?)\b/i;
const SCENARIO_RE =
  /\b([A-Za-z]{2,10})\s+(?:were\s+to\s+|was\s+to\s+)?(drops?|dropped|falls?|fell|crash(?:es|ed)?|declines?|declined|dumps?|rises?|rose|gains?|gained|pumps?|jumps?|goes up|goes down|went up|went down|moves? (?:up|down))\s+(?:by\s+)?(\d{1,3}(?:\.\d+)?)\s?%/gi;

const DOWN_WORDS = /drop|fell|fall|crash|declin|dump|down/i;

function resolveAsset(word: string, known: Set<string>): string | null {
  const upper = word.toUpperCase();
  if (known.has(upper)) return upper;
  const byName = assetsMentionedByName(word);
  return byName.find((a) => known.has(a)) ?? null;
}

export function detectIntent(text: string, knownBaseAssets: Set<string>, focusBaseAsset?: string | null): DetectedIntent {
  const found: string[] = [];
  const add = (a: string) => {
    if (!found.includes(a) && knownBaseAssets.has(a) && !STABLES.has(a)) found.push(a);
  };

  if (focusBaseAsset) add(focusBaseAsset);

  // Full pair symbols, e.g. SOLUSDT.
  for (const m of text.matchAll(/\b([A-Z0-9]{2,12})(USDT|USDC|FDUSD|BTC|ETH|BNB)\b/g)) add(m[1]!);
  // $TICKER or uppercase tickers written as such.
  for (const m of text.matchAll(/\$?\b([A-Z][A-Z0-9]{1,9})\b/g)) {
    if (!STOPWORDS.has(m[1]!)) add(m[1]!);
  }
  // Well-known tickers typed in lowercase ("btc", "eth").
  for (const m of text.matchAll(/\b([a-z][a-z0-9]{2,9})\b/g)) {
    const up = m[1]!.toUpperCase();
    if (ASSET_NAMES[up] && !STOPWORDS.has(up)) add(up);
  }
  // Names ("bitcoin", "solana").
  for (const a of assetsMentionedByName(text)) add(a);

  const scenarios: DetectedIntent["scenarios"] = [];
  for (const m of text.matchAll(SCENARIO_RE)) {
    const asset = resolveAsset(m[1]!, knownBaseAssets);
    if (!asset) continue;
    const pct = Number(m[3]);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    scenarios.push({ asset, changePercent: DOWN_WORDS.test(m[2]!) ? -pct : pct });
    add(asset);
  }

  const portfolio = PORTFOLIO_RE.test(text) || scenarios.length > 0;
  return {
    baseAssets: found.slice(0, 4),
    portfolio,
    history: HISTORY_RE.test(text) || portfolio,
    journal: JOURNAL_RE.test(text),
    marketWide: MARKET_RE.test(text) || found.length === 0,
    scenarios: scenarios.slice(0, 3),
  };
}
