// Comparing a capability against retrieved sources.
//
// Two modes, and the report always states which one produced it:
//   - llm: the model judges, per capability, whether the retrieved text discloses
//     the same mechanism, and must quote a passage. Every quote is checked
//     against the retrieved text before it is shown; unverifiable quotes are
//     dropped rather than printed.
//   - retrieval-only: transparent lexical scoring over title + abstract. No
//     embeddings, no hidden model, and the matched terms are printed so a reader
//     can check the reasoning themselves.
import type {
  CapabilityFinding,
  CapabilityMatch,
  Classification,
  EvidenceSource,
} from "../lib/types";
import { chatJson } from "./llm.server";
import { GENERIC_TERMS, normalizeTerm, scoringTerms, termSet } from "./text.server";

export interface ScoredSource {
  source: EvidenceSource;
  score: number;
  /** score nudged up when the source is also in the founder's domain; used for ranking only. */
  rank: number;
  matchedTerms: string[];
  distinctiveMatches: number;
  inTitle: string[];
  /** Domain anchor terms (pool, lifeguard, …) present in the source. */
  anchorMatches: string[];
}

export function scoreSource(terms: string[], source: EvidenceSource, anchors: string[] = []): ScoredSource {
  const titleTerms = termSet(source.title);
  const bodyText = [source.excerpt ?? "", ...source.meta.map((entry) => entry.value)].join(" ");
  const bodyTerms = termSet(bodyText);

  const matchedTerms: string[] = [];
  const inTitle: string[] = [];
  let weight = 0;

  for (const term of terms) {
    const key = normalizeTerm(term);
    const inTitleHit = titleTerms.has(key);
    const inBodyHit = bodyTerms.has(key);
    if (!inTitleHit && !inBodyHit) continue;
    matchedTerms.push(key);
    if (inTitleHit) {
      inTitle.push(key);
      weight += 1;
    } else {
      weight += 0.55;
    }
  }

  const anchorMatches = anchors.filter(
    (anchor) => titleTerms.has(anchor) || bodyTerms.has(anchor),
  );

  const score = terms.length > 0 ? Math.min(1, weight / terms.length) : 0;
  const distinctiveMatches = matchedTerms.filter((term) => !GENERIC_TERMS.has(term)).length;
  const rank = score + (anchorMatches.length > 0 ? 0.3 : 0);

  return { source, score, rank, matchedTerms, distinctiveMatches, inTitle, anchorMatches };
}

export function scoreSources(
  terms: string[],
  sources: EvidenceSource[],
  anchors: string[] = [],
): ScoredSource[] {
  return sources
    .map((source) => scoreSource(terms, source, anchors))
    .filter((scored) => scored.matchedTerms.length > 0)
    .sort((a, b) => b.rank - a.rank || b.distinctiveMatches - a.distinctiveMatches);
}

export interface ClassificationResult {
  classification: Classification;
  summary: string;
  matches: CapabilityMatch[];
}

const KNOWN_OVERLAP_SCORE = 0.5;
const RELATED_TWO_TERM_SCORE = 0.28;
const RELATED_TITLE_SCORE = 0.3;

function rationaleFor(scored: ScoredSource, termCount: number): string {
  const where =
    scored.inTitle.length > 0
      ? `${String(scored.inTitle.length)} in the title`
      : "abstract only";
  const domain =
    scored.anchorMatches.length > 0
      ? ` Also in your domain (${scored.anchorMatches.slice(0, 3).join(", ")}).`
      : " Not in your domain: it shares the wording, not the subject matter.";
  return `Shares ${String(scored.matchedTerms.length)} of ${String(termCount)} key terms from your description (${scored.matchedTerms
    .slice(0, 8)
    .join(", ")}); ${where}.${domain}`;
}

/**
 * Retrieval-only classification. Deliberately conservative:
 *  - known overlap needs at least two distinctive (non-generic) term matches and
 *    a real share of the capability's terms;
 *  - a single matching term only counts when it is in the source's title, and only
 *    as related work;
 *  - everything weaker is insufficient evidence, never a claim of overlap.
 */
