// The analysis pipeline: intake -> capabilities -> retrieval -> comparison -> report.
//
// Every stage degrades honestly. Nothing in this file invents a source, a date or
// a company: if a connector is not connected, the report says so.
import { randomBytes } from "node:crypto";
import type {
  AnalysisReport,
  CapabilityFinding,
  ConnectorStatus,
  EvidenceSource,
  Intake,
  QueryLogEntry,
} from "../lib/types";
import { sweepDiskCache } from "./cache.server";
import { decompose, type DecomposedCapability } from "./decompose.server";
import { isLlmConfigured, llmStatus } from "./llm.server";
import { judgeWithLlm, lexicalFinding, scoreSources, scoringTermsFor } from "./match.server";
import { searchResearch } from "./openalex.server";
import { patentConnector } from "./patents.server";
import { saveReport, storageDescription } from "./store.server";
import {
  contentWords,
  distinctiveTerms,
  GENERIC_TERMS,
  normalizeTerm,
  truncate,
} from "./text.server";
import {
  isWebSearchConnected,
  searchCompetitors,
  webSearchDisconnectedReason,
  webSearchStatusLabel,
} from "./websearch.server";

const MAX_SOURCES_IN_REPORT = 60;

export class IntakeError extends Error {}

function normalizeIntake(raw: Intake): Intake {
  const clean = (value: string | undefined, max: number): string =>
    (value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
  return {
    startupName: clean(raw.startupName, 120),
    problem: clean(raw.problem, 4000),
    customer: clean(raw.customer, 1500),
    features: clean(raw.features, 4000),
    technology: clean(raw.technology, 2000),
    businessModel: clean(raw.businessModel, 1500),
  };
}

export function validateIntake(intake: Intake): void {
  if (intake.problem.length < 20) {
    throw new IntakeError("Describe the problem in at least a sentence (20 characters).");
  }
  if (intake.features.length < 20) {
    throw new IntakeError(
      "Describe the proposed features/mechanisms in at least a sentence (20 characters) — the report is built from this text.",
    );
  }
}

/**
 * The most repeated distinctive words in the founder's own text: the domain the
 * searches should stay inside. Used only to widen retrieval — never to score a
 * match.
 */
function domainAnchor(intake: Intake): string[] {
  const text = `${intake.problem} ${intake.customer} ${intake.features}`;
  const counts = new Map<string, { count: number; first: number }>();
  const words = text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  words.forEach((word, index) => {
    const term = normalizeTerm(word);
    const entry = counts.get(term);
    if (entry) entry.count += 1;
    else counts.set(term, { count: 1, first: index });
  });

  return [...counts.entries()]
    .filter(([term, entry]) => entry.count >= 2 && !GENERIC_TERMS.has(term) && term.length > 3)
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, 4)
    .map(([term]) => term);
}

function capabilityQuery(capability: DecomposedCapability, anchor: string[]): string {
  // OpenAlex treats the search string as AND over terms, so a long query returns
  // nothing at all. Three terms: the capability's own distinctive words first,
  // ordinary content words when it is too thin, and at most one domain anchor.
  const text = capability.sourceText || capability.label;
  const terms = distinctiveTerms(text, 3);
  if (terms.length < 2) {
    for (const word of contentWords(text)) {
      if (terms.length >= 3) break;
      if (!terms.includes(word)) terms.push(word);
    }
  }
  if (terms.length < 2) {
    for (const term of anchor) {
      if (terms.includes(term)) continue;
      terms.push(term);
      break;
    }
  }
  return terms.slice(0, 3).join(" ");
}

function workflowQuery(intake: Intake, anchor: string[]): string {
  const terms = distinctiveTerms(intake.features, 4);
  if (terms.length < 3) {
    for (const term of anchor) {
      if (terms.includes(term)) continue;
      terms.push(term);
      if (terms.length >= 3) break;
    }
  }
  return terms.slice(0, 4).join(" ");
}

interface Retrieval {
  sources: EvidenceSource[];
  log: QueryLogEntry[];
}

