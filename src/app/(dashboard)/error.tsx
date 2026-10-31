"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, Panel } from "@/components/ui/primitives";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server already logged the details; the digest links the two.
    console.error("page_error", error.digest ?? "");
  }, [error]);

  return (
    <Panel className="mx-auto mt-10 max-w-lg p-8 text-center">
      <TriangleAlert className="mx-auto mb-3 size-6 text-warn" />
      <h1 className="text-base font-semibold">This page could not be displayed</h1>
      <p className="mt-2 text-sm text-muted">
        Something failed while loading data. Nothing was changed. Your simulated portfolio and records are unaffected.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-[11px] text-faint">Reference {error.digest}</p> : null}
      <Button className="mt-5" variant="primary" onClick={reset}>
        <RotateCcw className="size-3.5" /> Try again
      </Button>
    </Panel>
  );
}
