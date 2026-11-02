// Research connector — OpenAlex (https://openalex.org). Public, no key required.
//
// Only fields we actually display are requested, results are capped, calls are
// cached, and every returned URL is one OpenAlex itself returned (DOI resolver or
// landing page). Nothing here is synthesised.
import type { EvidenceSource, QueryLogEntry } from "../lib/types";
import { withCache } from "./cache.server";
import { truncate } from "./text.server";

const BASE = "https://api.openalex.org/works";
const PER_QUERY = 8;
const TTL_MS = 1000 * 60 * 60 * 12;
// Polite-pool identifier. OpenAlex asks for a contact address; this is a
// non-deliverable placeholder, not a claim that the address works.
const MAILTO = process.env.PRIORLY_CONTACT_EMAIL?.trim() || "priorly@example.com";

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_date?: string | null;
  publication_year?: number | null;
  type?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: { display_name?: string | null; host_organization_name?: string | null } | null;
  } | null;
  best_oa_location?: { landing_page_url?: string | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
}

export interface ConnectorResult {
  sources: EvidenceSource[];
  log: QueryLogEntry;
}

function reconstructAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) slots[position] = word;
  }
  const text = slots.filter(Boolean).join(" ").trim();
  return text.length > 0 ? text : null;
}

function dateParts(work: OpenAlexWork): { date: string | null; dateLabel: string } {
  if (work.publication_date) {
    return { date: work.publication_date, dateLabel: work.publication_date };
  }
  if (typeof work.publication_year === "number") {
    return { date: String(work.publication_year), dateLabel: String(work.publication_year) };
  }
  return { date: null, dateLabel: "date not listed" };
}

function toSource(work: OpenAlexWork): EvidenceSource | null {
  const title = (work.title ?? work.display_name ?? "").trim();
  if (!title) return null;

  const doi = work.doi?.replace(/^https?:\/\/doi\.org\//i, "") ?? null;
  const url =
    (doi ? `https://doi.org/${doi}` : null) ??
    work.primary_location?.landing_page_url ??
    work.best_oa_location?.landing_page_url ??
    (work.id ? work.id.replace("https://openalex.org/", "https://openalex.org/") : null);
  if (!url) return null;

  const venue =
    work.primary_location?.source?.display_name ??
    work.primary_location?.source?.host_organization_name ??
    null;
  const authors = (work.authorships ?? [])
    .map((authorship) => authorship.author?.display_name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 4);

  const meta: { label: string; value: string }[] = [];
  if (authors.length > 0) meta.push({ label: "Authors", value: authors.join(", ") });
  if (work.type) meta.push({ label: "OpenAlex type", value: work.type });
  if (doi) meta.push({ label: "DOI", value: doi });

  const { date, dateLabel } = dateParts(work);
  const abstract = reconstructAbstract(work.abstract_inverted_index);

  return {
    key: `research:${work.id ?? url}`,
    type: "research",
    title,
    publisher: venue,
    date,
    dateLabel,
    url,
    excerpt: abstract ? truncate(abstract, 900) : null,
    meta,
  };
}

async function fetchOpenAlex(query: string, limit: number): Promise<EvidenceSource[]> {
  const params = new URLSearchParams({
    search: query,
    "per-page": String(limit),
    mailto: MAILTO,
    // Scholarly record only, and only records that carry an abstract — the
    // abstract is what the comparison reads, so a record without one cannot be
    // scored honestly. This also filters out scraped administrative PDFs that
    // happen to contain the query words.
    filter: "type:article|book-chapter|review|dissertation|preprint|book,has_abstract:true",
    select:
      "id,doi,title,display_name,publication_date,publication_year,type,abstract_inverted_index,primary_location,best_oa_location,authorships",
  });
  const response = await fetch(`${BASE}?${params.toString()}`, {
    headers: { accept: "application/json", "user-agent": "Priorly/0.1 (research overlap report)" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAlex HTTP ${String(response.status)}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }

  const payload = (await response.json()) as { results?: OpenAlexWork[] };
  const sources: EvidenceSource[] = [];
  for (const work of payload.results ?? []) {
    const source = toSource(work);
    if (source) sources.push(source);
  }
  return sources;
}

/**
 * Search OpenAlex for one query. Errors are reported, never swallowed into a
 * silent empty list: the report has to be able to say a search failed.
 */
export async function searchResearch(query: string): Promise<ConnectorResult> {
  if (!query.trim()) {
    return {
      sources: [],
      log: { query, provider: "OpenAlex", results: 0, status: "empty", note: "empty query" },
    };
  }

  try {
    const { value, cached } = await withCache(`openalex:v2:${query}`, { ttlMs: TTL_MS }, () =>
      fetchOpenAlex(query, PER_QUERY),
    );
    return {
      sources: value,
      log: {
        query,
        provider: "OpenAlex",
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
        provider: "OpenAlex",
        results: 0,
        status: "error",
        note: (error as Error).message.slice(0, 200),
      },
    };
  }
}
