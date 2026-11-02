// Capability decomposition.
//
// Two paths:
//   1. LLM (when a key is configured) — may rephrase and split, but is told to
//      stay inside what the founder wrote.
//   2. Founder-lines (always available) — splits the founder's own text on
//      lines, bullets, semicolons and clause boundaries. Every capability is a
//      verbatim slice of the founder's words, so nothing is invented.
import type { Intake } from "../lib/types";
import { chatJson } from "./llm.server";
import { distinctiveTerms, truncate } from "./text.server";

export interface DecomposedCapability {
  id: string;
  label: string;
  derivedFrom: string;
  /** The founder's original words this capability came from. */
  sourceText: string;
}

export interface Decomposition {
  method: "llm" | "founder-lines";
  note: string;
  capabilities: DecomposedCapability[];
  /** Terms describing the problem domain, appended to per-capability searches. */
  domainTerms: string[];
}

const MIN_CAPABILITIES = 4;
const MAX_CAPABILITIES = 8;

/** Split text into clause-level segments, preserving the founder's wording. */
export function splitClauses(text: string): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•‣–]|\d+[.)]|[a-z][.)])\s+/i, "").trim())
    .filter((line) => line.length > 0);

  const segments: string[] = [];
  for (const line of lines) {
    const bySemicolon = line.split(/;\s*/);
    for (const chunk of bySemicolon) {
      const words = chunk.split(/\s+/).filter(Boolean);
      if (words.length <= 16) {
        segments.push(chunk);
        continue;
      }
      // A long single sentence: split at ", " / " and then " boundaries so each
      // clause becomes its own capability instead of one unwieldy blob.
      const parts = chunk
        .split(/,\s+|\s+and then\s+|\s+then\s+|\s+and\s+(?=(?:the|a|an|it|we|our)\b)/i)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1) segments.push(...parts);
      else segments.push(chunk);
    }
  }

  return segments
    .map((segment) =>
      segment
        .replace(/^(?:and|then|also|additionally|finally)\s+/i, "")
        .replace(/[.,;:\s]+$/, "")
        .trim(),
    )
    .filter((segment) => segment.split(/\s+/).filter(Boolean).length >= 3);
}

function tidyLabel(segment: string): string {
  const trimmed = segment.trim();
  const withoutLead = trimmed
    .replace(/^(?:the (?:system|platform|app|product|software|tool)|it|our (?:system|platform|product))\s+/i, "")
    .replace(/^we\s+/i, "");
  const label = withoutLead.length > 0 ? withoutLead : trimmed;
  const capitalised = label.charAt(0).toUpperCase() + label.slice(1);
  return truncate(capitalised, 110);
}

/** Merge adjacent segments (shortest first) until we are at or below the cap. */
function capSegments(segments: string[], max: number): string[] {
  const working = [...segments];
  while (working.length > max) {
    let shortest = 0;
    for (let index = 1; index < working.length; index++) {
      if (working[index].length < working[shortest].length) shortest = index;
    }
    const neighbour = shortest === working.length - 1 ? shortest - 1 : shortest + 1;
    const merged = [working[shortest], working[neighbour]].join("; ");
    const low = Math.min(shortest, neighbour);
    working.splice(low, 2, merged);
  }
  return working;
}

function buildDomainTerms(intake: Intake): string[] {
  const combined = `${intake.problem} ${intake.customer}`;
  return distinctiveTerms(combined, 6);
}

function fromFounderText(intake: Intake): Decomposition {
  const featureSegments = splitClauses(intake.features);
  const usedSegments: { text: string; from: string }[] = featureSegments.map((text) => ({
    text,
    from: "features",
  }));

  if (usedSegments.length < MIN_CAPABILITIES) {
    for (const text of splitClauses(intake.technology)) {
      if (usedSegments.length >= MIN_CAPABILITIES) break;
      usedSegments.push({ text, from: "technology" });
    }
  }

  const capped = capSegments(
    usedSegments.map((segment) => segment.text),
    MAX_CAPABILITIES,
  );

  const capabilities: DecomposedCapability[] = capped.map((text, index) => ({
    id: `cap-${String(index + 1)}`,
    label: tidyLabel(text),
    derivedFrom:
      usedSegments.find((segment) => segment.text === text)?.from ??
      (featureSegments.includes(text) ? "features" : "features"),
    sourceText: text,
  }));

  const note =
    capabilities.length >= MIN_CAPABILITIES
      ? `Split from your own description into ${String(capabilities.length)} capabilities (no rewording by a model).`
      : `Only ${String(capabilities.length)} discrete capabilities could be read out of your description. We did not invent the rest — describe more of the workflow to get a finer breakdown.`;

  return {
    method: "founder-lines",
    note,
    capabilities,
    domainTerms: buildDomainTerms(intake),
  };
}

interface LlmDecomposition {
  capabilities?: { label?: string; detail?: string }[];
}

async function fromLlm(intake: Intake): Promise<Decomposition | null> {
  const result = await chatJson<LlmDecomposition>({
    timeoutMs: 25_000,
    maxTokens: 900,
    system:
      "You decompose a startup idea into discrete product capabilities for a prior-art search. " +
      "You must NOT invent capabilities. Only split and lightly rephrase mechanisms the founder explicitly described. " +
      "Return JSON: {\"capabilities\":[{\"label\":\"short verb phrase, max 12 words\",\"detail\":\"one sentence\"}]}. " +
      "Return between 4 and 8 capabilities. If the founder described fewer, return only what they described.",
    user: JSON.stringify({
      problem: intake.problem,
      customer: intake.customer,
      features: intake.features,
      technology: intake.technology,
      businessModel: intake.businessModel,
    }),
  });

  if (!result) return null;
  const items = (result.data.capabilities ?? [])
    .map((item) => (item.label ?? "").trim())
    .filter((label) => label.length > 2)
    .slice(0, MAX_CAPABILITIES);
  if (items.length === 0) return null;

  return {
    method: "llm",
    note: `Decomposed into ${String(items.length)} capabilities by ${result.model}, restricted to mechanisms you described.`,
    capabilities: items.map((label, index) => ({
      id: `cap-${String(index + 1)}`,
      label: truncate(label, 110),
      derivedFrom: "model (grounded in your description)",
      sourceText: label,
    })),
    domainTerms: buildDomainTerms(intake),
  };
}

export async function decompose(intake: Intake): Promise<Decomposition> {
  const llm = await fromLlm(intake);
  return llm ?? fromFounderText(intake);
}
