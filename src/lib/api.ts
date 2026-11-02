// Client-callable server functions. The heavy modules are imported inside the
// handlers so nothing server-only (MongoDB driver, fs, secrets) can reach the
// browser bundle.
import { createServerFn } from "@tanstack/react-start";

import type { AnalysisReport, Intake } from "./types";

export type AnalyzeResult =
  | { ok: true; report: AnalysisReport }
  | { ok: false; error: string };

export const analyzeIdea = createServerFn({ method: "POST" })
  .validator((data: Intake) => data)
  .handler(async ({ data }): Promise<AnalyzeResult> => {
    try {
      const { runAnalysis } = await import("../server/analyze.server");
      const report = await runAnalysis(data);
      return { ok: true, report };
    } catch (error) {
      const message = (error as Error).message || "The analysis failed.";
      console.error(`[analyze] ${message}`);
      return { ok: false, error: message };
    }
  });

export const fetchReport = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<AnalysisReport | null> => {
    const { getReport } = await import("../server/store.server");
    return getReport(data.id);
  });

export interface RuntimeStatus {
  llm: boolean;
  patents: boolean;
  competitors: boolean;
  storage: "memory" | "mongodb";
}

export const fetchRuntimeStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<RuntimeStatus> => {
    const { isLlmConfigured } = await import("../server/llm.server");
    const { patentConnector } = await import("../server/patents.server");
    const { isWebSearchConnected } = await import("../server/websearch.server");
    const { mongoConfigured } = await import("../server/store.server");
    return {
      llm: isLlmConfigured(),
      patents: patentConnector.isConnected(),
      competitors: isWebSearchConnected(),
      storage: mongoConfigured() ? "mongodb" : "memory",
    };
  },
);