async function retrieve(query: string): Promise<Retrieval> {
  const [research, patents, competitors] = await Promise.all([
    searchResearch(query),
    patentConnector.search(query, 5),
    searchCompetitors(query, 6),
  ]);

  const log: QueryLogEntry[] = [research.log, patents.log, competitors.log];
  let researchSources = research.sources;

  // OpenAlex ANDs its search terms, so a narrow query can legitimately return
  // nothing. One relaxation step, logged, rather than silently returning empty.
  const relaxedQuery = query.split(" ").slice(0, 2).join(" ");
  if (research.sources.length === 0 && relaxedQuery && relaxedQuery !== query) {
    const relaxed = await searchResearch(relaxedQuery);
    researchSources = relaxed.sources;
    log.push({
      ...relaxed.log,
      note: `relaxed query — the full query "${query}" returned no results`,
    });
  }

  const sources: EvidenceSource[] = [];
  const seen = new Set<string>();
  for (const source of [...researchSources, ...patents.sources, ...competitors.sources]) {
    if (seen.has(source.key)) continue;
    seen.add(source.key);
    sources.push(source);
  }
  return { sources, log };
}

function coverageNote(): string {
  const parts: string[] = [];
  parts.push("Research (OpenAlex) searched");
  parts.push(patentConnector.isConnected() ? "patents searched" : "patents NOT searched");
  parts.push(isWebSearchConnected() ? "competitor web search run" : "competitor web search NOT run");
  return parts.join(" · ");
}

function buildNextExperiments(
  findings: CapabilityFinding[],
  patentsConnected: boolean,
): string[] {
  const experiments: string[] = [];

  const insufficient = findings.filter((f) => f.classification === "INSUFFICIENT_EVIDENCE");
  const overlaps = findings.filter((f) => f.classification === "KNOWN_OVERLAP");

  for (const finding of overlaps.slice(0, 2)) {
    const top = finding.matches[0];
    if (!top) continue;
    experiments.push(
      `For "${truncate(finding.label, 70)}": read the matched source, then write down step by step what it does NOT do. That difference is your differentiation claim — the thing worth testing next.`,
    );
  }

  for (const finding of insufficient.slice(0, 3)) {
    experiments.push(
      `For "${truncate(finding.label, 70)}": the public research index returned nothing usable. Run a targeted search by hand (Google Scholar, Espacenet, trade press) before assuming this part of the workflow is novel.`,
    );
  }

  if (!patentsConnected) {
    experiments.push(
      "Connect a patent source (USPTO Open Data Portal key) and re-run: no patent search has happened yet, and patent coverage is where most of the risk in this report sits.",
    );
  }

  experiments.push(
    "Interview five people in the target customer role and ask them to walk through how they handle this today. Written sources miss the workarounds people actually use.",
  );

  return experiments.slice(0, 6);
}

function buildIpDocuments(): { title: string; why: string }[] {
  return [
    {
      title: "Invention assignment agreements for every founder and early contributor",
      why: "If a contributor never signed an assignment, the company may not own the work they did. This is the single most common ownership gap in a young company.",
    },
    {
      title: "Employment and contractor agreements covering IP, confidentiality and non-solicit",
      why: "Contractors and part-time engineers often keep rights unless the contract assigns them. Gather the signed versions, not the templates.",
    },
    {
      title: "University or previous-employer IP policy, if any founder developed this while employed or studying",
      why: "Universities and employers sometimes claim rights over work in their field, or over work done with their resources. The policy text decides this.",
    },
    {
      title: "Open-source licence inventory for every dependency in the stack",
      why: "Some licences (GPL-family, AGPL) carry obligations that matter if the product is distributed or offered as a service. An inventory makes that review possible.",
    },
    {
      title: "List of public disclosures and their dates (demos, pitches, GitHub releases, papers, sales)",
      why: "Disclosure dates matter to novelty timing in most jurisdictions. A dated list lets counsel assess it; memory does not.",
    },
  ];
}

