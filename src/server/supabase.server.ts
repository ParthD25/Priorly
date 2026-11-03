// Supabase (PostgREST) access for Priorly report storage.
//
// Server-only. There is no DATABASE_URL in this environment and none is coming,
// so every read and write goes through the REST API with plain fetch — no
// Postgres driver, no connection string, no client SDK.
//
// Secrets discipline: the service-role key is read from process.env at call
// time and sent only in the `apikey` / `Authorization` headers. It is never
// logged, never returned to a caller and never placed in a payload. Errors
// raised here carry the HTTP status and PostgREST's own message only.

const DEFAULT_SUPABASE_URL = "https://dpcpbebiylwozvkjubeq.supabase.co";

/**
 * Pre-accounts placeholder owner.
 *
 * Priorly has no accounts yet, so every row written by the pipeline belongs to
 * one fixed owner UUID. It is a constant on purpose: generating a fresh id per
 * report would scatter the data and make nothing queryable together. When auth
 * lands, this becomes the authenticated user's id and the constant goes away.
 * Overridable for tests / a different deployment via PRIORLY_OWNER_ID.
 *
 * The owner_id columns are foreign keys into auth.users, so this UUID is a real
 * (and otherwise unused) account row created once for the pipeline: email
 * `priorly-owner@priorly.invalid`, no usable password, metadata "Priorly
 * pipeline owner (pre-accounts placeholder)". It is a machine owner, not a
 * person, and it is never signed into.
 */
export const OWNER_ID =
  process.env.PRIORLY_OWNER_ID?.trim() || "1cbb0210-2b70-4335-9547-cef4c23f46dc";

export function supabaseUrl(): string {
  const raw = process.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
  return raw.replace(/\/+$/, "");
}

/** The service-role key, or null when it has not been provided to this server. */
export function serviceKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key ? key : null;
}

export function isSupabaseConfigured(): boolean {
  return serviceKey() !== null;
}

export class StorageError extends Error {
  readonly status: number;
  readonly table: string;
  readonly code: string | null;

  constructor(table: string, status: number, message: string, code: string | null = null) {
    super(`${table}: HTTP ${status}${message ? ` — ${message}` : ""}`);
    this.name = "StorageError";
    this.table = table;
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  table: string;
  /** Query string without the leading "?", e.g. `id=eq.<uuid>&select=result_json`. */
  query?: string;
  body?: unknown;
  /** Return the inserted rows. Defaults to false (Prefer: return=minimal). */
  returning?: boolean;
  timeoutMs?: number;
}

async function request<T>(options: RequestOptions): Promise<T | null> {
  const key = serviceKey();
  if (!key) {
    throw new StorageError(options.table, 0, "SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  headers.Prefer = options.returning ? "return=representation" : "return=minimal";

  const url = `${supabaseUrl()}/rest/v1/${options.table}${options.query ? `?${options.query}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
  } catch (error) {
    // Network / DNS / timeout. The message never contains the key.
    throw new StorageError(options.table, 0, `request failed (${(error as Error).name})`);
  }

  const text = await response.text();

  if (!response.ok) {
    let message = text.slice(0, 300);
    let code: string | null = null;
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string; details?: string };
      message = [parsed.message, parsed.details].filter(Boolean).join(" — ") || message;
      code = parsed.code ?? null;
    } catch {
      // Not JSON; keep the truncated body.
    }
    throw new StorageError(options.table, response.status, message, code);
  }

  if (!options.returning || text.trim() === "") return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Bulk insert with `Prefer: return=minimal`. A 4xx (401 auth, 409 conflict,
 * 400 bad column) throws — it must never look like a successful write.
 */
export async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  await request({ method: "POST", table, body: rows });
}

export async function selectRows<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T[]> {
  const rows = await request<T[]>({ method: "GET", table, query, returning: true });
  return Array.isArray(rows) ? rows : [];
}

/** Best-effort delete used to undo a half-written report. Never throws. */
export async function deleteRows(table: string, query: string): Promise<boolean> {
  try {
    await request({ method: "DELETE", table, query });
    return true;
  } catch (error) {
    console.error(`[storage] rollback of ${table} failed: ${(error as Error).message}`);
    return false;
  }
}
