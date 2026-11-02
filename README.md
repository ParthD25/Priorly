# Priorly

Priorly is an evidence-first research workspace for startup differentiation, technical overlap and IP ownership readiness. It is not a novelty scorer or substitute for patent counsel.

## Implemented

Phase 1: OpenAlex/GitHub public search, same-origin Node research API, source timestamps, partial provider failure handling and test CI.

Phase 2: Account sign-up and sign-in with hashed passwords, HttpOnly cookies, persistent SQLite projects, saved research runs, deduplicated evidence, human review classifications, cross-user authorization and source-linked Markdown export.

## Run locally

Requires Node.js 22. No third-party npm dependencies.

- Start: npm run dev
- Founder workspace: http://127.0.0.1:8080/workspace.html
- Public research preview: http://127.0.0.1:8080
- Tests: npm test
- Syntax: npm run check

Default DB is .data/priorly.sqlite; override using PRIORLY_DB_PATH. Optional server-only GITHUB_TOKEN can improve public API rate limits. Bind to localhost by default; do not expose this build to the public internet.

## API

- POST /api/v1/auth/register, /api/v1/auth/login, /api/v1/auth/logout
- GET /api/v1/auth/me
- GET/POST /api/v1/projects
- GET/PUT/DELETE /api/v1/projects/:id
- GET/POST /api/v1/projects/:id/research
- GET /api/v1/projects/:id/evidence
- PATCH /api/v1/projects/:id/evidence/:evidenceId
- POST /api/v1/research (existing one-off public preview)
- GET /api/v1/health

All project endpoints check the owner identity server-side. Search results are research leads, not patent claims or legal findings. No confidential contracts, secret code, unpublished inventions or sensitive personal data should be uploaded to this development build.

## Planning and architecture

See docs/ROADMAP.md, docs/ADR-0001.md, and docs/ADR-0002.md. Next: dedicated managed database and identity, encrypted storage, reviewed security model, real patent claim data, source-to-claim mappings and independent expert validation.
