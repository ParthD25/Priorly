// Report storage.
//
// One complete analysis is written to Postgres (Supabase) as a transaction-like
// sequence of REST inserts: project -> claims -> evidence -> claim->evidence
// links -> research_run (the full report JSON) -> audit event. If any step
// fails, the rows already written are deleted again so a half-report can never
// be read, and the caller is told plainly that the durable write failed.
//
// There is no Postgres driver here on purpose: no DATABASE_URL exists in this
// environment. See supabase.server.ts for the REST client.
//
// When SUPABASE_SERVICE_ROLE_KEY is absent the module keeps the original
// behaviour: an in-memory store that lasts as long as the server process, and a
// report that says so on the page.
import { randomUUID } from "node:crypto";

import type { AnalysisReport, CapabilityFinding, EvidenceSource } from "../lib/types";
import {
  deleteRows,
  insertRows,
  isSupabaseConfigured,
  OWNER_ID,
  selectRows,
  StorageError,
} from "./supabase.server";

const MEMORY_TTL_MS = 1000 * 60 * 60 * 6;
const MEMORY_MAX_REPORTS = 60;

const TEXT_LIMIT = 4000;

export type StoreKind = "postgres" | "memory";

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

/** Which storage this process is actually using. */
export function storageKind(): StoreKind {
  return isSupabaseConfigured() ? "postgres" : "memory";
}

export function postgresConfigured(): boolean {
  return isSupabaseConfigured();
}

