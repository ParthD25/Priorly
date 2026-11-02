// Browser-side copy of the most recent report, so a visitor who just ran an
// analysis still sees it if the in-memory server store has been cleared.
import type { AnalysisReport } from "./types";

export function reportStorageKey(id: string): string {
  return `priorly.report.${id}`;
}

export function readStoredReport(id: string): AnalysisReport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(reportStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisReport;
    return parsed && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}
