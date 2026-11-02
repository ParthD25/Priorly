import test from "node:test";
import assert from "node:assert/strict";
import { researchIdea, deriveQuery, validateIdea, normalizeOpenAlex } from "../server/research.mjs";
import { createApp } from "../server/app.mjs";

const idea = {
  ideaName: "Priorly",
  ideaProblem: "Founders cannot easily trace competitive overlap.",
  ideaSolution: "Connect technical research, evidence and ownership agreements.",
  ideaAudience: "Startup studios",
  ideaKeywords: "patent analytics, chain of title"
};
const mockFetch = async (url) => {
  if (url.includes("openalex.org")) return new Response(JSON.stringify({
    results: [{
      id: "https://openalex.org/W123", title: "Relevant paper",
      publication_year: 2025, cited_by_count: 4, doi: "https://doi.org/10.1/test"
    }]
  }), { status: 200 });
  return new Response(JSON.stringify({
    items: [{ id: 5, full_name: "sample/tool", html_url: "https://github.com/sample/tool", description: "Evidence", stargazers_count: 30 }]
  }), { status: 200 });
};

test("validates and bounds client input", () => {
  assert.equal(validateIdea(idea).ideaName, "Priorly");
  assert.throws(() => validateIdea({ ...idea, ideaSolution: 4 }), /must be text/);
  assert.throws(() => validateIdea({ ...idea, ideaProblem: "   " }), /at least five/);
  assert.throws(() => validateIdea({ ...idea, ideaKeywords: "x".repeat(301) }), /exceeds/);
  assert.throws(() => validateIdea([]), /object/);
});

test("derives a bounded query from explicit founder terminology", () => {
  assert.equal(deriveQuery(idea), "patent analytics chain of title");
  assert.ok(deriveQuery({ ...idea, ideaKeywords: "" }).length > 0);
  assert.ok(deriveQuery({ ...idea, ideaKeywords: "a".repeat(200) }).length <= 130);
});

test("retrieves two provider sets with linked provenance", async () => {
  const result = await researchIdea(idea, { fetchImpl: mockFetch, now: () => "2026-11-02T00:00:00Z" });
  assert.equal(result.sourceStatus.OpenAlex, "ok");
  assert.equal(result.sourceStatus.GitHub, "ok");
  assert.equal(result.papers[0].source, "OpenAlex");
  assert.equal(result.papers[0].retrievedAt, "2026-11-02T00:00:00Z");
  assert.equal(result.repos[0].url, "https://github.com/sample/tool");
  assert.equal(result.sourceErrors.length, 0);
  assert.match(result.scope, /not proof/);
});

test("provider failures do not get represented as 'no prior art'", async () => {
  const result = await researchIdea(idea, { fetchImpl: async url => {
    if (url.includes("openalex.org")) throw Error("private upstream error");
    return mockFetch(url);
  } });
  assert.equal(result.sourceStatus.OpenAlex, "error");
  assert.equal(result.papers.length, 0);
  assert.equal(result.repos.length, 1);
  assert.match(result.sourceErrors[0], /source unavailable/);
  assert.doesNotMatch(result.sourceErrors[0], /private/);
});

test("normalization rejects malformed upstream data", () => {
  assert.throws(() => normalizeOpenAlex({ results: {} }, "now"), /Unexpected/);
  assert.equal(normalizeOpenAlex({ results: [{ title: "bad", doi: "javascript:alert(1)" }] }, "now").length, 0);
});

test("HTTP server serves static assets and a real validated research endpoint", async t => {
  const server = createApp({
    service: body => researchIdea(body, { fetchImpl: mockFetch }),
    maxRequests: 2
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = "http://127.0.0.1:" + server.address().port;
  const health = await fetch(root + "/api/v1/health");
  assert.equal((await health.json()).status, "ok");
  const page = await fetch(root + "/");
  assert.match(await page.text(), /Priorly/);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  const one = await fetch(root + "/api/v1/research", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(idea)
  });
  assert.equal(one.status, 200);
  assert.equal((await one.json()).papers.length, 1);
  const invalid = await fetch(root + "/api/v1/research", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ideaName: "" })
  });
  assert.equal(invalid.status, 400);
  const limited = await fetch(root + "/api/v1/research", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(idea)
  });
  assert.equal(limited.status, 429);
});
