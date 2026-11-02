# Priorly engineering roadmap and role charters

Status: phase 1 foundation is in progress. This is an incremental build plan, not a claim that specialist autonomous agents are running.

## Product contract

Priorly compares startup hypotheses against published technical work, source-linked competitive evidence and documented IP ownership obligations. It MUST NOT certify that a startup is novel, patentable, free to operate, legally owned or commercially viable. Every substantive research claim requires traceable primary evidence and an explicit review state.

## Roles / review responsibilities

| Role | Responsibilities | Acceptance criteria |
| --- | --- | --- |
| CTO / architect | Domain model, APIs, ADRs, sequencing, build-vs-buy, privacy threat model | No cross-domain assumptions or speculative legal conclusions |
| Backend engineer | Versioned API, input validation, normalized evidence, provider adapters | Contract tests; independent provider failures; bounded requests |
| Platform engineer | CI, environments, deploys, metrics, secret rotation, rate limiting | Reproducible local builds, green tests, restricted credentials |
| Frontend engineer | Research intake, evidence review, source drill-down, accessibility | Keyboard support, clear source/error states, responsive screens |
| Security engineer | Confidentiality, authentication, authorization, audit, retention | Written threat model, access controls, security tests before private persistence |
| Research / data engineer | Retrieval quality, patent claims, provenance, citations, evaluations | Golden-set recall and grounded citation metrics, independent legal review |
| QA / product | Contract/e2e tests, customer interviews, usability, evidence workflow | Test coverage, verified scenarios, documented acceptance |

These are workstreams and review lenses; GitHub issues are not background-running agents.

## Delivery phases

### Phase 1 — Real research API and engineering guardrails
- [x] Server-hosted research API with input limits, fixed upstream providers and source status.
- [x] OpenAlex and GitHub adapters with provenance, partial failure semantics.
- [x] HTTP, validation and provider-normalization tests.
- [x] GitHub Actions test workflow.
- [ ] Live API smoke test and external deployment decision.
- [ ] Security review of browser and server behavior.

### Phase 2 — Authenticated workspaces and durable ownership evidence
- Choose a dedicated application database and auth tenant (do NOT use an unrelated existing project).
- Implement accounts, project/organization membership, permissions and policy-based data isolation.
- Add versioned schema migrations, encrypted storage, audit trails, deletion and export.
- No confidential contract uploads before threat modeling and permission tests pass.

### Phase 3 — Structured competitive and technical novelty investigation
- Claim decomposition and typed evidence graph: idea feature -> source -> excerpt -> reviewer judgment.
- Robust patents connector with claim-level citations, family/legal-status metadata, and publication-date coverage.
- Competitor documentation, academic works and GitHub evidence ingested with source provenance and license awareness.
- Human-reviewed gap matrix. NO bogus numerical novelty scores.

### Phase 4 — Ownership chain and attorney workflow
- Contributor/assignment events, employment/university/sponsor obligations, disclosure timeline, versioned supporting evidence.
- Escalations for attorney review; never automatically determine ownership or infringement.
- Privacy-appropriate storage and retention controls.

### Phase 5 — Paid pilot, evaluations and deployment hardening
- Customer discovery with accelerators and startup counsel.
- Curated evaluation set: known competitors, patents, duplicate inventions, contract conflicts.
- Citation accuracy, search recall, false positives, latency, source failure rate and user feedback.
- Production logging, distributed rate limits, queues, observability and security audit.

## Definition of done

Each feature must have a validated user story, tests, safe error states, provenance for external facts, clearly defined privacy implications, and a reviewer sign-off. Never merge or represent undocumented aspirational features as shipped.
