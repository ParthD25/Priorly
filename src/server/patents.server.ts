// Patent connector — pluggable by design.
//
// The interface below is what the pipeline talks to, so the patent source can be
// swapped (USPTO Open Data Portal today, another register tomorrow) without
// touching the analysis code. There is exactly one implementation wired up:
// USPTO's Open Data Portal API, which needs a free API key.
//
// No key is configured in this environment. When it is missing the connector
// reports `connected: false` and returns nothing — it never falls back to
// scraping Google Patents, and it never invents an application number.
import type { EvidenceSource, QueryLogEntry } from "../lib/types";
import { withCache } from "./cache.server";

export interface PatentSearchResult {
  sources: EvidenceSource[];
  log: QueryLogEntry;
}

export interface PatentConnector {
  readonly id: string;
  readonly label: string;
  /** Whether the connector has what it needs to actually search. */
  isConnected(): boolean;
  /** Plain-language reason shown in the report when not connected. */
  disconnectedReason(): string;
  search(query: string, limit: number): Promise<PatentSearchResult>;
}

const TTL_MS = 1000 * 60 * 60 * 12;
const SEARCH_URL = "https://api.uspto.gov/api/v1/patent/applications/search";
// Where a founder can look a number up by hand. Used instead of guessing a
// deep-link format we cannot verify without a key.
const USPTO_PUBLIC_SEARCH = "https://ppubs.uspto.gov/pubwebapp/";

interface UsptoApplication {
  applicationNumberText?: string;
  inventionTitle?: string;
  filingDate?: string | null;
  applicationMetaData?: {
    inventionTitle?: string;
    filingDate?: string | null;
    applicantName?: string | null;
    firstInventorName?: string | null;
    applicationStatusDescriptionText?: string | null;
  } | null;
}

function toSource(application: UsptoApplication): EvidenceSource | null {
  const meta = application.applicationMetaData ?? {};
  const title = (meta.inventionTitle ?? application.inventionTitle ?? "").trim();
  const number = (application.applicationNumberText ?? "").trim();
  if (!title || !number) return null;

  const filingDate = meta.filingDate ?? application.filingDate ?? null;
  const inventor = meta.firstInventorName?.trim();
  const applicant = meta.applicantName?.trim();

  return {
    key: `patent:${number}`,
    type: "patent",
    title,
    publisher: applicant ?? "USPTO (applicant not listed)",
    date: filingDate,
    dateLabel: filingDate ?? "filing date not listed",
    // The public search app is a real page; the application number is given so
    // the reader can look the record up themselves.
    url: USPTO_PUBLIC_SEARCH,
    excerpt: null,
    meta: [
      { label: "Application number", value: number },
      ...(inventor ? [{ label: "First inventor", value: inventor }] : []),
      ...(meta.applicationStatusDescriptionText
        ? [{ label: "Status", value: meta.applicationStatusDescriptionText }]
        : []),
      { label: "Look up", value: `Search application ${number} in USPTO Patent Public Search` },
    ],
  };
}

export const usptoConnector: PatentConnector = {
  id: "uspto-odp",
  label: "USPTO Open Data Portal",

  isConnected(): boolean {
    return Boolean(process.env.USPTO_API_KEY?.trim());
  },

  disconnectedReason(): string {
    return "Patent coverage: not connected — no patent search was performed for this report.";
  },

  async search(query: string, limit: number): Promise<PatentSearchResult> {
    if (!this.isConnected()) {
      return {
        sources: [],
        log: {
          query,
          provider: this.label,
          results: 0,
          status: "not-connected",
          note: this.disconnectedReason(),
        },
      };
    }
    if (!query.trim()) {
      return {
        sources: [],
        log: { query, provider: this.label, results: 0, status: "empty", note: "empty query" },
      };
    }

    try {
      const { value, cached } = await withCache(
        `uspto:${query}:${String(limit)}`,
        { ttlMs: TTL_MS },
        async () => {
          const params = new URLSearchParams({
            q: query,
            limit: String(limit),
            offset: "0",
          });
          const response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
            headers: {
              accept: "application/json",
              "X-API-KEY": process.env.USPTO_API_KEY ?? "",
            },
            signal: AbortSignal.timeout(25_000),
          });
          if (!response.ok) {
            throw new Error(`USPTO HTTP ${String(response.status)}`);
          }
          const payload = (await response.json()) as {
            patentFileWrapperDataBag?: UsptoApplication[];
          };
          const sources: EvidenceSource[] = [];
          for (const application of payload.patentFileWrapperDataBag ?? []) {
            const source = toSource(application);
            if (source) sources.push(source);
          }
          return sources;
        },
      );

      return {
        sources: value,
        log: {
          query,
          provider: this.label,
          results: value.length,
          status: cached ? "cached" : value.length > 0 ? "ok" : "empty",
          note: cached ? "served from cache" : undefined,
        },
      };
    } catch (error) {
      return {
        sources: [],
        log: {
          query,
          provider: this.label,
          results: 0,
          status: "error",
          note: (error as Error).message.slice(0, 200),
        },
      };
    }
  },
};

/** Swap this binding to change patent source; nothing else in the pipeline changes. */
export const patentConnector: PatentConnector = usptoConnector;

export function patentCoverageSummary(): string {
  return patentConnector.isConnected()
    ? `${patentConnector.label} connected — patent search ran for each capability.`
    : patentConnector.disconnectedReason();
}
