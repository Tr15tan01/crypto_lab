"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/radix";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { formatUsd } from "@/lib/utils/format";

function useSaver() {
  const [state, setState] = useState<{ saving: boolean; error: string | null; ok: string | null }>({ saving: false, error: null, ok: null });
  const run = async (fn: () => Promise<void>, ok: string) => {
    setState({ saving: true, error: null, ok: null });
    try {
      await fn();
      setState({ saving: false, error: null, ok });
    } catch (err) {
      setState({ saving: false, error: err instanceof ApiClientError ? err.message : "Could not save.", ok: null });
    }
  };
  return { ...state, run };
}

export function FeeSettingsForm({ enabled, ratePercent }: { enabled: boolean; ratePercent: number }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [rate, setRate] = useState(String(ratePercent));
  const s = useSaver();
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-[13px]">
        Include estimated trading fees
        <Switch checked={on} onCheckedChange={setOn} aria-label="Include estimated trading fees" />
      </label>
      <Field label="Fee per trade (%)" htmlFor="fee-rate" hint="Binance's standard spot fee is 0.1%. Applies to future simulated trades only.">
        <Input id="fee-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!on} className="w-32" />
      </Field>
      {s.error ? <Notice tone="down">{s.error}</Notice> : null}
      {s.ok ? <Notice tone="up">{s.ok}</Notice> : null}
      <Button
        variant="secondary"
        loading={s.saving}
        onClick={() =>
          void s.run(async () => {
            await apiFetch("/api/portfolio/settings", { method: "PATCH", json: { feeEnabled: on, feeRatePercent: Number(rate) || 0 } });
            router.refresh();
          }, "Fee settings saved.")
        }
      >
        Save fee settings
      </Button>
    </div>
  );
}

export function ResetPortfolioForm({ currentQuote }: { currentQuote: string }) {
  const router = useRouter();
  const [balance, setBalance] = useState("1000");
  const [quote, setQuote] = useState(currentQuote);
  const [feeOn, setFeeOn] = useState(true);
  const [rate, setRate] = useState("0.1");
  const [confirm, setConfirm] = useState("");
  const s = useSaver();
  const amount = Number(balance);
  return (
    <div className="space-y-3">
      <Notice tone="warn">
        Starts a new paper portfolio. The current one is archived with all its transactions and snapshots — nothing is deleted.
      </Notice>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starting balance" htmlFor="r-balance">
          <Input id="r-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </Field>
        <Field label="Quote currency" htmlFor="r-quote" hint="Only pairs quoted in this asset can be simulated.">
          <Select id="r-quote" value={quote} onChange={(e) => setQuote(e.target.value)}>
            {["USDT", "USDC", "FDUSD"].map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center justify-between gap-3 text-[13px] sm:col-span-2">
          Include estimated trading fees
          <Switch checked={feeOn} onCheckedChange={setFeeOn} aria-label="Include fees in the new portfolio" />
        </label>
        <Field label="Fee per trade (%)" htmlFor="r-rate">
          <Input id="r-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!feeOn} />
        </Field>
        <Field label='Type "RESET" to confirm' htmlFor="r-confirm">
          <Input id="r-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      {s.error ? <Notice tone="down">{s.error}</Notice> : null}
      {s.ok ? <Notice tone="up">{s.ok}</Notice> : null}
      <Button
        variant="danger"
        loading={s.saving}
        disabled={confirm !== "RESET" || !(amount >= 10)}
        onClick={() =>
          void s.run(async () => {
            await apiFetch("/api/portfolio/settings", {
              method: "POST",
              json: { initialBalance: amount, quoteAsset: quote, feeEnabled: feeOn, feeRatePercent: Number(rate) || 0, confirmReset: true },
            });
            setConfirm("");
            router.refresh();
          }, `New portfolio started with ${formatUsd(amount)}.`)
        }
      >
        Archive and start new portfolio
      </Button>
    </div>
  );
}

export function AlertIntervalForm({ seconds }: { seconds: number }) {
  const [value, setValue] = useState(String(seconds));
  const s = useSaver();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Alert polling interval" htmlFor="poll" hint="How often the open app checks alerts. Minimum 15 s. Prices come from the shared cache.">
        <Select id="poll" value={value} onChange={(e) => setValue(e.target.value)} className="w-40">
          {[15, 30, 60, 120, 300, 600].map((v) => (
            <option key={v} value={String(v)}>{v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? "" : "s"}`}</option>
          ))}
        </Select>
      </Field>
      <Button
        variant="secondary"
        loading={s.saving}
        onClick={() => void s.run(async () => { await apiFetch("/api/settings", { method: "PATCH", json: { alertPollIntervalSeconds: Number(value) } }); }, "Saved.")}
      >
        Save
      </Button>
      {s.error ? <Notice tone="down" className="w-full">{s.error}</Notice> : null}
      {s.ok ? <span className="text-xs text-up">{s.ok}</span> : null}
    </div>
  );
}
