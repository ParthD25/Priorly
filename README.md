# Priorly

**Evidence-first startup differentiation, technology research and IP ownership readiness.**

Priorly is being developed incrementally into a full product, not a novelty-score generator. It gathers public research and code references, helps founders organize ownership evidence and exports a transparent brief. It does NOT determine patentability, ownership, freedom to operate, legal compliance or business viability.

## Run locally

Requires Node.js 22 or later; no npm dependencies or API keys required for basic public research.

1. Run: npm run dev
2. Open: http://127.0.0.1:8080
3. Check liveness: http://127.0.0.1:8080/api/v1/health
4. Run tests: npm test

Optionally set GITHUB_TOKEN in your server environment for a higher GitHub API rate limit. Never put a token in a browser file or commit it.

The static frontend must be served by the Node server for research to work. GitHub Pages can render the interface but cannot host the /api/v1/research backend.

## Implemented in this increment

- A same-origin Node HTTP API for research; validated inputs, maximum request size, fixed-source requests, timeouts, source-aware error reporting and baseline security headers.
- OpenAlex and GitHub provider normalization with source links and retrieval timestamps.
- A research frontend that consumes the backend instead of calling external APIs directly.
- Built-in Node tests and GitHub Actions workflow.
- Idea review, ownership checklist and Markdown/JSON export from the prior static preview.

## Limitations

This is still an **unauthenticated, non-production research preview**. No durable database or user accounts, no automated claim-by-claim patent search, no authoritative competitor analysis, no model-driven invention extraction and no qualified legal review. Server rate limits are in-memory only. The browser stores draft data in localStorage, which is inappropriate for confidential inventions and contracts; do not paste confidential material. Search terms are transmitted to OpenAlex and GitHub when research is run. Search results are not legal conclusions.

See docs/ROADMAP.md and docs/ADR-0001.md for sequencing, responsibilities, security boundaries and acceptance criteria.

## API quick example

POST /api/v1/research with application/json and keys ideaName, ideaProblem, ideaSolution, ideaAudience, ideaKeywords. Results have separate sourceStatus values; unavailable providers are explicitly flagged rather than treated as a negative novelty result.

## Legal

Priorly provides research organization, not legal advice. Neither a positive search hit nor the absence of hits establishes novelty, inventorship, patentability, freedom to operate, or legal title.
