import "server-only";
import { z } from "zod";
import { appEnv } from "@/lib/env";
import { externalCache, fetchJson } from "@/services/external/http";
import { assetName } from "./asset-names";

/**
 * Full asset names for every Binance asset (≈1,100), from the public asset list behind
 * binance.com. Cached for a day and persisted; falls back to the built-in name list.
 */
export async function fullAssetNames(): Promise<Map<string, string>> {
  try {
    const res = await externalCache().get(
      "names:binance-assets:v1",
      24 * 60 * 60,
      async () => {
        const raw = await fetchJson(`${appEnv().BINANCE_WEB_BASE.replace(/\/$/, "")}/bapi/asset/v2/public/asset/asset/get-all-asset`);
        const rows = z
          .object({ data: z.array(z.object({ assetCode: z.string(), assetName: z.string().nullable().optional() })) })
          .parse(raw).data;
        return rows.filter((r) => r.assetName && r.assetName.trim()).map((r) => [r.assetCode, r.assetName!.trim()] as [string, string]);
      },
      { persist: true, persistEverySeconds: 24 * 60 * 60 },
    );
    return new Map(res.data);
  } catch {
    return new Map();
  }
}

/** Full name for a base asset: the Binance list first, then the built-in names. */
export function nameFrom(names: Map<string, string>, baseAsset: string): string | null {
  return names.get(baseAsset) ?? assetName(baseAsset);
}