function buildNotChecked(args: {
  patentsConnected: boolean;
  webConnected: boolean;
  llm: boolean;
  queryLog: QueryLogEntry[];
}): string[] {
  const items: string[] = [];

  if (!args.patentsConnected) {
    items.push(
      "Patent coverage: not connected — no patent search was performed for this report. Nothing here should be read as a patentability or freedom-to-operate finding.",
    );
  }
  if (!args.webConnected) {
    items.push(
      "Competitor web search: not connected — no company, product page or pricing page was searched, so the report cannot tell you who is already selling this.",
    );
  }
  if (!args.llm) {
    items.push(
      "Claim-level comparison: not connected — no model read the sources. Classifications come from term overlap between your description and retrieved titles/abstracts, which is weaker evidence than a passage-level comparison.",
    );
  }

  items.push(
    "Full text: only titles and abstracts were read. No PDF, figure or specification was opened, so a mechanism described only in a paper's body or a patent's claims would be missed.",
  );
  items.push(
    "Language: the search ran in English only. Sources published in other languages were not translated or searched in their own language.",
  );
  items.push(
    "Other databases: Google Scholar, Espacenet, national patent registers, trade press and paid prior-art databases were not queried.",
  );
  items.push(
    "Product landscape: pricing, traction and funding of any company mentioned were not checked. A source appearing here is not a statement that a competitor exists.",
  );

  const failures = args.queryLog.filter((entry) => entry.status === "error");
  if (failures.length > 0) {
    const detail = failures
      .slice(0, 4)
      .map((entry) => `"${entry.query}" (${entry.provider}: ${entry.note ?? "request failed"})`)
      .join("; ");
    items.push(`Search requests that failed during this run: ${detail}. Those capabilities are less covered than the rest.`);
  }

  return items;
}

function buildLimitations(llm: boolean): string[] {
  const items = [
    "This report compares text, not legal claims. No claim chart was produced and no claim scope was interpreted.",
    "A match means a retrieved source talks about the same mechanism. It does not mean the source is prior art, valid, or enforceable.",
    "Absence of evidence is not evidence of absence: a capability marked insufficient evidence may still be well covered by sources we did not reach.",
  ];
  if (!llm) {
    items.push(
      "Retrieval-only mode: term matching over titles and abstracts. Synonyms and paraphrases are missed, so a strong match can be understated and a weak one overstated.",
    );
  }
  return items;
}

function newReportId(): string {
  return randomBytes(7).toString("hex");
}

