/**
 * Diagnoses the MongoDB connection configured in .env.local.
 *
 *   npm run db:check
 *
 * Prints the connection string with the password hidden, then checks each step (format,
 * DNS, network, login, transactions) and explains how to fix the first one that fails.
 * Never prints the password.
 */
import { loadEnvConfig } from "@next/env";
import dns from "node:dns/promises";
import { MongoClient, MongoServerError } from "mongodb";

loadEnvConfig(process.cwd());

const ok = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string, fix: string[]) => {
  console.log(`  ❌ ${m}`);
  for (const f of fix) console.log(`     → ${f}`);
  process.exit(1);
};

function mask(uri: string) {
  return uri.replace(/\/\/([^:/@]+):([^@]*)@/, (_m, u) => `//${u}:****@`);
}

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DB?.trim() || "crypto_lab";
  console.log("\nMongoDB connection check\n");

  // 1. Is the variable present and filled in?
  if (!uri) {
    fail("MONGODB_URI is not set.", [
      "Create .env.local in the project root (next to package.json) by copying .env.example.",
      "Restart `npm run dev` after editing .env.local.",
    ]);
  }
  console.log(`  URI: ${mask(uri!)}`);
  console.log(`  DB:  ${dbName}\n`);

  if (/<user>|<password>|<cluster>|user:password@|@CLUSTER\./i.test(uri!)) {
    fail("The connection string still contains template placeholders.", [
      "In Atlas: Clusters → Connect → Drivers, and copy the real string.",
      "Your host looks like cluster0.ab1cd.mongodb.net — the random part after the dot is required.",
      "Replace the user and password with the database user from Atlas → Database Access.",
    ]);
  }

  let parsed: URL;
  try {
    parsed = new URL(uri!);
  } catch {
    fail("The connection string is not a valid URL.", [
      "If your password contains @ : / ? # [ ] % or spaces, URL-encode it (e.g. @ → %40, # → %23, % → %25).",
      "Or create a new database user whose password uses only letters and numbers.",
    ]);
  }
  if (!/^mongodb(\+srv)?:$/.test(parsed!.protocol)) {
    fail(`Unexpected scheme "${parsed!.protocol}".`, ["The string must start with mongodb+srv:// or mongodb://"]);
  }
  if ((uri!.match(/@/g) ?? []).length > 1) {
    fail("The string contains more than one '@'.", [
      "Your password probably contains '@'. Encode it as %40, or choose a password without special characters.",
    ]);
  }
  ok("Format looks valid");

  // 2. DNS (SRV records for mongodb+srv)
  const host = parsed!.hostname;
  if (parsed!.protocol === "mongodb+srv:") {
    try {
      const records = await dns.resolveSrv(`_mongodb._tcp.${host}`);
      ok(`DNS SRV lookup found ${records.length} server(s)`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "ENODATA") {
        fail(`The cluster host "${host}" does not exist.`, [
          "Copy the host exactly from Atlas → Connect → Drivers (e.g. cluster0.ab1cd.mongodb.net).",
        ]);
      }
      fail(`DNS SRV lookup failed (${code ?? "error"}).`, [
        "Common on Windows and some ISPs/routers: Node.js cannot resolve SRV records.",
        "Fix A: set your network adapter's DNS to 8.8.8.8 and 1.1.1.1, then retry.",
        "Fix B: in Atlas → Connect → Drivers, pick an older driver version (e.g. Node.js 2.2.12) to get a",
        "        'mongodb://' string listing the three shard hosts, and use that instead.",
        "Also check that a VPN or corporate proxy is not blocking DNS.",
      ]);
    }
  }

  // 3–5. Connect, authenticate, test a transaction
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 10_000, appName: "crypto-lab-db-check" });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    ok("Connected and authenticated");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof MongoServerError && (err.code === 18 || /auth/i.test(msg))) {
      fail("Authentication failed (wrong username or password).", [
        "Use a user from Atlas → Database Access — NOT your Atlas website login.",
        "Reset that user's password in Atlas and paste it again; URL-encode special characters.",
        "Make sure the user has the 'Read and write to any database' role.",
      ]);
    }
    if (/Server selection timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ReplicaSetNoPrimary|whitelist|not allowed/i.test(msg)) {
      fail("Could not reach the cluster (network blocked).", [
        "Most common cause: your IP is not allowed. Atlas → Network Access → Add IP Address →",
        "  'Add current IP address' (or 0.0.0.0/0 for testing and for Vercel). Wait ~1 minute.",
        "Your IP changes on home internet/mobile: re-add it if it worked before.",
        "Outbound port 27017 may be blocked by a corporate network, school Wi-Fi or VPN — try another network.",
        "Check the cluster is not paused (Atlas → Clusters).",
      ]);
    }
    fail(`Connection failed: ${msg.replace(/\/\/[^@]*@/, "//****@")}`, [
      "Compare the string with Atlas → Connect → Drivers and check Network Access.",
    ]);
  }

  const session = client.startSession();
  try {
    const coll = client.db(dbName).collection("_connection_check");
    await session.withTransaction(async () => {
      await coll.insertOne({ at: new Date() }, { session });
    });
    await coll.drop().catch(() => undefined);
    ok("Transactions supported (needed for simulated trades)");
  } catch (err) {
    fail("Transactions are not supported by this server.", [
      "Use MongoDB Atlas (any tier, including the free M0) or a replica set.",
      `Detail: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  } finally {
    await session.endSession();
    await client.close();
  }

  console.log("\nAll checks passed. Run `npm run db:indexes`, then `npm run dev`.\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
