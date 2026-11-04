import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { TraderDetail } from "@/components/traders/trader-detail";

export const metadata: Metadata = { title: "Trader" };

export default async function TraderPage({ params }: PageProps<"/traders/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  return <TraderDetail id={id} />;
}