export interface SaveResult {
  storage: StoreKind;
  /** True only when the report is in Postgres, i.e. survives a restart. */
  shareable: boolean;
  /** Set when the durable write was attempted and failed. Never contains a key. */
  error: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trim(value: string | null | undefined, limit = TEXT_LIMIT): string {
  return (value ?? "").slice(0, limit);
}

function evidenceSourceId(source: EvidenceSource): string {
  const key = source.key || "";
  const separator = key.indexOf(":");
  const tail = separator >= 0 ? key.slice(separator + 1) : key;
  return trim(tail || key, 500);
}

/**
 * The schema's url column only accepts https. Connectors occasionally return an
 * http:// link for the same document (e.g. a handle.net redirect); upgrading the
 * scheme keeps the identical resource addressable rather than dropping the row.
 */
function evidenceUrl(url: string | undefined): string {
  const value = trim(url, 2000).trim();
  return /^http:\/\//i.test(value) ? `https://${value.slice("http://".length)}` : value;
}

function evidenceNote(source: EvidenceSource): string {
  const parts: string[] = [];
  if (source.publisher) parts.push(source.publisher);
  if (source.dateLabel) parts.push(source.dateLabel);
  for (const item of source.meta ?? []) {
    if (!item?.label || !item?.value) continue;
    parts.push(`${item.label}: ${item.value}`);
  }
  return trim(parts.join(" · "), 2000);
}

/**
 * priorly_claim_sources.relation is constrained by the schema to a small
 * vocabulary (overlap / background / uncertain). The report's three
 * classifications map onto it one-to-one, so nothing is lost:
 *
 *   KNOWN_OVERLAP              -> "overlap"    the retrieved text covers the mechanism
 *   POTENTIAL_DIFFERENTIATION  -> "background" related work that does not describe the mechanism
 *   INSUFFICIENT_EVIDENCE      -> "uncertain"  the sources did not settle it
 */
const RELATION_BY_CLASSIFICATION: Record<string, string> = {
  KNOWN_OVERLAP: "overlap",
  POTENTIAL_DIFFERENTIATION: "background",
  INSUFFICIENT_EVIDENCE: "uncertain",
};

function relationFor(classification: string): string {
  return RELATION_BY_CLASSIFICATION[classification] ?? "uncertain";
}

/**
 * The schema requires claim text to be substantive (a very short or empty
 * description is rejected by a check constraint). These fields carry the
 * pipeline's own words; when a label is terse we append the provenance the
 * pipeline already recorded rather than padding with invented text.
 */
function claimText(label: string, summary: string, derivedFrom: string, query: string): {
  description: string;
  mechanism: string;
} {
  let description = trim(label, 2000);
  if (description.length < 20 && derivedFrom) description = `${description} — ${derivedFrom}`;
  let mechanism = trim(summary);
  if (mechanism.length < 20 && query) mechanism = `${mechanism} (query: ${query})`;
  return { description, mechanism };
}

/**
 * Rows for the relational side of the report. These exist so the evidence can
 * be queried and linked later (the evidence graph); the report page itself is
 * rendered from research_runs.result_json.
 */
function buildRows(report: AnalysisReport) {
  const projectId = randomUUID();
  const now = report.createdAt || new Date().toISOString();

  const findings: CapabilityFinding[] = [...report.capabilities, report.workflow].filter(
    Boolean,
  );

  // Evidence, deduplicated by (source type, source id). One source can support
  // several claims, so it is written once and linked many times.
  const evidenceRows: Record<string, unknown>[] = [];
  const evidenceIdByKey = new Map<string, string>();
  const seenEvidence = new Set<string>();
  for (const source of report.sources ?? []) {
    if (!source?.key) continue;
    const sourceType = source.type ?? "research";
    const sourceId = evidenceSourceId(source);
    const dedupeKey = `${sourceType}::${sourceId}`;
    if (seenEvidence.has(dedupeKey)) continue;
    seenEvidence.add(dedupeKey);

    const evidenceId = randomUUID();
    evidenceIdByKey.set(source.key, evidenceId);
    evidenceRows.push({
      id: evidenceId,
      owner_id: OWNER_ID,
      project_id: projectId,
      source: sourceType,
      source_id: sourceId,
      title: trim(source.title, 2000) || "(no title returned by the source)",
      url: evidenceUrl(source.url),
      // The classification belongs to a claim/source pair, not to the source on
      // its own, so the evidence row stays unreviewed and the link row carries
      // the relation. Anything else would be a judgement we did not make.
      classification: "unreviewed",
      note: evidenceNote(source),
      retrieved_at: now,
      updated_at: now,
    });
  }

  const claimRows: Record<string, unknown>[] = [];
  const claimSourceRows: Record<string, unknown>[] = [];
  const seenLinks = new Set<string>();

  for (const finding of findings) {
    const claimId = randomUUID();
    const text = claimText(finding.label, finding.summary, finding.derivedFrom, finding.query);
    claimRows.push({
      id: claimId,
      owner_id: OWNER_ID,
      project_id: projectId,
      // What was claimed, in the pipeline's own words.
      description: text.description,
      // The pipeline's finding for that claim (what the evidence said about it).
      mechanism: text.mechanism,
      created_at: now,
      updated_at: now,
    });

    for (const match of finding.matches ?? []) {
      const evidenceId = evidenceIdByKey.get(match.sourceKey);
      // A match that points at a source we did not store cannot become a link.
      if (!evidenceId) continue;
      const linkKey = `${claimId}:${evidenceId}`;
      if (seenLinks.has(linkKey)) continue;
      seenLinks.add(linkKey);

      const source = (report.sources ?? []).find((item) => item.key === match.sourceKey);
      claimSourceRows.push({
        claim_id: claimId,
        evidence_id: evidenceId,
        project_id: projectId,
        owner_id: OWNER_ID,
        relation: relationFor(finding.classification),
        // The matched passage: a verified quote when the model returned one,
        // otherwise the retrieved abstract/snippet, otherwise empty.
        source_excerpt: trim(match.quote ?? source?.excerpt ?? ""),
        rationale: trim(match.rationale),
        updated_at: now,
      });
    }
  }

  const keywordList = [
    ...new Set(
      (report.queryLog ?? []).map((entry) => entry.query?.trim()).filter((q): q is string => Boolean(q)),
    ),
  ];

  const projectRow = {
    id: projectId,
    owner_id: OWNER_ID,
    title: trim(report.intake.startupName, 300) || "Untitled idea",
    problem: trim(report.intake.problem),
    // The founder's proposed features/mechanisms are the proposed solution.
    solution: trim(report.intake.features),
    audience: trim(report.intake.customer, 1500),
    keywords: trim(keywordList.join(", "), 1000),
    created_at: now,
    updated_at: now,
  };

  const researchRunRow = {
    // The report id IS the research run id, so /report/$id keeps its shape and
    // the page reads result_json in one round trip.
    id: report.id,
    owner_id: OWNER_ID,
    project_id: projectId,
    result_json: { ...report, storage: "postgres" as StoreKind, storageError: null },
    created_at: now,
  };

  // The row an attorney would check: what actually ran, what did not and why,
  // the exact queries sent, and the analysis mode.
  const connectorsRan = (report.connectors ?? []).filter((c) => c.connected);
  const connectorsSkipped = (report.connectors ?? []).filter((c) => !c.connected);
  const auditRow = {
    id: randomUUID(),
    owner_id: OWNER_ID,
    project_id: projectId,
    // Null on purpose: the pipeline is not a person. The actor is named in the
    // context below.
    actor_id: null,
    action: "analysis.report.stored",
    context: {
      actor: "priorly-pipeline",
      report_id: report.id,
      project_id: projectId,
      owner_id: OWNER_ID,
      analysis_mode: report.mode,
      decomposition_method: report.decomposition?.method ?? null,
      decomposition_note: report.decomposition?.note ?? null,
      connectors_ran: connectorsRan.map((c) => ({ id: c.id, label: c.label, detail: c.detail })),
      connectors_skipped: connectorsSkipped.map((c) => ({
        id: c.id,
        label: c.label,
        reason: c.detail,
      })),
      queries_sent: (report.queryLog ?? []).map((entry) => ({
        query: entry.query,
        provider: entry.provider,
        results: entry.results,
        status: entry.status,
        note: entry.note ?? null,
      })),
      not_checked: report.notChecked ?? [],
      counts: report.counts,
      rows_written: {
        projects: 1,
        claims: claimRows.length,
        evidence: evidenceRows.length,
        claim_sources: claimSourceRows.length,
        research_runs: 1,
      },
      duration_ms: report.durationMs,
      storage: "postgres",
    },
    created_at: now,
  };

  return { projectId, projectRow, claimRows, evidenceRows, claimSourceRows, researchRunRow, auditRow };
}

async function writePostgres(report: AnalysisReport): Promise<void> {
  const rows = buildRows(report);
  const written: { table: string; query: string }[] = [];

  try {
    await insertRows("priorly_projects", [rows.projectRow]);
    written.push({ table: "priorly_projects", query: `id=eq.${rows.projectId}` });

    await insertRows("priorly_claims", rows.claimRows);
    written.push({ table: "priorly_claims", query: `project_id=eq.${rows.projectId}` });

    await insertRows("priorly_evidence", rows.evidenceRows);
    written.push({ table: "priorly_evidence", query: `project_id=eq.${rows.projectId}` });

    await insertRows("priorly_claim_sources", rows.claimSourceRows);
    written.push({ table: "priorly_claim_sources", query: `project_id=eq.${rows.projectId}` });

    await insertRows("priorly_research_runs", [rows.researchRunRow]);
    written.push({ table: "priorly_research_runs", query: `project_id=eq.${rows.projectId}` });

    await insertRows("priorly_audit_events", [rows.auditRow]);
    written.push({ table: "priorly_audit_events", query: `project_id=eq.${rows.projectId}` });
  } catch (error) {
    // Compensating rollback, newest first. PostgREST has no cross-request
    // transaction, so this is the closest thing to one: either the whole report
    // is there or none of it is.
    for (const step of written.reverse()) {
      await deleteRows(step.table, step.query);
    }
    throw error;
  }
}

export async function saveReport(report: AnalysisReport): Promise<SaveResult> {
  if (!isSupabaseConfigured()) {
    memorySave(report);
    return { storage: "memory", shareable: false, error: null };
  }

  try {
    await writePostgres(report);
    // Keep a short-lived copy in memory too, so the report renders instantly
    // right after a run even if the REST read is slow.
    memorySave(report);
    return { storage: "postgres", shareable: true, error: null };
  } catch (error) {
    const status = error instanceof StorageError ? error.status : 0;
    const message = error instanceof Error ? error.message : "unknown storage error";
    console.error(`[store] Postgres write failed (${status || "network"}): ${message}`);
    memorySave(report);
    return { storage: "memory", shareable: false, error: message };
  }
}

export async function loadReport(id: string): Promise<AnalysisReport | null> {
  if (isSupabaseConfigured() && UUID_RE.test(id)) {
    try {
      const rows = await selectRows<{ result_json: AnalysisReport | null }>(
        "priorly_research_runs",
        `id=eq.${encodeURIComponent(id)}&select=result_json&limit=1`,
      );
      const stored = rows[0]?.result_json;
      if (stored && typeof stored === "object") {
        return { ...stored, storage: "postgres", storageError: null };
      }
    } catch (error) {
      console.error(`[store] Postgres read failed: ${(error as Error).message}`);
    }
  }
  return memoryGet(id);
}

/** Kept for the pipeline's old import name. */
export const getReport = loadReport;

export function storageDescription(kind: StoreKind): string {
  return kind === "postgres"
    ? "Reports are saved in Postgres together with their claims, sources and claim-to-source links, so this share link keeps working after a restart or a new deploy."
    : "Reports are held in this server's memory for up to 6 hours. This share link stops working when the server restarts, and no database is connected.";
}
