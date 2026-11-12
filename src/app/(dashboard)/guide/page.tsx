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
  { id: "strategies", title: "Strategies to test" },
  { id: "pages", title: "Every page explained" },
  { id: "data", title: "Data and its limits" },
  { id: "safety", title: "What this app never does" },
];

interface Strategy {
  name: string;
  idea: string;
  worksWhen: string;
  howHere: React.ReactNode;
  entry: string;
  exit: string;
  fails: string;
}

const STRATEGIES: Strategy[] = [
  {
    name: "Trend following",
    idea: "Only own coins that are already going up, and stay in while the trend holds. You give up the bottom and the top to catch the middle.",
    worksWhen: "Sustained bull phases: BTC above its 200-day average and most coins above their 50-day.",
    howHere: (
      <>
        <P href="/discover">Discovery</P> → Strength vs BTC and Golden cross; check that the <P href="/autopilot">Autopilot</P> market regime is
        Risk-on; on the coin page confirm the price is above the 50- and 200-day lines.
      </>
    ),
    entry: "Price above the 50-day average, 50-day above 200-day, RSI 50–70 (strong but not stretched).",
    exit: "Daily close below the 20-day average (the exit that tested best), with a safety stop about 3× ATR below your entry.",
    fails: "Sideways, choppy markets, where you get stopped out repeatedly. Expect a low win rate offset by large winners.",
  },
  {
    name: "Breakout with volume",
    idea: "Buy when the price clears its 90-day high on unusually high volume: fresh buyers overpowering old sellers.",
    worksWhen: "After long ranges, especially when BTC is stable or rising.",
    howHere: (
      <>
        <P href="/signals">Signal Lab</P> shows how 90-day highs and unusual volume have actually performed; find them in{" "}
        <P href="/discover">Discovery</P> and use Set alerts on the Autopilot card to put the stop in right away.
      </>
    ),
    entry: "Daily close above the 90-day high with volume at least 2× its usual level.",
    exit: "Daily close below the 20-day average, with a safety stop about 3× ATR below entry. On breakouts this beat fixed targets and tight stops by a wide margin in the backtest.",
    fails: "False breakouts that close back inside the range within days. The trend exit gets you out of those quickly.",
  },
  {
    name: "Relative-strength rotation",
    idea: "Hold the few coins beating BTC and rotate out of those that stop beating it. It measures strength against the market, not in isolation.",
    worksWhen: "Altcoin seasons, when money spreads from BTC into other coins.",
    howHere: (
      <>
        The <P href="/learning">Learning</P> model&apos;s top picks rank coins by their chance to do better than the typical coin over 7 days; review them weekly next to
        Discovery&apos;s Strength vs BTC screen.
      </>
    ),
    entry: "In the top group for two weekly reviews in a row, with real liquidity (24h volume above $1M).",
    exit: "Drops out of the top group, or underperforms BTC for two weeks.",
    fails: "When BTC dominates and altcoins all lag it: stay in BTC or cash instead.",
  },
  {
    name: "Buy fear, trim greed",
    idea: "Sentiment is contrarian at the extremes: panic tends to mark better entries than euphoria.",
    worksWhen: "Long-term holders of quality, liquid coins (BTC, ETH, majors) who can wait.",
    howHere: (
      <>
        Every journal entry and watchlist addition records the Fear &amp; Greed index; <P href="/analytics">Analytics</P> → What works for you shows
        how your own buys did by market mood.
      </>
    ),
    entry: "Fear & Greed at 25 or below; buy in two or three tranches days apart rather than all at once.",
    exit: "Trim about a third at 75+ (extreme greed) and keep a core position.",
    fails: "Real bear markets stay fearful for months. Never use leverage or money you need soon.",
  },
  {
    name: "Dollar-cost averaging",
    idea: "Buy a fixed amount on a fixed schedule, whatever the price. It takes timing out of the decision.",
    worksWhen: "Long horizons (1–4 years) in assets you expect to survive.",
    howHere: (
      <>
        Simulate it in the <P href="/portfolio">Portfolio</P> with the same amount every week; <P href="/analytics">Analytics</P> compares the result
        with simply holding BTC.
      </>
    ),
    entry: "Same weekday, same amount, every week (or month).",
    exit: "A planned target value or date; optionally pause buying in extreme greed.",
    fails: "Averaging into a coin that keeps falling for good: limit it to major, liquid assets.",
  },
  {
    name: "Volatility squeeze",
    idea: "An unusually quiet period is usually followed by a big move. Wait for the direction, then join it.",
    worksWhen: "Any market; most useful on liquid coins trading in a clear range.",
    howHere: (
      <>
        <P href="/discover">Discovery</P> → Early setups → Volatility squeeze. Set price alerts above and below the range from the coin page, then
        act on whichever side breaks.
      </>
    ),
    entry: "A daily close outside the Bollinger Bands after the squeeze, in the breakout direction only.",
    exit: "Stop back inside the range; target the height of the range projected from the breakout.",
    fails: "Breaks that reverse immediately. Never buy the squeeze itself before the direction is known.",
  },
  {
    name: "Fibonacci pullback",
    idea: "After a strong rise, buy the dip when the price has given back 50–65% of it (the “golden pocket” between the 0.5 and 0.618 levels).",
    worksWhen: "Unproven. In this app's backtest it did slightly better than BTC, but not reliably enough to rule out luck.",
    howHere: (
      <>
        <P href="/discover">Discovery</P> → Early setups flags it, coin pages list the levels and the chart has a Fibonacci overlay.{" "}
        <P href="/signals">Signal Lab</P> shows its current track record; Autopilot ignores it until that record is statistically solid.
      </>
    ),
    entry: "Inside the 0.5–0.618 band of a 25%+ rise that peaked within 30 days, ideally with another signal agreeing.",
    exit: "Daily close below the 20-day average, or a close below the 0.786 level (the pullback has become a reversal).",
    fails: "When the rise was the end of a move, not the start: the price slices through every level.",
  },
  {
    name: "Study the top traders, don't copy them",
    idea: "Use consistently profitable traders as a source of ideas and a confirmation, not as a signal to mirror.",
    worksWhen: "Traders with long histories, drawdowns under about 30%, real capital and positive copier P&L.",
    howHere: (
      <>
        <P href="/traders">Top Traders</P> → Track: their profile shows what they hold now, every buy and sell with size and time, where their
        money goes, and whether their strategy is changing. Autopilot also counts what top traders opened this week.
      </>
    ),
    entry: "Only when your own analysis agrees with what several tracked traders hold.",
    exit: "Your own stop and target. They use leverage and may exit long before or after you.",
    fails: "Survivorship: today's top ROI is often yesterday's luck. Watch for “Changing” strategy badges.",
  },
  {
    name: "Let the evidence vote",
    idea: "Combine independent views and act only when most of them agree.",
    worksWhen: "Always, as a filter: it cuts the number of trades and raises their quality.",
    howHere: (
      <>
        A coin qualifies when <P href="/autopilot">Autopilot</P> says Buy, the <P href="/learning">Learning</P> model gives it an above-typical
        chance to beat BTC, its scorecard is positive, and an AI chat verdict agrees. The accuracy gauges show which of them has been right lately.
      </>
    ),
    entry: "At least three of the four agree; size it with Autopilot's risk-based amount.",
    exit: "When two of them turn against it, or the stop is hit.",
    fails: "When every view shares the same blind spot, such as unexpected news. Use stops.",
  },
];

