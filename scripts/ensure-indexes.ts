/**
 * Creates all MongoDB indexes. Safe to run repeatedly.
 *
 *   npm run db:indexes
 *
 * Reads MONGODB_URI / MONGODB_DB from .env.local (via @next/env).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getDb, getMongoClient } = await import("../src/lib/mongodb/client");
  const { ensureIndexes } = await import("../src/lib/mongodb/collections");
  const db = await getDb();
  await ensureIndexes(db);
  console.log(`Indexes ensured on database "${db.databaseName}".`);
  await (await getMongoClient()).close();
}

main().catch((err) => {
  console.error("Failed to ensure indexes:", err instanceof Error ? err.message : err);
  process.exit(1);
});
