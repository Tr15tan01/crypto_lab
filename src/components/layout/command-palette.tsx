"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Star, Wallet } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/radix";
import { Kbd } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/client/api";
import { cn, formatPercent, formatPrice } from "@/lib/utils/format";
import { NAV_ITEMS } from "./nav";

interface Coin {
  symbol: string;
  baseAsset: string;
  name: string | null;
  price: number;
  priceChangePercent: number;
  quoteVolume: number;
  watched: boolean;
  held: boolean;
}

type Item =
  | { kind: "page"; key: string; label: string; href: string; icon: (typeof NAV_ITEMS)[number]["icon"] }
  | { kind: "coin"; key: string; coin: Coin };

const MAX_COINS = 12;

/** Ctrl/⌘+K: jump to any page or coin. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || coins) return;
    apiFetch<{ rows: Coin[] }>("/api/market/tickers?quote=USDT")
      .then((d) => setCoins(d.rows.sort((a, b) => b.quoteVolume - a.quoteVolume)))
      .catch(() => setCoins([]));
  }, [open, coins]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Item[] = NAV_ITEMS.filter((n) => !q || n.label.toLowerCase().includes(q)).map((n) => ({
      kind: "page",
      key: n.href,
      label: n.label,
      href: n.href,
      icon: n.icon,
    }));
    const all = coins ?? [];
    let matched: Coin[];
    if (!q) {
      // Nothing typed: your holdings and watchlist first, then the most traded.
      matched = [...all.filter((c) => c.held || c.watched), ...all.filter((c) => !c.held && !c.watched)];
    } else {
      const score = (c: Coin) => {
        const base = c.baseAsset.toLowerCase();
        if (base === q) return 0;
        if (base.startsWith(q)) return 1;
        if (c.name?.toLowerCase().startsWith(q)) return 2;
        if (c.symbol.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q)) return 3;
        return 9;
      };
      matched = all.filter((c) => score(c) < 9).sort((a, b) => score(a) - score(b) || b.quoteVolume - a.quoteVolume);
    }
    const coinItems: Item[] = matched.slice(0, MAX_COINS).map((c) => ({ kind: "coin", key: c.symbol, coin: c }));
    return q ? [...coinItems, ...pages] : [...pages.slice(0, 6), ...coinItems];
  }, [query, coins]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery("");
    router.push(item.kind === "page" ? item.href : `/crypto/${item.coin.symbol}`);
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted transition-colors hover:border-border-strong hover:text-fg md:flex"
        aria-label="Search coins and pages"
      >
        <Search className="size-3.5" /> Search <Kbd>Ctrl K</Kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg md:hidden" aria-label="Search">
        <Search className="size-4" />
      </button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <DialogContent title="Quick search" description="Coins and pages. ↑ ↓ to move, Enter to open." className="top-[20%] translate-y-0">
          <div className="flex items-center gap-2 rounded-md border border-border-strong bg-bg px-2.5">
            <Search className="size-4 text-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(items[active]);
                }
              }}
              placeholder="BTC, solana, Autopilot…"
              aria-label="Search"
              className="h-9 flex-1 bg-transparent text-[0.8125rem] placeholder:text-faint focus:outline-none"
            />
          </div>
          <ul ref={listRef} className="mt-2 max-h-80 overflow-y-auto" role="listbox" aria-label="Results">
            {coins === null && query ? <li className="px-2 py-3 text-xs text-muted">Loading coins…</li> : null}
            {items.length === 0 && coins !== null ? <li className="px-2 py-3 text-xs text-muted">No matches.</li> : null}
            {items.map((item, i) => (
              <li
                key={`${item.kind}:${item.key}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem]", i === active ? "bg-surface-3 text-fg" : "text-muted")}
              >
                {item.kind === "page" ? (
                  <>
                    <item.icon className="size-4 text-faint" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    <span className="text-[0.65625rem] text-faint">page</span>
                  </>
                ) : (
                  <>
                    <span className="w-14 font-mono text-xs font-semibold text-fg">{item.coin.baseAsset}</span>
                    <span className="flex-1 truncate text-xs">{item.coin.name ?? item.coin.symbol}</span>
                    {item.coin.held ? <Wallet className="size-3 text-accent" aria-label="held" /> : null}
                    {item.coin.watched ? <Star className="size-3 fill-accent text-accent" aria-label="watched" /> : null}
                    <span className="num text-xs">{formatPrice(item.coin.price)}</span>
                    <span className={cn("num w-16 text-right text-xs", item.coin.priceChangePercent >= 0 ? "text-up" : "text-down")}>
                      {formatPercent(item.coin.priceChangePercent)}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
