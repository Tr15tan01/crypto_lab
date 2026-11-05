import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { SignalLab } from "@/components/signals/signal-lab";

export const metadata: Metadata = { title: "Signal Lab" };

export default async function SignalsPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Signal Lab"
        description="Which signals actually worked? Every discovery signal tested on the last ~2.5 years of daily data for the 100 most liquid pairs: what happened 7 and 30 days after it fired."
      />
      <SignalLab />
    </>
  );
}
