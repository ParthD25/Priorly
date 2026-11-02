const STOPWORDS = new Set(
  "the and with that this from into will would your their there have using being which where they over than then when more also very able need solve based platform system software startup users user data these those across for our who what how make can via are was were should could".split(" ")
);

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

function field(value, label, max, required = false) {
  if (typeof value !== "string") throw new InputError(label + " must be text.");
  const cleaned = value.trim();
  if (cleaned.length > max) throw new InputError(label + " exceeds " + max + " characters.");
  if (required && cleaned.length < 5) throw new InputError(label + " must be at least five characters.");
  return cleaned;
}

export function validateIdea(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InputError("Request must contain a startup idea object.");
  }
  return {
    ideaName: field(input.ideaName, "Name", 90, true),
    ideaProblem: field(input.ideaProblem, "Problem", 1800, true),
    ideaSolution: field(input.ideaSolution, "Solution", 2400, true),
    ideaAudience: field(input.ideaAudience ?? "", "Customer", 180),
    ideaKeywords: field(input.ideaKeywords ?? "", "Keywords", 300)
  };
}

export function deriveQuery(idea) {
  const explicit = idea.ideaKeywords.split(",").map(s => s.trim().replace(/[^a-zA-Z0-9 -]/g, " ")).filter(Boolean);
  if (explicit.length) return explicit.slice(0, 3).join(" ").slice(0, 130).trim();
  const raw = (idea.ideaProblem + " " + idea.ideaSolution).toLowerCase().replace(/[^a-z0-9 -]/g, " ");
  const tokens = raw.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  return [...new Set(tokens)].slice(0, 6).join(" ").slice(0, 130).trim() || idea.ideaName;
}

function httpsUrl(candidate) {
  if (typeof candidate !== "string") return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeOpenAlex(payload, retrievedAt) {
  if (!Array.isArray(payload?.results)) throw new Error("Unexpected OpenAlex response.");
  return payload.results.slice(0, 8).map(item => ({
    id: String(item.id || item.doi || ""),
    title: String(item.title || "Untitled").slice(0, 400),
    year: Number.isInteger(item.publication_year) ? item.publication_year : null,
    cited: Number.isInteger(item.cited_by_count) ? item.cited_by_count : 0,
    url: httpsUrl(item.doi) || httpsUrl(item.primary_location?.landing_page_url) || httpsUrl(item.id),
    source: "OpenAlex",
    retrievedAt
  })).filter(item => item.url);
}

export function normalizeGitHub(payload, retrievedAt) {
  if (!Array.isArray(payload?.items)) throw new Error("Unexpected GitHub response.");
  return payload.items.slice(0, 8).map(item => ({
    id: String(item.id || item.full_name || ""),
    title: String(item.full_name || "Unknown repository").slice(0, 240),
    description: String(item.description || "").slice(0, 600),
    stars: Number.isInteger(item.stargazers_count) ? item.stargazers_count : 0,
    url: httpsUrl(item.html_url),
    source: "GitHub",
    retrievedAt
  })).filter(item => item.url);
}

async function getJson(url, { fetchImpl, timeoutMs, headers = {} }) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Priorly-Research/0.2", ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error("Provider returned HTTP " + response.status);
  return response.json();
}

export async function researchIdea(raw, {
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  timeoutMs = 8000,
  githubToken = process.env.GITHUB_TOKEN || ""
} = {}) {
  const idea = validateIdea(raw);
  const query = deriveQuery(idea);
  const retrievedAt = now();

  // Only search terms, not entire confidential founder descriptions, are sent upstream.
  // Upstream hosts are fixed: no user-controlled URL or SSRF surface.
  const openAlexUrl = new URL("https://api.openalex.org/works");
  openAlexUrl.searchParams.set("search", query);
  openAlexUrl.searchParams.set("per-page", "8");
  openAlexUrl.searchParams.set("select", "id,title,publication_year,doi,primary_location,cited_by_count");
  const githubUrl = new URL("https://api.github.com/search/repositories");
  githubUrl.searchParams.set("q", query + " in:name,description,readme");
  githubUrl.searchParams.set("per_page", "8");

  const requests = await Promise.allSettled([
    getJson(openAlexUrl.href, { fetchImpl, timeoutMs }),
    getJson(githubUrl.href, {
      fetchImpl, timeoutMs,
      headers: githubToken ? { Authorization: "Bearer " + githubToken } : {}
    })
  ]);
  const outputs = [[], []];
  const labels = ["OpenAlex", "GitHub"];
  const status = {};
  const sourceErrors = [];
  for (let i = 0; i < requests.length; i++) {
    const result = requests[i];
    try {
      if (result.status === "rejected") throw result.reason;
      outputs[i] = i === 0 ? normalizeOpenAlex(result.value, retrievedAt) : normalizeGitHub(result.value, retrievedAt);
      status[labels[i]] = "ok";
    } catch (error) {
      status[labels[i]] = "error";
      // No upstream error bodies or credential-bearing URLs are returned.
      sourceErrors.push(labels[i] + ": " + (error?.name === "TimeoutError" ? "request timed out" : "source unavailable or unexpected response"));
    }
  }

  return {
    query,
    retrievedAt,
    sourceStatus: status,
    sourceErrors,
    papers: outputs[0],
    repos: outputs[1],
    scope: "Source retrieval only. Matches are not proof of overlap, novelty, patentability, ownership or freedom to operate."
  };
}
