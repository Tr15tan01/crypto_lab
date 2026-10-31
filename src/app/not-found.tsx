import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-mono text-xs text-faint">404</p>
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="max-w-sm text-sm text-muted">
        This page does not exist, or the trading pair is not listed on Binance Spot and you have no records for it.
      </p>
      <Link href="/market" className="mt-2 text-sm text-accent hover:underline">
        Go to the Market Scanner
      </Link>
    </main>
  );
}
