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

Phase 3 (first slice): claim-level comparisons connect a stated technical mechanism to reviewed public-source evidence, with manually attached patent/company/article links, human relation labels and auditable notes. The attached patent links are NOT independently validated, and this is not a patentability decision.

## Planning and architecture

See docs/ROADMAP.md, docs/ADR-0001.md, docs/ADR-0002.md, and docs/ADR-0003.md. Next: dedicated managed database and identity, encrypted storage, reviewed security model, real patent claim data, source-to-claim mappings and independent expert validation.

## Dedicated PostgreSQL deployment preparation

The `infra/postgres/001_priorly_schema.sql` file is a **not-yet-applied** schema baseline for a NEW Priorly Supabase project. It includes owner-scoped projects, research runs, evidence, technical claims and source comparisons, and uses RLS and composite foreign keys. GitHub Actions tests the actual SQL against an isolated Postgres 16 database; to test locally use `PRIORLY_TEST_DATABASE_URL=postgresql://...` and `npm run test:postgres` against a **disposable** database. The test bootstrap creates synthetic auth roles, so NEVER run it on an existing user database.

The local SQLite server now refuses `NODE_ENV=production` or a non-loopback binding. There is no dedicated hosted Priorly project yet, the SQL is NOT applied, and the running app does not use Postgres. Before deployment, replace local auth and SQLite storage with a fully verified hosted adapter, email verification, session management, backups, encrypted data and security testing. See docs/ADR-0004.md.

## Supabase integration adapter (development only)

Run with `PRIORLY_BACKEND=supabase`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the **server** once a dedicated Priorly Supabase project exists. The server uses managed email/password authentication and routes every project/evidence operation through PostgREST with the authenticated user's JWT, enforcing row-level policies. Emails requiring confirmation do not immediately create logged-in sessions. Local SQLite mode remains the default.

Prysm Style currently hosts only the six `priorly_*` prefixed staging tables; its Auth signup trigger adds users to fashion-profile tables, so **the Supabase application adapter deliberately refuses to connect to Prysm's Auth environment**. This preserves separation of user accounts. Neither a new subscription nor production hosting was provisioned.

See `docs/ADR-0005.md` and `.env.example` for the remaining deployment gates.

## Reusing the existing Prysm Style database (explicitly authorized)

Priorly now supports local development against the **existing** Supabase project. Copy `.env.example` to `.env`, fill in the project's publishable key, then run `npm run dev:shared`. Open `http://127.0.0.1:8080/workspace.html` and sign in with **an existing** Supabase Auth account. All application tables are prefixed `priorly_*` and have row-level ownership rules. No service-role credentials belong in frontend files or the repository.

**Important:** Authentication is shared with Prysm Style. Prysm has an automatic fashion-profile creation trigger for new Auth users, so Priorly registration is intentionally disabled in this shared mode, including at the API layer. Existing Prysm login credentials work, but no new Priorly user should sign up via this shared Auth service. This is an explicit, local development configuration—not an independently secured production service. See `docs/ADR-0006.md`.
