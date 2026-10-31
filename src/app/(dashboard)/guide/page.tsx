import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { DISCOVERY_SIGNALS, SIGNAL_INFO, THRESHOLDS } from "@/services/discovery/signals";
import { formatCompact } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Guide" };

const SECTIONS = [
  { id: "workflow", title: "A research workflow" },
  { id: "discovery", title: "Discovery screens" },
  { id: "reading", title: "Reading a candidate" },
  { id: "pages", title: "Every page explained" },
  { id: "data", title: "Data and its limits" },
  { id: "safety", title: "What this app never does" },
];

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Panel id={id} className="scroll-mt-20">
      <PanelHeader title={title} description={description} />
      <PanelBody className="space-y-3 text-[13px] leading-relaxed text-fg/90">{children}</PanelBody>
    </Panel>
  );
}

function P({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-[11px] text-accent">
            {i + 1}
          </span>
          <div className="min-w-0">{item}</div>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-faint">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

const SCREEN_GUIDE: Array<{ name: string; what: string; why: string; watchOut: string }> = [
  {
    name: "Top signals",
    what: "Pairs where two or more of the signals below fire at the same time.",
    why: "Independent signals agreeing (say, unusual volume plus a 90-day high plus strength against BTC) is more informative than any one alone. Start here.",
    watchOut: "A high score can also mean a coin has already run. Check the 7-day move and the caution icon.",
  },
  {
    name: "New listings",
    what: `Pairs whose first Binance trading data is within the last ${THRESHOLDS.newListingDays} days, newest first.`,
    why: "Newly listed coins have no long-term holders trapped above the price and often draw attention for weeks.",
    watchOut: "They are also where the steepest declines happen: many fall for months after listing as early investors and unlocked tokens are sold.",
  },
  {
    name: "Unusual volume",
    what: "24h trading volume compared with the coin's own median daily volume over the last 30 days. Choose 2×, 3× or 5×.",
    why: "Volume tends to rise before and during the start of a new trend, as new buyers arrive.",
    watchOut: "Heavy selling also produces high volume. Look at the 24h change: high volume on a falling price is distribution, not interest. 5×+ volume with a 25%+ daily jump is often a pump that fades.",
  },
  {
    name: "Strength vs BTC",
    what: `Coins beating Bitcoin over 7 days and by at least ${THRESHOLDS.outperform30dPercent}% over 30 days.`,
    why: "Most altcoins move with Bitcoin. A coin that keeps doing better than Bitcoin over weeks has its own buyers, and relative strength tends to persist for a while.",
    watchOut: "In a falling market a coin can 'beat BTC' while still losing money. Read the BTC 7d/30d figures at the top of the page.",
  },
  {
    name: "Trend changes",
    what: "A fresh golden cross (50-day average crossing above the 200-day), a bounce from oversold RSI, or a new 90-day high.",
    why: "These mark the moment a downtrend or a sideways range may be ending. Big long-term moves start from one of these.",
    watchOut: "Moving averages lag: a golden cross often comes after a large part of the move. Breakouts fail often, so note what price would mean the breakout failed.",
  },
];

export default async function GuidePage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Guide"
        description="How to use Crypto Lab to find and research candidate coins, test ideas safely with paper money, and learn from the results."
      />
      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Guide sections" className="xl:sticky xl:top-5 xl:self-start">
          <Panel>
            <ul className="p-2 text-[13px]">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        </nav>

        <div className="min-w-0 space-y-4">
          <Notice tone="warn" title="No tool can tell you which coin will rise">
            The features here help you notice coins with unusual activity early and examine them systematically. They do not predict
            prices. Coins that rise very high are rare, hard to tell apart from the many that spike and fade, and the same volatility
            works in both directions. Test every idea with the paper portfolio before risking real money anywhere.
          </Notice>

          <Section id="workflow" title="A research workflow" description="From a long list of pairs to a tested decision.">
            <Steps
              items={[
                <>
                  <strong>Scan.</strong> Open <P href="/discover">Discovery</P> and start with <em>Top signals</em>. Raise the
                  volume floor to 1M or more and turn on <em>Hide flagged risks</em> if the list is noisy.
                </>,
                <>
                  <strong>Shortlist.</strong> Click the star to add interesting pairs to your <P href="/watchlist">Watchlist</P>.
                  The reason is filled in with the screen that found it; edit it to say what caught your eye.
                </>,
                <>
                  <strong>Get a second opinion.</strong> Use <em>AI shortlist review</em> on Discovery for a quick case for and
                  against the top candidates. Look for coins where several signals agree and the case against is weak.
                </>,
                <>
                  <strong>Go deep on one coin.</strong> Open its page (click the pair). Check the long-term chart (1Y and All),
                  the indicator panel and support/resistance levels, then <em>Generate analysis</em> for a full 13-section AI
                  report. Use <em>Ask AI about …</em> for follow-up questions.
                </>,
                <>
                  <strong>Check what the app cannot see.</strong> News behind the move, token unlock schedule, total supply and
                  market cap, the team, and whether volume is real. The AI has no internet access, so this step is yours.
                </>,
                <>
                  <strong>Decide and write it down.</strong> If you go ahead, make a simulated buy from the coin page. Fill in the
                  journal fields: thesis, target, time horizon, and above all <em>what would prove you wrong</em>. Size positions
                  so that one failure does not hurt the portfolio much.
                </>,
                <>
                  <strong>Set alerts.</strong> On the coin page, add a price alert at your target and at the level where your
                  thesis fails, so you hear about it without watching the screen.
                </>,
                <>
                  <strong>Review.</strong> Add reviews to journal entries as things play out, and check{" "}
                  <P href="/analytics">Analytics</P> monthly: which screens and reasons actually led to gains? Do more of that.
                </>,
              ]}
            />
          </Section>

          <Section
            id="discovery"
            title="Discovery screens"
            description="Every liquid USDT pair is checked against six signals, using daily candles from Binance. The scan refreshes every 15 minutes."
          >
            <p>
              The scan covers USDT pairs trading at least 250K per day (up to 300 pairs, stablecoins excluded). Each tab is a screen
              built from these signals:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted">
                    <th className="py-2 pr-4 font-medium">Signal</th>
                    <th className="py-2 font-medium">Fires when</th>
                  </tr>
                </thead>
                <tbody>
                  {DISCOVERY_SIGNALS.map((s) => (
                    <tr key={s} className="border-b border-border/70 align-top">
                      <td className="whitespace-nowrap py-2 pr-4 font-medium text-accent">{SIGNAL_INFO[s].label}</td>
                      <td className="py-2 text-muted">{SIGNAL_INFO[s].description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {SCREEN_GUIDE.map((s) => (
                <div key={s.name} className="rounded-md border border-border bg-bg p-3">
                  <h3 className="text-[13px] font-semibold text-fg">{s.name}</h3>
                  <p className="mt-1 text-xs text-muted">{s.what}</p>
                  <p className="mt-2 text-xs">
                    <span className="text-up">Why it matters: </span>
                    {s.why}
                  </p>
                  <p className="mt-1 text-xs">
                    <span className="text-warn">Watch out: </span>
                    {s.watchOut}
                  </p>
                </div>
              ))}
            </div>
            <p>
              <strong>Columns.</strong> <em>Vol. vs usual</em> is today&apos;s 24h volume divided by the coin&apos;s median daily volume.{" "}
              <em>7d / 30d vs BTC</em> show how much better (+) or worse (−) the coin did than Bitcoin over the same window.{" "}
              <em>Trading for</em> is the number of days since the first Binance candle, shown only for pairs with under{" "}
              {THRESHOLDS.historyDays} days of history.
            </p>
            <p>
              <strong>The caution icon</strong> (amber triangle next to a pair) marks thin liquidity (under {formatCompact(THRESHOLDS.thinLiquidity)} per day), a 50%+ rise
              in the last 7 days, a large daily jump on extreme volume, or under 14 days of history. Hover it for the reason.
            </p>
            <p>
              <strong>AI shortlist review</strong> sends the top 6 rows of the current tab to the AI with the exact numbers behind
              them. For each coin it writes why it was flagged, the case for and against, what would weaken the setup, and what to
              check yourself. Reviews are saved; pick older ones from the drop-down. It is rate-limited together with analysis
              reports (10 per 10 minutes).
            </p>
          </Section>

          <Section id="reading" title="Reading a candidate" description="Questions to ask before a coin goes into the paper portfolio.">
            <Bullets
              items={[
                <>
                  <strong>Is the move confirmed by volume?</strong> A breakout on usual or falling volume is weaker than one on 2×+
                  volume.
                </>,
                <>
                  <strong>Is it early or late?</strong> A coin just leaving a long sideways range is earlier than one already up 80%
                  this week. Check <em>Recent price performance</em> and the 90-day range position on the coin page.
                </>,
                <>
                  <strong>Is it its own move or just the market?</strong> If BTC is up 15% this month, an altcoin up 20% is not
                  special. The &quot;vs BTC&quot; columns answer this.
                </>,
                <>
                  <strong>Where is it wrong?</strong> Pick a price (often below the nearest support level, or back below the old
                  90-day high after a breakout) where the idea no longer holds. If you cannot name one, skip the trade.
                </>,
                <>
                  <strong>Is the liquidity real?</strong> Thinly traded coins can show huge percentage moves that you could never
                  actually buy or sell at in size.
                </>,
                <>
                  <strong>What is the supply story?</strong> Large upcoming token unlocks are a common reason strong-looking new
                  coins keep falling. This is not in the app&apos;s data; look it up.
                </>,
              ]}
            />
          </Section>

          <Section id="pages" title="Every page explained">
            <dl className="space-y-3">
              {[
                [
                  "Dashboard",
                  "/dashboard",
                  "Paper portfolio value over 90 days, market overview (advancers vs decliners, top movers), open positions, watchlist, recent simulated trades and recent AI reports.",
                ],
                [
                  "Market Scanner",
                  "/market",
                  "Every tradable Binance Spot pair with search, quote-asset choice, up/down filter, volume and price ranges, and sorting by gainers, losers or volume. Use it to look up any pair; use Discovery to find candidates.",
                ],
                [
                  "Discovery",
                  "/discover",
                  "The candidate screens described above, with one-click watchlisting and AI shortlist reviews.",
                ],
                [
                  "Coin pages",
                  "/market",
                  "Click any pair. Live price, candlestick or line charts from 1-minute to weekly candles, EMA and Bollinger overlays, an indicator panel (RSI, MACD, moving averages, volume, volatility, support and resistance), first Binance trading date, simulated buy and sell, alerts, watchlist notes, journal entries and AI reports for that pair.",
                ],
                [
                  "Watchlist",
                  "/watchlist",
                  "Pairs you are tracking, with your reason, notes, target price, a 1–10 personal ranking and the performance since you added them. Removed pairs are kept in the history.",
                ],
                [
                  "Portfolio",
                  "/portfolio",
                  "Your paper portfolio: theoretical USDT, holdings at average cost with fees, transactions and charts. You can mark a simulated trade as actually executed on Binance and record the real fill; nothing is imported automatically.",
                ],
                [
                  "AI Research",
                  "/research",
                  "Chat with the AI analyst. It sees Binance data for the coins you mention, and your portfolio, watchlist and journal when the question is about them. Structured reports live under Analysis reports and are scored afterwards at 1h, 24h, 7d and 30d.",
                ],
                [
                  "Decision Journal",
                  "/journal",
                  "Your reasoning at the moment of each decision (thesis, reason, target, horizon, risk, confidence) and later reviews. Entries are never silently rewritten.",
                ],
                [
                  "Analytics",
                  "/analytics",
                  "Win rate, average return, holding periods, 'sold too early' and 'bought near local highs' checks, drawdown, monthly returns, comparison with simply holding BTC or ETH, and the AI's track record.",
                ],
                [
                  "Settings",
                  "/settings",
                  "Paper portfolio starting balance, quote currency and fees, how often alerts are checked, and the status of the database, Binance and AI connections.",
                ],
              ].map(([name, href, text]) => (
                <div key={name} className="grid gap-1 sm:grid-cols-[160px_minmax(0,1fr)]">
                  <dt className="font-medium">
                    <P href={href!}>{name}</P>
                  </dt>
                  <dd className="text-muted">{text}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted">
              <strong className="text-fg">Alerts</strong> (price above/below, % move, position profit/loss) are checked while the app
              is open and once a day by the background job. Triggered alerts appear under the bell in the top bar.
            </p>
          </Section>

          <Section id="data" title="Data and its limits">
            <Bullets
              items={[
                "All market data comes from Binance Spot public endpoints. No other exchange, no market caps, no news and no on-chain data.",
                "Each table and chart shows when its data was fetched. An amber 'Stale' badge means Binance could not be reached and you are seeing the last good copy.",
                "'First Binance trading data' is the first daily candle on Binance. It is not the project's launch date, and the coin may have traded elsewhere long before.",
                "Indicators are calculated by the app from closed candles. They describe the past; all of them lag and give false signals, especially in thin or news-driven markets.",
                "The AI only knows the data the app gives it. It cannot see news or token unlocks, and it is instructed never to present a prediction as fact.",
              ]}
            />
          </Section>

          <Section id="safety" title="What this app never does">
            <Bullets
              items={[
                "It never trades. Every buy and sell is simulated with theoretical funds.",
                "It never asks for Binance API keys, seed phrases, private keys or withdrawal permissions.",
                "It does not give financial advice. Screens, indicators and AI reviews are research aids; the decisions, and their consequences, are yours.",
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
