// Single entry point for every LLM call. OpenAI-compatible chat completions.
//
// No key is configured in this environment, so every caller must treat a null
// return as "degrade to the deterministic path and say so in the report".
// The key is read from process.env only — never from a file, never inlined.

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export function getLlmConfig(): LlmConfig | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function isLlmConfigured(): boolean {
  return getLlmConfig() !== null;
}

export interface LlmStatus {
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
}

export function llmStatus(): LlmStatus {
  const config = getLlmConfig();
  return config
    ? { configured: true, model: config.model, baseUrl: config.baseUrl }
    : { configured: false, model: null, baseUrl: null };
}

interface ChatArgs {
  system: string;
  user: string;
  /** Hard ceiling on how long we wait before giving up and degrading. */
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Ask the model for a JSON object. Returns null on any failure (no key, HTTP
 * error, timeout, unparseable output) so callers fall back instead of throwing.
 */
export async function chatJson<T>(args: ChatArgs): Promise<{ data: T; model: string } | null> {
  const config = getLlmConfig();
  if (!config) return null;

  const timeoutMs = args.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: args.temperature ?? 0,
        max_tokens: args.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[llm] HTTP ${String(response.status)} from chat completions`);
      return null;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = parseJsonObject(content);
    if (parsed === null) return null;
    return { data: parsed as T, model: config.model };
  } catch (error) {
    console.error(`[llm] request failed: ${(error as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Tolerates models that wrap JSON in prose or a code fence. */
function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch {
      // try next candidate
    }
  }
  return null;
}
