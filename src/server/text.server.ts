// Text helpers shared by query building and the lexical matcher.
// Deliberately simple and inspectable: no embeddings, no local models.

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","been","but","by","can","could","do","does","for","from","has","have","how","i","if","in","into","is","it","its","may","more","most","must","not","of","on","or","our","over","should","so","such","than","that","the","their","them","then","there","these","they","this","those","to","under","up","us","was","we","were","what","when","where","which","while","who","will","with","would","you","your",
]);

/**
 * Words that appear in almost every abstract. They never count as evidence of
 * overlap on their own — otherwise every capability "matches" a paper about
 * "a system for management of data".
 */
export const GENERIC_TERMS = new Set([
  "system","systems","method","methods","approach","approaches","model","models","data","process","processes","service","services","platform","platforms","software","tool","tools","application","applications","based","using","new","study","analysis","framework","solution","solutions","management","manager","managers","user","users","workflow","workflows","technology","technologies","report","reports","record","records","information","digital","online","mobile","web","support","supports","provide","provides","including","include","includes","other","also","each","per","via","across","within","without","between","during","after","before","based","related","existing","current","level","levels","type","types","time","times","way","ways","case","cases","number","numbers","high","low","large","small","first","second","third","one","two","three","four","five","six","seven","eight","nine","ten","example","examples","test","tests","testing","result","results","paper","article","review","author","authors","design","development","implementation","evaluation","research","practice","practices","activity","activities","quality","performance","value","values","need","needs","needed","make","makes","made","use","used","uses","get","gets","got","set","sets","setting","take","takes","taken","give","gives","given","know","known","find","finds","found","check","checks","checked","ensure","ensures","require","requires","required","request","requests","requested","update","updates","updated","track","tracks","tracked","manage","manages","managed","identify","identifies","identified","system's",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

/** Crude, predictable singularisation — enough to match "certifications" to "certification". */
export function normalizeTerm(term: string): string {
  if (term.length > 6 && term.endsWith("ing")) return term.slice(0, -3);
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith("ses")) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
}

export function termSet(text: string): Set<string> {
  return new Set(tokenize(text).map(normalizeTerm));
}

/** Content words (stopwords removed, normalised, deduped) in the order they appear. */
export function contentWords(text: string, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokenize(text)) {
    const term = normalizeTerm(raw);
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

/** Distinctive (non-generic) terms, in the order they appear. */
export function distinctiveTerms(text: string, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokenize(text)) {
    const term = normalizeTerm(raw);
    if (GENERIC_TERMS.has(term) || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build a search string: distinctive terms first, topped up with generic ones if very short. */
export function buildSearchQuery(text: string, extra: string[] = [], maxTerms = 10): string {
  const terms = distinctiveTerms(text, maxTerms);
  if (terms.length < 3) {
    for (const raw of tokenize(text)) {
      const term = normalizeTerm(raw);
      if (terms.includes(term)) continue;
      terms.push(term);
      if (terms.length >= 3) break;
    }
  }
  for (const term of extra) {
    const normalized = normalizeTerm(term.toLowerCase());
    if (!terms.includes(normalized)) terms.push(normalized);
    if (terms.length >= maxTerms) break;
  }
  return terms.slice(0, maxTerms).join(" ");
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/** Terms used for scoring a capability: distinctive first, topped up when the text is thin. */
export function scoringTerms(text: string, limit = 10): string[] {
  const distinctive = distinctiveTerms(text, limit);
  if (distinctive.length >= 3) return distinctive;
  const merged = [...distinctive];
  const seen = new Set(merged);
  for (const raw of tokenize(text)) {
    const term = normalizeTerm(raw);
    if (seen.has(term)) continue;
    seen.add(term);
    merged.push(term);
    if (merged.length >= 4) break;
  }
  return merged;
}