export function classifyLexically(
  terms: string[],
  sources: EvidenceSource[],
  anchors: string[] = [],
): ClassificationResult {
  const scored = scoreSources(terms, sources, anchors);
  const matches: CapabilityMatch[] = scored.slice(0, 3).map((item) => ({
    sourceKey: item.source.key,
    score: Number(item.score.toFixed(3)),
    matchedTerms: item.matchedTerms,
    rationale: rationaleFor(item, terms.length),
    quote: null,
  }));

  const top = scored[0];
  const distinctiveCapTerms = terms.filter((term) => !GENERIC_TERMS.has(term)).length;

  if (!top) {
    return {
      classification: "INSUFFICIENT_EVIDENCE",
      summary:
        sources.length === 0
          ? "No sources were retrieved for this capability's search, so there is nothing to compare yet."
          : `${String(sources.length)} sources were retrieved, but none shared the key terms of this capability.`,
      matches,
    };
  }

  // "Known overlap" is the strongest claim this report can make, so it needs the
  // most: a capability with enough substance, a large share of its distinctive
  // terms present, and a source that is also in the founder's domain. Wording
  // overlap alone (a tax paper about "qualified replacement property") is not
  // allowed to become a known overlap.
  const strongTermCoverage =
    top.distinctiveMatches >= 3 ||
    (top.distinctiveMatches >= 2 && top.inTitle.length >= 2 && top.score >= 0.6);

  if (
    distinctiveCapTerms >= 3 &&
    strongTermCoverage &&
    top.anchorMatches.length >= 1 &&
    top.score >= KNOWN_OVERLAP_SCORE
  ) {
    return {
      classification: "KNOWN_OVERLAP",
      summary: `A retrieved source's own title/abstract covers the same terms as this capability ("${top.source.title.slice(0, 120)}"). Read the source before relying on it: this is a term-level match, not a claim-level analysis.`,
      matches,
    };
  }

  // "Related work exists" also has a floor: either the source is in the founder's
  // domain and shares real terms with the capability, or it overlaps on three
  // distinctive terms even though it comes from another field. A source that
  // merely happens to contain the same generic words is not related work.
  const inDomain = top.anchorMatches.length >= 1;
  const twoTermRelated = inDomain && top.distinctiveMatches >= 2 && top.score >= RELATED_TWO_TERM_SCORE;
  const oneTitleTermRelated =
    inDomain && top.distinctiveMatches >= 1 && top.inTitle.length >= 1 && top.score >= RELATED_TITLE_SCORE;
  const crossDomainRelated = top.distinctiveMatches >= 3 && top.score >= 0.4;

  if (twoTermRelated || oneTitleTermRelated || crossDomainRelated) {
    return {
      classification: "POTENTIAL_DIFFERENTIATION",
      summary: `Related work exists, but its text does not describe this specific mechanism closely enough to call it covered. Top related source: "${top.source.title.slice(0, 120)}".`,
      matches,
    };
  }

  return {
    classification: "INSUFFICIENT_EVIDENCE",
    summary: `The ${String(sources.length)} retrieved sources are only loosely related (best term overlap: ${(top.score * 100).toFixed(0)}%, ${String(top.distinctiveMatches)} distinctive term${top.distinctiveMatches === 1 ? "" : "s"} matched). Not enough to say either way.`,
    matches,
  };
}

// ---------------------------------------------------------------------------
// LLM judgement
// ---------------------------------------------------------------------------

interface LlmJudgementItem {
  capabilityId?: string;
  classification?: string;
  summary?: string;
  supportingSourceKeys?: string[];
  quotes?: { sourceKey?: string; quote?: string }[];
}

interface LlmJudgementResponse {
  judgements?: LlmJudgementItem[];
}

const ALLOWED: Record<string, Classification> = {
  KNOWN_OVERLAP: "KNOWN_OVERLAP",
  POTENTIAL_DIFFERENTIATION: "POTENTIAL_DIFFERENTIATION",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
};

