// Report storage.
//
// MONGODB_URI is not set in this environment, so the demo runs on an in-memory
// store: reports live for a few hours inside the running server process, which
// is enough for the share link to work while the server is up. Setting
// MONGODB_URI switches every read/write to MongoDB — this module is the only
// place that knows the difference.
import type { AnalysisReport } from "../lib/types";

const MEMORY_TTL_MS = 1000 * 60 * 60 * 6;
const MEMORY_MAX_REPORTS = 60;
const MONGO_DB = process.env.PRIORLY_MONGO_DB?.trim() || "priorly";
const MONGO_COLLECTION = "reports";

export type StoreKind = "memory" | "mongodb";

interface MemoryEntry {
  report: AnalysisReport;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();

function memorySave(report: AnalysisReport): void {
  memory.set(report.id, { report, expiresAt: Date.now() + MEMORY_TTL_MS });
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt < now) memory.delete(key);
  }
  while (memory.size > MEMORY_MAX_REPORTS) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

function memoryGet(id: string): AnalysisReport | null {
  const entry = memory.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(id);
    return null;
  }
  return entry.report;
}

export function mongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

interface MongoCollectionLike {
  insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
  findOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  createIndex: (spec: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}

let collectionPromise: Promise<MongoCollectionLike | null> | null = null;

async function getCollection(): Promise<MongoCollectionLike | null> {
  collectionPromise ??= (async () => {
    try {
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(process.env.MONGODB_URI ?? "", {
        serverSelectionTimeoutMS: 4000,
        connectTimeoutMS: 4000,
      });
      await client.connect();
      const collection = client
        .db(MONGO_DB)
        .collection(MONGO_COLLECTION) as unknown as MongoCollectionLike;
      // Reports expire on their own once Mongo is in use; 7 days is plenty for a
      // shared link and keeps the collection small.
      await collection
        .createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 })
        .catch(() => undefined);
      return collection;
    } catch (error) {
      console.error(`[store] MongoDB unavailable, falling back to memory: ${(error as Error).message}`);
      return null;
    }
  })();
  return collectionPromise;
}

export interface SaveResult {
  storage: StoreKind;
  shareable: boolean;
}

export async function saveReport(report: AnalysisReport): Promise<SaveResult> {
  if (!mongoConfigured()) {
    memorySave(report);
    return { storage: "memory", shareable: true };
  }
  const collection = await getCollection();
  if (!collection) {
    memorySave(report);
    return { storage: "memory", shareable: true };
  }
  try {
    await collection.insertOne({
      _id: report.id,
      createdAt: new Date(report.createdAt),
      startupName: report.intake.startupName,
      report,
    });
    return { storage: "mongodb", shareable: true };
  } catch (error) {
    console.error(`[store] MongoDB write failed, falling back to memory: ${(error as Error).message}`);
    memorySave(report);
    return { storage: "memory", shareable: true };
  }
}

export async function getReport(id: string): Promise<AnalysisReport | null> {
  const fromMemory = memoryGet(id);
  if (fromMemory) return fromMemory;
  if (!mongoConfigured()) return null;

  const collection = await getCollection();
  if (!collection) return null;
  try {
    const doc = await collection.findOne({ _id: id });
    const report = doc?.report;
    if (report && typeof report === "object") return report as AnalysisReport;
    return null;
  } catch (error) {
    console.error(`[store] MongoDB read failed: ${(error as Error).message}`);
    return null;
  }
}

export function storageDescription(kind: StoreKind): string {
  return kind === "mongodb"
    ? "Reports are stored in MongoDB, so share links keep working across restarts."
    : "Reports are held in this server's memory for up to 6 hours. Share links work while the server is running; there is no database connected yet.";
}
