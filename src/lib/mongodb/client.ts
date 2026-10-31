import "server-only";
import { MongoClient, type Db } from "mongodb";
import { coreEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * A single MongoClient per server process. In development the client is kept on
 * `globalThis` so hot reloads don't open a new connection pool every time.
 */
type Cached = { client: MongoClient; promise: Promise<MongoClient> };

const globalForMongo = globalThis as unknown as { __cryptoLabMongo?: Cached };

function getClientPromise(): Promise<MongoClient> {
  if (globalForMongo.__cryptoLabMongo) return globalForMongo.__cryptoLabMongo.promise;

  const { MONGODB_URI } = coreEnv();
  const client = new MongoClient(MONGODB_URI, {
    appName: "crypto-lab",
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  });
  const promise = client.connect().catch((err: unknown) => {
    // Allow the next request to retry instead of caching a failed connection forever.
    globalForMongo.__cryptoLabMongo = undefined;
    throw err;
  });
  globalForMongo.__cryptoLabMongo = { client, promise };
  return promise;
}

export async function getMongoClient(): Promise<MongoClient> {
  try {
    return await getClientPromise();
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error("mongodb.connect_failed", { error: err });
    throw new AppError("DATABASE", "The database is unavailable right now. Try again shortly.", {
      cause: err,
      retryable: true,
    });
  }
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(coreEnv().MONGODB_DB);
}