export async function runAnalysis(rawIntake: Intake): Promise<AnalysisReport> {
  const started = Date.now();
  const intake = normalizeIntake(rawIntake);
  validateIntake(intake);

  void sweepDiskCache();

  const llm = isLlmConfigured();
  const patentsConnected = patentConnector.isConnected();
  const webConnected = isWebSearchConnected();
  const status = llmStatus();

  const decomposition = await decompose(intake);
  const anchor = domainAnchor(intake);

  const queryLog: QueryLogEntry[] = [];
  const allSources: EvidenceSource[] = [];
  const sourceKeys = new Set<string>();

  const findings: CapabilityFinding[] = [];

  for (const capability of decomposition.capabilities) {
    const query = capabilityQuery(capability, anchor);
    const retrieval = await retrieve(query);
    queryLog.push(...retrieval.log);

    for (const source of retrieval.sources) {
      if (sourceKeys.has(source.key)) continue;
      if (allSources.length >= MAX_SOURCES_IN_REPORT) break;
      sourceKeys.add(source.key);
      allSources.push(source);
    }

    findings.push(
      lexicalFinding({
        id: capability.id,
        kind: "capability",
        label: capability.label,
        derivedFrom: capability.derivedFrom,
        query,
        terms: scoringTermsFor(capability.sourceText || capability.label),
        sources: retrieval.sources,
        anchors: anchor,
        coverageNote: coverageNote(),
      }),
    );
  }

  // The whole workflow, as one composite query: this is what catches a competitor
  // or paper that does the entire thing end to end without matching any single step.
  const compositeQuery = workflowQuery(intake, anchor);
  const compositeRetrieval = await retrieve(compositeQuery);
  queryLog.push(...compositeRetrieval.log);
  for (const source of compositeRetrieval.sources) {
    if (sourceKeys.has(source.key)) continue;
    if (allSources.length >= MAX_SOURCES_IN_REPORT) break;
    sourceKeys.add(source.key);
    allSources.push(source);
  }

  const workflowFinding = lexicalFinding({
    id: "workflow",
    kind: "workflow",
    label: "Whole workflow, end to end",
    derivedFrom: "composite query built from your full feature description",
    query: compositeQuery,
    terms: scoringTermsFor(intake.features),
    sources: compositeRetrieval.sources,
    anchors: anchor,
    coverageNote: coverageNote(),
  });

  // Optional second pass: a model judges the shortlist and must quote the source.
  let mode: "llm" | "retrieval-only" = "retrieval-only";
  const findingsForJudging = [...findings, workflowFinding];
  if (llm) {
    const inputs = findingsForJudging.map((finding, index) => {
      const capability = decomposition.capabilities[index];
      const terms = capability
        ? scoringTermsFor(capability.sourceText || capability.label)
        : scoringTermsFor(intake.features);
      const pool = index < findings.length ? allSources : compositeRetrieval.sources;
      return {
        id: finding.id,
        label: capability?.label ?? "Whole workflow, end to end",
        candidates: scoreSources(terms, pool, anchor),
      };
    });

    const judged = await judgeWithLlm(inputs);
    if (judged) {
      mode = "llm";
      for (const finding of findingsForJudging) {
        const judgement = judged.judgements.get(finding.id);
        if (!judgement) continue;
        finding.classification = judgement.classification;
        finding.summary = judgement.summary;
        if (judgement.matches.length > 0) finding.matches = judgement.matches;
      }
    }
  }

  const findingsAll = [...findings, workflowFinding];
  const counts = {
    capabilities: findings.length,
    sources: allSources.length,
    knownOverlap: findingsAll.filter((f) => f.classification === "KNOWN_OVERLAP").length,
    potentialDifferentiation: findingsAll.filter(
      (f) => f.classification === "POTENTIAL_DIFFERENTIATION",
    ).length,
    insufficientEvidence: findingsAll.filter(
      (f) => f.classification === "INSUFFICIENT_EVIDENCE",
    ).length,
  };

  const connectors: ConnectorStatus[] = [
    {
      id: "research",
      label: "Research — OpenAlex",
      connected: true,
      detail: "Public scholarly index, no key required. Titles and abstracts were retrieved per capability.",
    },
    {
      id: "patent",
      label: `Patents — ${patentConnector.label}`,
      connected: patentsConnected,
      detail: patentsConnected
        ? "Patent search ran for every capability."
        : "Not connected — no patent search was performed for this report.",
    },
    {
      id: "competitor",
      label: "Competitor / product web search",
      connected: webConnected,
      detail: webConnected
        ? `Searched via ${webSearchStatusLabel()}.`
        : webSearchDisconnectedReason(),
    },
    {
      id: "llm",
      label: "Claim-level comparison (LLM)",
      connected: llm && mode === "llm",
      detail:
        llm && mode === "llm"
          ? `Ran on ${status.model ?? "the configured model"}. Every quoted passage was checked against the retrieved text.`
          : llm
            ? "A key is configured but the model did not return a usable judgement, so this report fell back to retrieval-only scoring."
            : "Not connected — no model key configured. This report was produced by retrieval-only term matching.",
    },
  ];

  const id = newReportId();
  const report: AnalysisReport = {
    id,
    createdAt: new Date().toISOString(),
    mode,
    intake,
    decomposition: { method: decomposition.method, note: decomposition.note },
    capabilities: findings,
    workflow: workflowFinding,
    sources: allSources,
    connectors,
    notChecked: buildNotChecked({ patentsConnected, webConnected, llm: mode === "llm", queryLog }),
    limitations: buildLimitations(mode === "llm"),
    ipDocuments: buildIpDocuments(),
    nextExperiments: buildNextExperiments(findingsAll, patentsConnected),
    queryLog,
    counts,
    storage: "memory",
    durationMs: Date.now() - started,
  };

  const saved = await saveReport(report);
  report.storage = saved.storage;
  return report;
}

export function storageNote(kind: "memory" | "mongodb"): string {
  return storageDescription(kind);
}
