/**
 * Research check: runs the signal backtest, the exit-rule backtest and the learning model's
 * walk-forward validation on live Binance data and prints the results. Read-only (nothing is
 * written to the database).
 *
 *   npm run research
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { loadUniverseHistories } = await import("../src/services/backtest/backtest-service");
  const { runBacktest } = await import("../src/services/backtest/signal-backtest");
  const { runExitBacktest, EXIT_RULES } = await import("../src/services/backtest/exit-backtest");
  const { buildTrainingSet } = await import("../src/services/learning/learning-service");
  const M = await import("../src/services/learning/model");

  const { pairs, btc } = await loadUniverseHistories();
  const alts = pairs.filter((p) => p.symbol !== "BTCUSDT");

  const bt = runBacktest(alts, btc);
  console.log(`\nSignals: result 7 and 30 days after each signal fired (${bt.pairs} pairs)`);
  for (const s of bt.results) {
    const f = (h: number) => {
      const x = s.stats.find((y) => y.horizonDays === h);
      return x ? `n=${x.events} win=${x.winRatePercent}% vsBTC=${x.meanVsBtcPercent}% t=${x.tStat}` : "-";
    };
    console.log(s.key.padEnd(20), "7d:", f(7), "| 30d:", f(30));
  }

  const ex = runExitBacktest(alts, btc);
  console.log(`\nExit rules (${ex.pairs} pairs)`);
  for (const r of ex.results) {
    console.log(`-- entries: ${r.entry}`);
    for (const s of r.stats) {
      const label = EXIT_RULES.find((x) => x.key === s.rule)!.label;
      console.log(
        `${label.padEnd(34)} n=${String(s.trades).padStart(5)} win=${s.winRatePercent}% avg=${s.avgReturnPercent}% hold=${s.avgHoldDays}d PF=${s.profitFactor} p10=${s.p10ReturnPercent}%`,
      );
    }
  }

  const set = buildTrainingSet(pairs, btc);
  if (!set) throw new Error("BTC history unavailable");
  const cv = M.crossValidate(set.samples);
  const res = M.evaluatePredictions(cv.samples, cv.probs);
  console.log(`\nLearning model (${set.samples.length} samples, ${set.universe.length} coins; excluded ${set.excluded.join(", ") || "none"})`);
  console.log(`pooled out-of-sample AUC ${res.metrics.auc}  IC ${cv.validation.ic} (t ${cv.validation.icT})  top-bottom 20% ${cv.validation.topBottomPercent}%/wk  periods positive ${cv.validation.positiveFolds}/${cv.validation.folds.length}`);
  for (const f of cv.validation.folds) console.log(`  ${new Date(f.from).toISOString().slice(0, 10)} → ${new Date(f.to).toISOString().slice(0, 10)}  n=${f.samples}  AUC ${f.auc}  IC ${f.ic}`);
  console.log("deciles (avg result vs typical coin):", res.deciles.map((d) => `${d.decile}:${d.avgExcessPercent}%`).join(" "));
  for (const l of M.lessons(M.train(set.samples)).slice(0, 8)) console.log(`  ${l.weight > 0 ? "+" : ""}${l.weight.toFixed(3)} ${l.label}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
