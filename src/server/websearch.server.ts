// Competitor / product web-search connector.
//
// Uses a web-search API if a key for one is configured (Brave Search API or
// Tavily). Without a key it reports "not connected" and returns nothing: Priorly
// does not guess which companies exist, and it does not scrape a search engine
// results page.
import type { EvidenceSource, QueryLogEntry } from "../lib/types";
import { withCache } from "./cache.server";
import { truncate } from "./text.server";

export interface WebSearchResult {
  sources: EvidenceSource[];
  log: QueryLogEntry;
}

const TTL_MS = 1000 * 60 * 60 * 12;

function provider(): { id: "brave" | "tavily" | null; label: string } {
  if (process.env.BRAVE_API_KEY?.trim()) return { id: "brave", label: "Brave Search API" };
  if (process.env.TAVILY_API_KEY?.trim()) return { id: "tavily", label: "Tavily Search API" };
  return { id: null, label: "none configured" };
}

export function isWebSearchConnected(): boolean {
  return provider().id !== null;
}

export function webSearchStatusLabel(): string {
  return provider().label;
}

export function webSearchDisconnectedReason(): string {
  return "Competitor web search: not connected — no competitor or product pages were searched for this report.";
}

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  profile?: { long_name?: string; name?: string };
}

async function searchBrave(query: string, limit: number): Promise<EvidenceSource[]> {
  const params = new URLSearchParams({ q: query, count: String(limit) });
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: {
      accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Brave HTTP ${String(response.status)}`);
  const payload = (await response.json()) as { web?: { results?: BraveResult[] } };
  const sources: EvidenceSource[] = [];
  for (const result of payload.web?.results ?? []) {
    if (!result.url || !result.title) continue;
    const host = safeHost(result.url);
    const date = result.page_age ?? result.age ?? null;
    sources.push({
      key: `competitor:${result.url}`,
      type: "competitor",
      title: result.title,
      publisher: result.profile?.long_name ?? result.profile?.name ?? host,
      date,
      dateLabel: date ?? "date not listed",
      url: result.url,
      excerpt: result.description ? truncate(result.description.replace(/<[^>]+>/g, ""), 400) : null,
      meta: [{ label: "Domain", value: host }],
    });
  }
  return sources;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string | null;
}

async function searchTavily(query: string, limit: number): Promise<EvidenceSource[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY ?? "",
      query,
      max_results: limit,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Tavily HTTP ${String(response.status)}`);
  const payload = (await response.json()) as { results?: TavilyResult[] };
  const sources: EvidenceSource[] = [];
  for (const result of payload.results ?? []) {
    if (!result.url || !result.title) continue;
    const host = safeHost(result.url);
    sources.push({
      key: `competitor:${result.url}`,
      type: "competitor",
      title: result.title,
      publisher: host,
      date: result.published_date ?? null,
      dateLabel: result.published_date ?? "date not listed",
      url: result.url,
      excerpt: result.content ? truncate(result.content, 400) : null,
      meta: [{ label: "Domain", value: host }],
    });
  }
  return sources;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown domain";
  }
}

export async function searchCompetitors(query: string, limit = 6): Promise<WebSearchResult> {
  const active = provider();
  if (!active.id) {
    return {
      sources: [],
      log: {
        query,
        provider: "Web search",
        results: 0,
        status: "not-connected",
        note: webSearchDisconnectedReason(),
      },
    };
  }
  if (!query.trim()) {
    return {
      sources: [],
      log: { query, provider: active.label, results: 0, status: "empty", note: "empty query" },
    };
  }

  try {
    const { value, cached } = await withCache(
      `web:${active.id}:${query}:${String(limit)}`,
      { ttlMs: TTL_MS },
      () => (active.id === "brave" ? searchBrave(query, limit) : searchTavily(query, limit)),
    );
    return {
      sources: value,
      log: {
        query,
        provider: active.label,
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
        provider: active.label,
        results: 0,
        status: "error",
        note: (error as Error).message.slice(0, 200),
      },
    };
  }
}
