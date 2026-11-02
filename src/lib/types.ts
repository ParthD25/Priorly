// Shared report types. No runtime dependencies so this module is safe to import
// from both the browser and the server.

export type Classification =
  | "KNOWN_OVERLAP"
  | "POTENTIAL_DIFFERENTIATION"
  | "INSUFFICIENT_EVIDENCE";

export type SourceType = "research" | "patent" | "competitor";

export interface EvidenceSource {
  /** Stable key used to cross-reference matches, e.g. "research:https://doi.org/10.1/x". */
  key: string;
  type: SourceType;
  title: string;
  /** Journal / venue / applicant / site name, when the source reports one. */
  publisher: string | null;
  /** ISO-ish date at the precision the source actually published (year, year-month, or full date). */
  date: string | null;
  /** Human label; says "date not listed" rather than inventing one. */
  dateLabel: string;
  /** Real URL returned by the source API. */
  url: string;
  /** Abstract or snippet, truncated. Null when the source returned none. */
  excerpt: string | null;
  /** Extra labelled facts the connector returned (patent number, authors, etc). */
  meta: { label: string; value: string }[];
}

export interface CapabilityMatch {
  sourceKey: string;
  /** 0..1 evidence strength for this capability/source pair. */
  score: number;
  /** Terms from the capability text that appear in the source. */
  matchedTerms: string[];
  /** Why this source was attached to this capability. */
  rationale: string;
  /** Verbatim passage from the source (only when an LLM verified it against the text). */
  quote: string | null;
}

export interface CapabilityFinding {
  id: string;
  kind: "capability" | "workflow";
  /** The capability as decomposed. In founder-lines mode this is a verbatim slice of the founder's text. */
  label: string;
  /** How this capability was derived. */
  derivedFrom: string;
  query: string;
  classification: Classification;
  summary: string;
  matches: CapabilityMatch[];
  candidateCount: number;
  /** Per-capability note about which source types were actually searched. */
  coverageNote: string;
}

export interface ConnectorStatus {
  id: "research" | "patent" | "competitor" | "llm" | "storage";
  label: string;
  connected: boolean;
  /** What actually happened, in plain language. */
  detail: string;
}

export interface QueryLogEntry {
  query: string;
  provider: string;
  results: number;
  status: "ok" | "empty" | "not-connected" | "error" | "cached";
  note?: string;
}

export interface Intake {
  startupName: string;
  problem: string;
  customer: string;
  features: string;
  technology: string;
  businessModel: string;
}

export interface AnalysisReport {
  id: string;
  createdAt: string;
  /** Which pipeline produced the classifications. Shown at the top of the report. */
  mode: "llm" | "retrieval-only";
  intake: Intake;
  decomposition: { method: "llm" | "founder-lines"; note: string };
  capabilities: CapabilityFinding[];
  workflow: CapabilityFinding;
  sources: EvidenceSource[];
  connectors: ConnectorStatus[];
  notChecked: string[];
  limitations: string[];
  ipDocuments: { title: string; why: string }[];
  nextExperiments: string[];
  queryLog: QueryLogEntry[];
  counts: {
    capabilities: number;
    sources: number;
    knownOverlap: number;
    potentialDifferentiation: number;
    insufficientEvidence: number;
  };
  storage: "memory" | "mongodb";
  /** Milliseconds the analysis took. */
  durationMs: number;
}

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  KNOWN_OVERLAP: "Known overlap",
  POTENTIAL_DIFFERENTIATION: "Potential differentiation",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

export const CLASSIFICATION_DEFINITION: Record<Classification, string> = {
  KNOWN_OVERLAP:
    "A retrieved source was found whose own text covers the mechanism you described. This is an overlap signal to read, not a legal conclusion.",
  POTENTIAL_DIFFERENTIATION:
    "Related work exists, but the retrieved text does not describe the mechanism you described.",
  INSUFFICIENT_EVIDENCE:
    "The sources we searched did not return anything strong enough to say either way. Treat this as unknown, not as clear.",
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  research: "Research",
  patent: "Patent",
  competitor: "Competitor / product",
};

/** The demo case the product is built against. Used by the "Load the BlueCore example" button. */
export const BLUECORE_EXAMPLE: Intake = {
  startupName: "BlueCore",
  problem:
    "Pools and waterparks must keep a lifeguard on duty at every open body of water, but staffing breaks constantly: guards call out sick, certifications lapse, and shift swaps are arranged by phone. Managers currently reconcile a paper certification binder against a shift schedule by hand, which is slow and leaves compliance evidence scattered across texts and spreadsheets.",
  customer:
    "Aquatic directors and operations managers at municipal pools, waterparks and hotel/resort pools (roughly 3–40 guards per site).",
  features: `The system identifies an understaffed pool, checks employee lifeguard certifications and availability, finds a qualified replacement, requests manager approval, updates the schedule, and records compliance evidence.`,
  technology:
    "Web and mobile app backed by a Postgres database; rules engine that evaluates certification validity and availability; notification service for shift offers; audit log.",
  businessModel:
    "Per-site annual subscription, priced by number of guards on staff, sold directly to aquatic directors.",
};