const EXIT_FINDINGS = [
  "The trend exit won on every kind of entry: sell on the first daily close below the 20-day average, with a wide safety stop (about 3× ATR below entry) for sudden drops.",
  "Tight stops (2× ATR) did far worse, and lost money on ordinary entries: normal daily swings in crypto hit them before the trade has a chance.",
  "Fixed profit targets cut the big winners that pay for all the small losses. Let a winner run until the trend exit fires.",
  "Expect to be wrong often: the best rule won fewer than 4 trades in 10, but its winners were far larger than its losers. Judge it by profit factor, not win rate.",
  "Holding and hoping was the most dangerous: without a stop, 1 trade in 10 lost more than 30% within a month.",
];

const RISK_RULES = [
  "Risk at most 1% of the portfolio per trade: position size = 1% of the portfolio ÷ the distance to your stop. Autopilot calculates this for you.",
  "Decide your exit before you buy: the 20-day average as the trend exit and a safety stop about 3× ATR below entry. Set both as price alerts straight away.",
  "Keep any single position under 15–25% of the portfolio, and keep at least 5% in cash.",
  "After three losses in a row, halve your position size until you have a win.",
  "Record every decision in the Decision Journal (the market snapshot is saved automatically) and review it when your horizon ends.",
  "Test a strategy for at least 20 paper trades before trusting it; Analytics → Trade quality tells you whether it pays.",
];

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Panel id={id} className="scroll-mt-20">
      <PanelHeader title={title} description={description} />
      <PanelBody className="space-y-3 text-[0.8125rem] leading-relaxed text-fg/90">{children}</PanelBody>
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
          <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-[0.6875rem] text-accent">
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
  {
    name: "Early setups",
    what: "A volatility squeeze, a dip inside a long-term uptrend, or volume accumulating while the price is flat.",
    why: "These fire before a move rather than after it, so entries are closer to the start of a trend and stops can sit closer.",
    watchOut: "A squeeze says a big move is likely, not which way. Wait for the breakout direction, and treat accumulation as a hint until price confirms it.",
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
            <ul className="p-2 text-[0.8125rem]">
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
            description={`Every liquid USDT pair is checked against ${DISCOVERY_SIGNALS.length} signals, using daily candles from Binance. The scan refreshes every 15 minutes.`}
          >
            <p>
              The scan covers USDT pairs trading at least 250K per day (up to 300 pairs, stablecoins excluded). Each tab is a screen
              built from these signals:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[0.8125rem]">
                <thead>
                  <tr className="border-b border-border text-left text-[0.6875rem] text-muted">
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
                  <h3 className="text-[0.8125rem] font-semibold text-fg">{s.name}</h3>
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

          <Section
            id="strategies"
            title="Strategies to test"
            description="Well-known approaches and how to run each one with this app. None is guaranteed: test them with paper money and keep the ones your own results support."
          >
            <div className="grid gap-3 lg:grid-cols-2">
              {STRATEGIES.map((st) => (
                <div key={st.name} className="rounded-lg border border-border bg-surface-2/40 p-3.5">
                  <p className="text-[0.8125rem] font-semibold text-fg">{st.name}</p>
                  <p className="mt-1 text-muted">{st.idea}</p>
                  <dl className="mt-2.5 space-y-1.5 text-xs">
                    <div><dt className="inline font-medium text-fg">Works when: </dt><dd className="inline text-muted">{st.worksWhen}</dd></div>
                    <div><dt className="inline font-medium text-fg">In this app: </dt><dd className="inline text-muted">{st.howHere}</dd></div>
                    <div><dt className="inline font-medium text-up">Entry: </dt><dd className="inline text-muted">{st.entry}</dd></div>
                    <div><dt className="inline font-medium text-down">Exit: </dt><dd className="inline text-muted">{st.exit}</dd></div>
                    <div><dt className="inline font-medium text-warn">Fails when: </dt><dd className="inline text-muted">{st.fails}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3.5">
              <p className="text-[0.8125rem] font-semibold text-fg">Getting out: what the exit backtest found</p>
              <p className="mt-1 text-xs text-muted">
                Seven exit rules were tested on the same entries over about 2.5 years of daily data for the 100 most liquid coins. Current numbers
                are in <P href="/signals">Signal Lab</P> → Which exit rule worked best; <P href="/autopilot">Autopilot</P> shows the exit level for
                every position and idea.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                {EXIT_FINDINGS.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border p-3.5">
              <p className="text-[0.8125rem] font-semibold text-fg">Rules that apply to every strategy</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                {RISK_RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
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
                  "Autopilot",
                  "/autopilot",
                  "A plan for the paper portfolio: buy, watch or avoid for new coins and hold, add, trim or sell for positions, with timing, entry zone, target, stop and a risk-based size. Also shows portfolio risk (loss if every stop is hit, concentration, BTC correlation). Every position and buy idea carries an exit plan (the 20-day average and a safety stop). One click sets price alerts; calls are scored after 7 days. The page picks up a fresh plan every 5 minutes.",
                ],
                [
                  "Signal Lab",
                  "/signals",
                  "A backtest of every discovery signal over ~2.5 years: win rate, median return and result vs BTC 7 and 30 days after it fired, compared with a random-coin baseline. Tells you which signals have actually worked; Autopilot uses it to weight them. A second table compares seven exit rules on the same entries.",
                ],
                [
                  "Learning",
                  "/learning",
                  "The app's self-learning model. Every day it replays ~2.5 years of daily data for the 100 most liquid pairs, learns which factors predicted a coin doing better than the typical coin over the next week, and tests that on six later periods it never saw. Shows what it learned in plain words, how reliable it proved (AUC, top-vs-bottom spread, calibration), how its views changed between runs, its current picks, and how well its own past calls were calibrated. Its view appears on coin pages, in Autopilot (weighted by its proven skill) and in the AI chat.",
                ],
                [
                  "Top Traders",
                  "/traders",
                  "Discover Binance copy-trading leaders or track anyone manually. A trader's profile shows what they hold now (priced live, with exposure and leverage), a dated timeline of every buy and sell with size, where their money goes per coin, returns, drawdown, holding times and whether their strategy is changing.",
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
            <p className="text-muted">
              <strong className="text-fg">Quick search:</strong> press <kbd className="rounded-sm border border-border-strong bg-surface-3 px-1 font-mono text-[0.6875rem]">Ctrl K</kbd> (⌘K on a Mac) anywhere to jump to a coin or a page.
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
