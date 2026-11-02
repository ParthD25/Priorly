// Small TTL cache for outbound API calls (OpenAlex, patent + web connectors, LLM).
//
// Two layers: an in-process Map and a disk mirror under /tmp. The disk layer
// matters because the public OpenAlex tier is metered per network IP, and the
// published site restarts on every publish — without it each restart would burn
// the whole daily budget again. Nothing user-specific is stored here: keys are
// search queries and prompts only.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

interface DiskEntry {
  value: unknown;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();
const MEMORY_MAX_ENTRIES = 400;
const DISK_DIR = "/tmp/priorly-cache";
const DISK_MAX_AGE_MS = 1000 * 60 * 60 * 24; // sweep files older than a day

let diskReady: Promise<void> | null = null;
const ensureDisk = (): Promise<void> => {
  diskReady ??= mkdir(DISK_DIR, { recursive: true }).then(
    () => undefined,
    () => undefined,
  );
  return diskReady;
};

const diskPath = (key: string): string =>
  join(DISK_DIR, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);

const readDisk = async (key: string): Promise<DiskEntry | null> => {
  try {
    const raw = await readFile(diskPath(key), "utf8");
    const parsed = JSON.parse(raw) as DiskEntry & { key?: string };
    if (parsed.key && parsed.key !== key) return null;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeDisk = async (key: string, entry: DiskEntry): Promise<void> => {
  await ensureDisk();
  try {
    await writeFile(diskPath(key), JSON.stringify({ key, ...entry }), "utf8");
  } catch {
    // A cache miss is never fatal.
  }
};

const pruneMemory = (): void => {
  if (memory.size <= MEMORY_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt < now) memory.delete(key);
  }
  while (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
};

export interface CachedOptions {
  /** Milliseconds a value stays usable. */
  ttlMs: number;
  /** Skip the cache entirely (used by the "fresh run" button). */
  bypass?: boolean;
}

/** Returns { value, cached } so callers can tell the report whether it was served from cache. */
export async function withCache<T>(
  key: string,
  opts: CachedOptions,
  produce: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  if (!opts.bypass) {
    const hit = memory.get(key);
    if (hit && hit.expiresAt > Date.now()) return { value: hit.value as T, cached: true };

    const diskHit = await readDisk(key);
    if (diskHit) {
      memory.set(key, { value: diskHit.value, expiresAt: diskHit.expiresAt });
      return { value: diskHit.value as T, cached: true };
    }
  }

  const value = await produce();
  const expiresAt = Date.now() + opts.ttlMs;
  memory.set(key, { value, expiresAt });
  pruneMemory();
  await writeDisk(key, { value, expiresAt });
  return { value, cached: false };
}

/** Drop stale disk entries; called opportunistically, best effort. */
export async function sweepDiskCache(): Promise<void> {
  try {
    await ensureDisk();
    const { readdir, stat, unlink } = await import("node:fs/promises");
    const files = await readdir(DISK_DIR);
    const cutoff = Date.now() - DISK_MAX_AGE_MS;
    for (const file of files) {
      const full = join(DISK_DIR, file);
      const info = await stat(full).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(full).catch(() => undefined);
    }
  } catch {
    // ignore
  }
}
