"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, FlaskConical, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/radix";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import { apiFetch, ApiClientError, newIdempotencyKey } from "@/lib/client/api";
import { cn, formatDateTime, formatPercent, formatPrice, formatQuantity, formatUsd } from "@/lib/utils/format";
import { EMPTY_JOURNAL, JournalFields, journalPayload, type JournalDraft, type ResearchOption } from "./journal-fields";

export interface TradeContext {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number | null;
  priceFetchedAt: string | null;
  priceStale: boolean;
  tradable: boolean;
  availableBalance: number;
  portfolioQuoteAsset: string;
  feeRatePercent: number;
  holdingQuantity: number;
  averageCost: number;
}

type Step = "form" | "review" | "done";

function round(v: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function TradeDialog({
  side,
  ctx,
  researchOptions,
  trigger,
}: {
  side: "buy" | "sell";
  ctx: TradeContext;
  researchOptions?: ResearchOption[];
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState("");
  const [sellAll, setSellAll] = useState(false);
  const [journal, setJournal] = useState<JournalDraft>(EMPTY_JOURNAL);
  const [showJournal, setShowJournal] = useState(false);
  const [price, setPrice] = useState<number | null>(ctx.price);
  const [priceAt, setPriceAt] = useState<string | null>(ctx.priceFetchedAt);
  const [stale, setStale] = useState(ctx.priceStale);
  const [ackStale, setAckStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ quantity: number; price: number; total: number; realizedPnL?: number } | null>(null);
  const idempotencyKey = useRef<string>("");

  const reset = () => {
    setStep("form");
    setAmount("");
    setSellAll(false);
    setJournal(EMPTY_JOURNAL);
    setShowJournal(false);
    setPrice(ctx.price);
    setPriceAt(ctx.priceFetchedAt);
    setStale(ctx.priceStale);
    setAckStale(false);
    setError(null);
    setNotice(null);
    setResult(null);
    idempotencyKey.current = newIdempotencyKey();
  };

  const quoteMismatch = ctx.quoteAsset !== ctx.portfolioQuoteAsset;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const feeRate = ctx.feeRatePercent / 100;

  const estimate = useMemo(() => {
    if (!price) return null;
    if (side === "buy") {
      if (!valid) return null;
      const fee = value * feeRate;
      return { quantity: value / price, gross: value, fee, total: value + fee };
    }
    const qty = sellAll ? ctx.holdingQuantity : valid ? value : 0;
    if (!qty) return null;
    const gross = qty * price;
    const fee = gross * feeRate;
    const proceeds = gross - fee;
    const basis = qty * ctx.averageCost;
    return { quantity: qty, gross, fee, total: proceeds, pnl: proceeds - basis, pnlPct: basis ? ((proceeds - basis) / basis) * 100 : null };
  }, [price, side, valid, value, feeRate, sellAll, ctx.holdingQuantity, ctx.averageCost]);

  const formError = (() => {
    if (!ctx.tradable) return `${ctx.symbol} is not currently tradable on Binance.`;
    if (quoteMismatch) return `Your paper portfolio holds ${ctx.portfolioQuoteAsset}; trade a ${ctx.baseAsset}${ctx.portfolioQuoteAsset} pair instead.`;
    if (!price) return "A current price is not available, so a simulated trade cannot be priced.";
    if (side === "buy" && estimate && estimate.total > ctx.availableBalance + 1e-9)
      return `Not enough virtual cash — this costs ${formatUsd(estimate.total)} including fees.`;
    if (side === "sell" && !sellAll && valid && value > ctx.holdingQuantity + 1e-12) return "You cannot sell more than you hold.";
    return null;
  })();

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        symbol: ctx.symbol,
        idempotencyKey: idempotencyKey.current,
        expectedPrice: price ?? undefined,
        acknowledgeStale: stale ? ackStale : undefined,
        journal: journalPayload(journal),
        ...(side === "buy" ? { quoteAmount: value } : sellAll ? { sellAll: true } : { quantity: value }),
      };
      const res = await apiFetch<{
        transaction: { quantity: number; price: number; total: number; realizedPnL?: number };
      }>(`/api/portfolio/${side}`, { method: "POST", json: body });
      setResult(res.transaction);
      setStep("done");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === "PRICE_CHANGED" || err.code === "STALE_DATA")) {
        const d = err.details as { price?: number; fetchedAt?: string } | undefined;
        if (d?.price) setPrice(d.price);
        if (d?.fetchedAt) setPriceAt(d.fetchedAt);
        if (err.code === "STALE_DATA") setStale(true);
        setNotice(err.message);
        // The server did not record anything; a new key avoids replaying a rejected request.
        idempotencyKey.current = newIdempotencyKey();
      } else {
        setError(err instanceof ApiClientError ? err.message : "The trade could not be saved. Nothing was recorded.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const title = side === "buy" ? `Simulate buy · ${ctx.baseAsset}` : `Simulate sell · ${ctx.baseAsset}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={title}
        description="Paper trade with theoretical funds. Nothing is sent to Binance."
        wide={showJournal}
      >
        {step === "done" && result ? (
          <div className="space-y-4">
            <Notice tone="up" title="Simulated trade recorded">
              {side === "buy" ? "Bought" : "Sold"} {formatQuantity(result.quantity)} {ctx.baseAsset} at{" "}
              {formatPrice(result.price)} for {formatUsd(result.total)}
              {side === "sell" && result.realizedPnL !== undefined ? ` · realized ${formatUsd(result.realizedPnL, { sign: true })}` : ""}.
            </Notice>
            <p className="text-xs text-muted">
              It is recorded as <b>not executed</b> on Binance. If you place this trade on Binance yourself, update its real-world status
              from the portfolio transaction list.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-bg p-3 text-xs">
              <div>
                <p className="text-muted">Market price</p>
                <p className="num mt-0.5 text-sm">{formatPrice(price)}</p>
                <p className={cn("mt-0.5 text-[11px]", stale ? "text-warn" : "text-faint")}>
                  {stale ? "Not live · " : ""}
                  {priceAt ? formatDateTime(priceAt) : "—"}
                </p>
              </div>
              {side === "buy" ? (
                <div>
                  <p className="text-muted">Available virtual cash</p>
                  <p className="num mt-0.5 text-sm">{formatUsd(ctx.availableBalance)}</p>
                  <p className="mt-0.5 text-[11px] text-faint">Fee {ctx.feeRatePercent}%</p>
                </div>
              ) : (
                <div>
                  <p className="text-muted">You hold</p>
                  <p className="num mt-0.5 text-sm">
                    {formatQuantity(ctx.holdingQuantity)} {ctx.baseAsset}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">Avg cost {formatPrice(ctx.averageCost)}</p>
                </div>
              )}
            </div>

            {stale ? (
              <Notice tone="warn" title="Live price unavailable">
                Binance could not be reached, so the price above is the last known value. You can still simulate the trade at that price
                only if you confirm it explicitly.
              </Notice>
            ) : null}
            {notice ? <Notice tone="warn">{notice}</Notice> : null}

            {step === "form" ? (
              <>
                {side === "buy" ? (
                  <Field label={`Amount to invest (${ctx.quoteAsset})`} htmlFor="t-amount">
                    <Input
                      id="t-amount"
                      inputMode="decimal"
                      autoFocus
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 100"
                      aria-invalid={Boolean(formError && valid)}
                    />
                    <div className="mt-1.5 flex gap-1">
                      {[0.1, 0.25, 0.5, 1].map((f) => (
                        <button
                          key={f}
                          type="button"
                          className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
                          onClick={() => setAmount(String(Math.floor((ctx.availableBalance / (1 + feeRate)) * f * 100) / 100))}
                        >
                          {f === 1 ? "Max" : `${f * 100}%`}
                        </button>
                      ))}
                    </div>
                  </Field>
                ) : (
                  <Field label={`Quantity to sell (${ctx.baseAsset})`} htmlFor="t-qty">
                    <Input
                      id="t-qty"
                      inputMode="decimal"
                      autoFocus
                      value={sellAll ? String(ctx.holdingQuantity) : amount}
                      disabled={sellAll}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <div className="mt-1.5 flex gap-1">
                      {[0.25, 0.5].map((f) => (
                        <button
                          key={f}
                          type="button"
                          className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
                          onClick={() => {
                            setSellAll(false);
                            setAmount(String(round(ctx.holdingQuantity * f, 10)));
                          }}
                        >
                          {f * 100}%
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={sellAll}
                        className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[11px]",
                          sellAll ? "border-accent/50 text-accent" : "border-border text-muted hover:text-fg",
                        )}
                        onClick={() => setSellAll((v) => !v)}
                      >
                        Sell all
                      </button>
                    </div>
                  </Field>
                )}

                <Estimate side={side} estimate={estimate} ctx={ctx} />

                <button
                  type="button"
                  onClick={() => setShowJournal((v) => !v)}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-xs text-muted hover:text-fg"
                  aria-expanded={showJournal}
                >
                  <span>Decision journal — thesis, target, risk, confidence (recommended)</span>
                  <ChevronDown className={cn("size-3.5 transition-transform", showJournal && "rotate-180")} />
                </button>
                {showJournal ? (
                  <JournalFields value={journal} onChange={setJournal} decision={side} researchOptions={researchOptions} />
                ) : null}

                {formError && (side === "sell" || valid) ? <Notice tone="down">{formError}</Notice> : null}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant={side === "buy" ? "up" : "down"}
                    disabled={!estimate || Boolean(formError)}
                    onClick={() => setStep("review")}
                  >
                    Review {side}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Estimate side={side} estimate={estimate} ctx={ctx} emphasize />
                {stale ? (
                  <label className="flex items-start gap-2 text-xs text-fg">
                    <input type="checkbox" className="mt-0.5 accent-[#e0b354]" checked={ackStale} onChange={(e) => setAckStale(e.target.checked)} />
                    I understand this simulation uses a last-known price that may not reflect the current market.
                  </label>
                ) : null}
                {error ? <Notice tone="down">{error}</Notice> : null}
                <p className="flex items-center gap-1.5 text-[11px] text-faint">
                  <FlaskConical className="size-3" /> The final price is re-checked on the server when you confirm.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setStep("form")} disabled={submitting}>
                    Back
                  </Button>
                  <Button
                    variant={side === "buy" ? "up" : "down"}
                    loading={submitting}
                    disabled={Boolean(formError) || (stale && !ackStale)}
                    onClick={() => void submit()}
                  >
                    Confirm simulated {side}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Estimate({
  side,
  estimate,
  ctx,
  emphasize,
}: {
  side: "buy" | "sell";
  estimate: { quantity: number; gross: number; fee: number; total: number; pnl?: number; pnlPct?: number | null } | null;
  ctx: TradeContext;
  emphasize?: boolean;
}) {
  const rows: Array<[string, React.ReactNode]> =
    side === "buy"
      ? [
          ["Estimated quantity", estimate ? `${formatQuantity(estimate.quantity)} ${ctx.baseAsset}` : "—"],
          ["Investment", estimate ? formatUsd(estimate.gross) : "—"],
          [`Estimated fee (${ctx.feeRatePercent}%)`, estimate ? formatUsd(estimate.fee) : "—"],
          ["Total theoretical cost", estimate ? formatUsd(estimate.total) : "—"],
        ]
      : [
          ["Quantity", estimate ? `${formatQuantity(estimate.quantity)} ${ctx.baseAsset}` : "—"],
          ["Estimated proceeds", estimate ? formatUsd(estimate.gross) : "—"],
          [`Estimated fee (${ctx.feeRatePercent}%)`, estimate ? formatUsd(estimate.fee) : "—"],
          ["Net proceeds", estimate ? formatUsd(estimate.total) : "—"],
          [
            "Realized profit / loss",
            estimate?.pnl !== undefined ? (
              <span className={estimate.pnl >= 0 ? "text-up" : "text-down"}>
                {estimate.pnl >= 0 ? "▲" : "▼"} {formatUsd(estimate.pnl, { sign: true })}
                {estimate.pnlPct !== null && estimate.pnlPct !== undefined ? ` (${formatPercent(estimate.pnlPct)})` : ""}
              </span>
            ) : (
              "—"
            ),
          ],
        ];
  return (
    <dl className={cn("space-y-1.5 rounded-md border border-border p-3 text-xs", emphasize && "border-border-strong bg-surface-2")}>
      {rows.map(([k, v], i) => (
        <div key={k} className={cn("flex justify-between gap-3", i === rows.length - 1 && side === "buy" && "border-t border-border pt-1.5 font-medium")}>
          <dt className="text-muted">{k}</dt>
          <dd className="num text-right">{v}</dd>
        </div>
      ))}
      {side === "sell" ? (
        <p className="pt-1 text-[11px] text-faint">Profit is measured against your average cost (fees included).</p>
      ) : null}
      {emphasize && side === "buy" && estimate ? (
        <p className="flex items-center gap-1 pt-1 text-[11px] text-faint">
          <TriangleAlert className="size-3" /> Quantity is final only after the server re-prices the order.
        </p>
      ) : null}
    </dl>
  );
}
