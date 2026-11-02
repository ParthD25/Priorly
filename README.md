# Priorly

**An evidence-first startup idea, technical novelty and IP-readiness research MVP.**

Priorly helps founders formulate an idea, retrieve public research and open-source projects, organize questions about patent novelty and intellectual-property ownership, and export a source-linked brief for independent professional review. No fabricated novelty or patentability scores.

## Run locally

This MVP intentionally requires **no build process, npm install or API secrets**:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

You can also publish the repository with GitHub Pages (Settings → Pages → deploy from main / root). The website is static. Data is saved in your browser's localStorage only.

## Features

- Responsive research dashboard and idea-intake form.
- Public **OpenAlex** works search and **GitHub** repository search, with original links.
- Explicit per-source failure notices; absence of matches is **not** a novelty finding.
- Search handoff to Google Patents and USPTO; no unjustified automated legal conclusions.
- Eight-point IP ownership evidence checklist for contributors, universities, third-party rights, publications and counsel review.
- Source-linked Markdown and JSON reports, and print-friendly briefing page.
- No server, accounts, tracking pixels, supplied model credentials or external AI inference. Public search queries do go to the named research APIs.

## Scope and caveats

This is a **working research-organizing prototype**, not a finished due-diligence product. Public APIs can rate-limit, change contract or experience network/CORS failure. Results are retrieval matches: they are not systematic competitor coverage, patent-claim comparisons, independent prior-art searches, attorney opinions, market forecasts, or evidence of ownership. Browser data can be lost if cleared; do not store secrets or sensitive contract terms in notes. A future production service should proxy APIs server-side, use authenticated private storage, build a cited evidence graph, maintain evaluated recall/precision metrics, ingest patents under an authorized API integration and support professional review.

## Proposed next roadmap

1. Secure auth, projects and encrypted persistence with deletion/export controls.
2. Backend provider adapters for patents, scholarly research, competitor pages and licensed datasets with provenance.
3. Feature-by-feature claim extraction and evidence reviews (human verification, no generic 'uniqueness percent').
4. Contributor/IP chain-of-title graph with confidential contracts and attorney escalation.
5. Test corpus for citation accuracy, source coverage, retrieval relevance and false-positive risk flags.
6. User interviews and paid pilots with founders, accelerators and startup counsel.

## Important

Priorly is not a law firm. It does not provide legal advice and cannot certify originality, patentability, freedom to operate, title or non-infringement.