function normalizeForQuoteCheck(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

function quoteIsGrounded(quote: string, source: EvidenceSource): boolean {
  const haystack = normalizeForQuoteCheck([source.title, source.excerpt ?? ""].join(" "));
  const needle = normalizeForQuoteCheck(quote);
  if (needle.length < 20) return false;
  return haystack.includes(needle);
}

export interface JudgedCapability {
  id: string;
  classification: Classification;
  summary: string;
  matches: CapabilityMatch[];
}

/**
 * One model call for all capabilities, over a shortlist of candidates chosen by
 * the lexical pass. Returns null when the model is unavailable or its answer is
 * unusable, so the caller can fall back to retrieval-only mode.
 */
export async function judgeWithLlm(
  inputs: { id: string; label: string; candidates: ScoredSource[] }[],
): Promise<{ judgements: Map<string, JudgedCapability>; model: string } | null> {
  const payload = inputs.map((input) => ({
    capabilityId: input.id,
    capability: input.label,
    candidates: input.candidates.slice(0, 4).map((candidate) => ({
      sourceKey: candidate.source.key,
      type: candidate.source.type,
      title: candidate.source.title,
      publisher: candidate.source.publisher,
      date: candidate.source.dateLabel,
      text: (candidate.source.excerpt ?? "").slice(0, 500),
    })),
  }));

  const result = await chatJson<LlmJudgementResponse>({
    timeoutMs: 50_000,
    maxTokens: 2000,
    system:
      "You are a prior-art analyst for a startup due-diligence report. For each capability you receive " +
      "the founder's description and a shortlist of real retrieved sources (title + abstract excerpt). " +
      "Judge ONLY from the supplied text. Rules:\n" +
      "- KNOWN_OVERLAP: a supplied source's text explicitly discloses the same technical mechanism. Quote the exact supporting passage.\n" +
      "- POTENTIAL_DIFFERENTIATION: related work exists but the described mechanism differs or is absent. Explain the difference.\n" +
      "- INSUFFICIENT_EVIDENCE: the sources are unrelated or too thin. This is the correct answer whenever you are unsure.\n" +
      "Never invent a source, a title or a quote. A quote must be copied verbatim from the supplied text.\n" +
      "Return JSON: {\"judgements\":[{\"capabilityId\":\"\",\"classification\":\"KNOWN_OVERLAP|POTENTIAL_DIFFERENTIATION|INSUFFICIENT_EVIDENCE\",\"summary\":\"2 sentences, plain English\",\"supportingSourceKeys\":[\"\"],\"quotes\":[{\"sourceKey\":\"\",\"quote\":\"verbatim passage\"}]}]}",
    user: JSON.stringify(payload),
  });

  if (!result) return null;

  const byKey = new Map<string, EvidenceSource>();
  for (const input of inputs) {
    for (const candidate of input.candidates) byKey.set(candidate.source.key, candidate.source);
  }

  const judgements = new Map<string, JudgedCapability>();
  for (const item of result.data.judgements ?? []) {
    const id = item.capabilityId?.trim();
    const classification = ALLOWED[(item.classification ?? "").trim().toUpperCase()];
    if (!id || !classification) continue;

    const candidateList = inputs.find((input) => input.id === id)?.candidates ?? [];
    const matches: CapabilityMatch[] = [];
    for (const quote of item.quotes ?? []) {
      const source = quote.sourceKey ? byKey.get(quote.sourceKey) : undefined;
      if (!source || !quote.quote) continue;
      const grounded = quoteIsGrounded(quote.quote, source);
      matches.push({
        sourceKey: source.key,
        score: grounded ? 1 : 0.5,
        matchedTerms: [],
        rationale: grounded
          ? "Quoted passage verified against the retrieved text."
          : "Model cited this source, but the quoted passage could not be verified against the retrieved text — treat as unconfirmed.",
        quote: grounded ? quote.quote.trim() : null,
      });
    }

    // Attach the strongest retrieved candidates the model named but did not quote.
    for (const key of item.supportingSourceKeys ?? []) {
      if (matches.some((match) => match.sourceKey === key)) continue;
      const source = byKey.get(key);
      if (!source) continue;
      matches.push({
        sourceKey: key,
        score: 0.5,
        matchedTerms: [],
        rationale: "Cited by the model as related work.",
        quote: null,
      });
    }

    // If the model named nothing usable, fall back to the lexical shortlist so the
    // report still shows what was actually retrieved.
    if (matches.length === 0 && candidateList.length > 0) {
      for (const candidate of candidateList.slice(0, 2)) {
        matches.push({
          sourceKey: candidate.source.key,
          score: Number(candidate.score.toFixed(3)),
          matchedTerms: candidate.matchedTerms,
          rationale: rationaleFor(candidate, candidate.matchedTerms.length || 1),
          quote: null,
        });
      }
    }

    judgements.set(id, {
      id,
      classification,
      summary:
        (item.summary ?? "").trim() ||
        "The model returned no explanation for this classification.",
      matches: matches.slice(0, 3),
    });
  }

  if (judgements.size === 0) return null;
  return { judgements, model: result.model };
}

/** Build a finding from a lexical result (used when no model is available). */
export function lexicalFinding(args: {
  id: string;
  kind: "capability" | "workflow";
  label: string;
  derivedFrom: string;
  query: string;
  terms: string[];
  sources: EvidenceSource[];
  anchors: string[];
  coverageNote: string;
}): CapabilityFinding {
  const result = classifyLexically(args.terms, args.sources, args.anchors);
  return {
    id: args.id,
    kind: args.kind,
    label: args.label,
    derivedFrom: args.derivedFrom,
    query: args.query,
    classification: result.classification,
    summary: result.summary,
    matches: result.matches,
    candidateCount: args.sources.length,
    coverageNote: args.coverageNote,
  };
}

export function scoringTermsFor(text: string): string[] {
  return scoringTerms(text, 10);
}
