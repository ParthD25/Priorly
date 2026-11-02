import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  CLASSIFICATION_DOT,
  ClassificationBadge,
  Page,
  SectionHeading,
  SourceTypeTag,
} from "~/components/ui";
import { fetchReport } from "~/lib/api";
import { readStoredReport } from "~/lib/client-store";
import type { AnalysisReport, CapabilityFinding, EvidenceSource } from "~/lib/types";

export const Route = createFileRoute("/report/$id")({
  loader: async ({ params }) => {
    const report = await fetchReport({ data: { id: params.id } });
    return { report };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.report?.intake.startupName
          ? `${loaderData.report.intake.startupName} — Priorly report`
          : "Priorly report",
      },
    ],
  }),
  component: ReportPage,
});

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function ReportPage() {
  const { id } = Route.useParams();
  const { report: loaded } = Route.useLoaderData();
  const [fallback, setFallback] = useState<AnalysisReport | null>(null);

  useEffect(() => {
    if (!loaded) setFallback(readStoredReport(id));
  }, [id, loaded]);

  const report = loaded ?? fallback;

  if (!report) {
    return (
      <Page>
        <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8">
          <p className="label-caps">Report not found</p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            This report is no longer available
          </h1>
          <p className="mt-3 text-[15px] text-muted">
            Reports are kept in this server&apos;s memory for a few hours, and this link has either
            expired or never existed. No database is connected yet, so links are not permanent.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/analyze" className="btn btn-primary no-underline">
              Run a new analysis
            </Link>
            <Link to="/" className="btn btn-quiet no-underline">
              Back to the start
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  return <ReportBody report={report} />;
}

function ReportBody({ report }: { report: AnalysisReport }) {
  const sourceByKey = useMemo(() => {
    const map = new Map<string, EvidenceSource>();
    for (const source of report.sources) map.set(source.key, source);
    return map;
  }, [report.sources]);

  const findings = [...report.capabilities, report.workflow];
  const startup = report.intake.startupName.trim();

  return (
    <Page>
      <article className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <header>
          <p className="label-caps">Innovation &amp; IP evidence report</p>
          <h1 className="mt-2 font-display text-3xl font-semibold sm:text-[40px]">
            {startup || "Untitled idea"}
          </h1>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted">Report</dt>
              <dd className="font-mono text-[13px]">{report.id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Generated</dt>
              <dd>{formatTimestamp(report.createdAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Capabilities analysed</dt>
              <dd>{report.counts.capabilities}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Sources retrieved</dt>
              <dd>{report.counts.sources}</dd>
            </div>
          </dl>
        </header>

        <ModeBanner report={report} />
        <ShareBox id={report.id} />
        <Scoreboard report={report} />

        <section className="mt-12">
          <SectionHeading
            eyebrow="Feature matrix"
            title="Capability by capability"
            id="matrix"
          >
            Each row is one capability taken from your description. The classification is about the
            evidence we actually retrieved — it is not a legal conclusion.
          </SectionHeading>

          <div className="overflow-x-auto border border-hairline bg-white">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Capability, classification, strongest matched source and why it matched
              </caption>
              <thead>
                <tr className="bg-[#f6f5f1] text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="border-b border-hairline px-4 py-2 font-semibold">
                    Capability
                  </th>
                  <th scope="col" className="border-b border-hairline px-4 py-2 font-semibold">
                    Classification
                  </th>
                  <th scope="col" className="border-b border-hairline px-4 py-2 font-semibold">
                    Strongest matched source
                  </th>
                  <th scope="col" className="border-b border-hairline px-4 py-2 font-semibold">
                    Why it matched
                  </th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => {
                  const top = finding.matches[0];
                  const source = top ? sourceByKey.get(top.sourceKey) : undefined;
                  return (
                    <tr key={finding.id} className="border-b border-hairline align-top last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium">{finding.label}</span>
                        {finding.kind === "workflow" ? (
                          <span className="ml-2 align-middle text-[10px] uppercase tracking-[0.1em] text-muted">
                            composite
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <ClassificationBadge value={finding.classification} />
                      </td>
                      <td className="px-4 py-3">
                        {source ? (
                          <div>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="link"
                            >
                              {source.title}
                            </a>
                            <div className="mt-1 text-xs text-muted">
                              {source.publisher ?? "publisher not listed"} · {source.dateLabel}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted">No source strong enough to attach</span>
                        )}
                      </td>
                      <td className="max-w-[34ch] px-4 py-3 text-[13px] text-muted">
                        {top ? top.rationale : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading eyebrow="Verdicts" title="What each capability came back as">
            The reasoning behind every row, including the ones we could not answer.
          </SectionHeading>
          <div className="space-y-4">
            {findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} sourceByKey={sourceByKey} />
            ))}
          </div>
        </section>

        <SourcesSection report={report} />
        <NotCheckedSection report={report} />
        <IpSection report={report} />
        <NextExperimentsSection report={report} />
        <QueryLogSection report={report} />

        <section className="mt-12 border-t border-hairline pt-6 text-sm text-muted">
          <p className="max-w-[75ch]">
            Priorly is a research aid. This report is not legal advice, is not a patentability
            opinion, and is not a freedom-to-operate analysis. Nothing in it should be relied on
            without reading the linked sources and, where it matters commercially, taking advice
            from a qualified attorney.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/analyze" className="btn btn-quiet no-underline">
              Analyze another idea
            </Link>
            <Link to="/" className="btn btn-quiet no-underline">
              What Priorly does
            </Link>
          </div>
        </section>
      </article>
    </Page>
  );
}

function ModeBanner({ report }: { report: AnalysisReport }) {
  const retrievalOnly = report.mode === "retrieval-only";
  const llmConnector = report.connectors.find((connector) => connector.id === "llm");
  return (
    <div
      className={`mt-6 border px-5 py-4 ${
        retrievalOnly ? "border-[#d9b79a] bg-[#fbf0e4]" : "border-[#a9cfc9] bg-[#e8f2f0]"
      }`}
    >
      <p className="text-sm font-semibold">
        {retrievalOnly
          ? "Retrieval-only mode — claim-level comparison not yet connected."
          : "Model-assisted comparison — quoted passages verified against the retrieved text."}
      </p>
      <p className="mt-1 max-w-[80ch] text-[13px]">
        {retrievalOnly
          ? "No model key is configured, so each capability was compared to the retrieved sources by term overlap over titles and abstracts. That is weaker evidence than a passage-level reading: a strong match can be understated and a weak one overstated. Read the linked sources before acting on any row."
          : (llmConnector?.detail ??
            "A model compared each capability against the retrieved sources and quoted the supporting passage.")}
      </p>
      <p className="mt-2 text-[12px] text-muted">
        Decomposition: {report.decomposition.method === "llm" ? "model-assisted" : "your own wording, split into clauses"} ·{" "}
        {report.decomposition.note} · Storage:{" "}
        {report.storage === "mongodb" ? "MongoDB" : "this server's memory"} · Took{" "}
        {(report.durationMs / 1000).toFixed(1)}s.
      </p>
    </div>
  );
}

function ShareBox({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/report/${id}`);
  }, [id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2 border border-hairline bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="label-caps">Share link</p>
        <p className="truncate font-mono text-[13px] text-muted">{url || "…"}</p>
      </div>
      <button type="button" onClick={copy} className="btn btn-quiet shrink-0">
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function Scoreboard({ report }: { report: AnalysisReport }) {
  const items = [
    { key: "KNOWN_OVERLAP" as const, count: report.counts.knownOverlap },
    { key: "POTENTIAL_DIFFERENTIATION" as const, count: report.counts.potentialDifferentiation },
    { key: "INSUFFICIENT_EVIDENCE" as const, count: report.counts.insufficientEvidence },
  ];
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.key} className="border border-hairline bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className={`h-2 w-2 ${CLASSIFICATION_DOT[item.key]}`} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {item.key.replaceAll("_", " ").toLowerCase()}
            </span>
          </div>
          <p className="mt-1 font-display text-2xl font-semibold">{item.count}</p>
        </div>
      ))}
    </div>
  );
}

function FindingCard({
  finding,
  sourceByKey,
}: {
  finding: CapabilityFinding;
  sourceByKey: Map<string, EvidenceSource>;
}) {
  return (
    <div className="border border-hairline bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">
          {finding.label}
          {finding.kind === "workflow" ? (
            <span className="ml-2 align-middle text-[10px] uppercase tracking-[0.1em] text-muted">
              whole workflow
            </span>
          ) : null}
        </h3>
        <ClassificationBadge value={finding.classification} />
      </div>
      <p className="mt-2 max-w-[80ch] text-[15px]">{finding.summary}</p>
      <p className="mt-2 text-xs text-muted">
        Search: <span className="font-mono">{finding.query}</span> · {finding.candidateCount}{" "}
        candidate source{finding.candidateCount === 1 ? "" : "s"} · {finding.coverageNote}
      </p>

      {finding.matches.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-hairline pt-3">
          {finding.matches.map((match) => {
            const source = sourceByKey.get(match.sourceKey);
            return (
              <li key={`${finding.id}-${match.sourceKey}`} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {source ? <SourceTypeTag type={source.type} /> : null}
                  {source ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="link font-medium"
                    >
                      {source.title}
                    </a>
                  ) : (
                    <span className="font-medium">Source not in this report</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {source?.publisher ?? "publisher not listed"} · {source?.dateLabel ?? "date not listed"} ·{" "}
                  {match.rationale}
                </p>
                {match.quote ? (
                  <blockquote className="mt-1 border-l-2 border-accent/40 pl-3 text-[13px] italic text-ink/80">
                    “{match.quote}”
                  </blockquote>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 border-t border-hairline pt-3 text-sm text-muted">
          No source was attached to this capability.
        </p>
      )}
    </div>
  );
}

function SourcesSection({ report }: { report: AnalysisReport }) {
  const grouped: Record<string, EvidenceSource[]> = { research: [], patent: [], competitor: [] };
  for (const source of report.sources) grouped[source.type].push(source);

  return (
    <section className="mt-12">
      <SectionHeading eyebrow="Sources" title="Everything that was retrieved">
        Only sources returned by a live query appear here. Links open the publisher&apos;s page; if a
        link is broken, that is the publisher&apos;s URL, not a rewritten one.
      </SectionHeading>

      {report.sources.length === 0 ? (
        <p className="border border-hairline bg-white px-4 py-3 text-sm text-muted">
          No sources were retrieved in this run.
        </p>
      ) : null}

      <div className="space-y-6">
        {(["research", "patent", "competitor"] as const).map((type) => {
          const list = grouped[type];
          if (list.length === 0) return null;
          return (
            <div key={type}>
              <div className="flex items-center gap-2">
                <SourceTypeTag type={type} />
                <span className="text-xs text-muted">
                  {list.length} source{list.length === 1 ? "" : "s"}
                </span>
              </div>
              <ol className="mt-2 space-y-2">
                {list.map((source) => (
                  <li key={source.key} className="border border-hairline bg-white px-4 py-3">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="link font-medium"
                    >
                      {source.title}
                    </a>
                    <p className="mt-1 text-xs text-muted">
                      {source.publisher ?? "publisher not listed"} · {source.dateLabel}
                      {source.meta.length > 0
                        ? ` · ${source.meta.map((entry) => `${entry.label}: ${entry.value}`).join(" · ")}`
                        : ""}
                    </p>
                    {source.excerpt ? (
                      <p className="mt-1 max-w-[80ch] text-[13px] text-muted">{source.excerpt}</p>
                    ) : (
                      <p className="mt-1 text-[13px] text-muted">
                        No abstract was returned for this record.
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NotCheckedSection({ report }: { report: AnalysisReport }) {
  return (
    <section className="mt-12">
      <SectionHeading eyebrow="Honesty" title="What we did not check">
        Everything below is missing from this report. Read it before you read the classifications.
      </SectionHeading>
      <ul className="space-y-2">
        {report.notChecked.map((item) => (
          <li key={item} className="flex gap-3 border-b border-hairline pb-2 text-[15px]">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 bg-[#b06a34]" />
            <span className="max-w-[80ch]">{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 border border-hairline bg-white px-5 py-4">
        <p className="label-caps">Source connections in this run</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {report.connectors.map((connector) => (
            <li key={connector.id} className="flex flex-wrap items-baseline gap-x-2">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 ${connector.connected ? "bg-accent" : "bg-[#c9c6bd]"}`}
              />
              <span className="font-medium">{connector.label}</span>
              <span className="text-muted">
                {connector.connected ? "connected" : "not connected"} — {connector.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 border border-hairline bg-white px-5 py-4">
        <p className="label-caps">Known limits of this method</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {report.limitations.map((item) => (
            <li key={item} className="max-w-[85ch]">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function IpSection({ report }: { report: AnalysisReport }) {
  return (
    <section className="mt-12">
      <SectionHeading eyebrow="IP &amp; ownership" title="Documents a founder should gather">
        Priorly does not judge ownership. It lists the documents that answer the ownership
        questions, so a lawyer can answer them faster.
      </SectionHeading>

      <div className="mb-4 border border-[#d9b79a] bg-[#fbf0e4] px-4 py-3 text-sm text-[#8a4b1f]">
        Ownership and inventorship questions require qualified legal review. This section is a
        checklist, not an opinion.
      </div>

      <ol className="space-y-3">
        {report.ipDocuments.map((document, index) => (
          <li key={document.title} className="border border-hairline bg-white px-4 py-3">
            <p className="text-[15px] font-medium">
              {index + 1}. {document.title}
            </p>
            <p className="mt-1 max-w-[80ch] text-[13px] text-muted">{document.why}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NextExperimentsSection({ report }: { report: AnalysisReport }) {
  return (
    <section className="mt-12">
      <SectionHeading eyebrow="Next" title="Recommended next experiments">
        Derived from the gaps in this report, not from a generic playbook.
      </SectionHeading>
      <ol className="space-y-2">
        {report.nextExperiments.map((experiment, index) => (
          <li key={experiment} className="flex gap-3 border-b border-hairline pb-2 text-[15px]">
            <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</span>
            <span className="max-w-[80ch]">{experiment}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function QueryLogSection({ report }: { report: AnalysisReport }) {
  return (
    <section className="mt-12">
      <SectionHeading eyebrow="Audit" title="Every search that ran">
        The exact queries sent to each provider, and what came back. Failed and unconnected searches
        are listed here too.
      </SectionHeading>
      <div className="overflow-x-auto border border-hairline bg-white">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="bg-[#f6f5f1] text-[11px] uppercase tracking-[0.1em] text-muted">
              <th scope="col" className="border-b border-hairline px-3 py-2 font-semibold">
                Query
              </th>
              <th scope="col" className="border-b border-hairline px-3 py-2 font-semibold">
                Provider
              </th>
              <th scope="col" className="border-b border-hairline px-3 py-2 font-semibold">
                Results
              </th>
              <th scope="col" className="border-b border-hairline px-3 py-2 font-semibold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {report.queryLog.map((entry, index) => (
              <tr key={`${entry.provider}-${entry.query}-${String(index)}`} className="border-b border-hairline last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{entry.query}</td>
                <td className="px-3 py-2">{entry.provider}</td>
                <td className="px-3 py-2">{entry.results}</td>
                <td className="px-3 py-2">
                  <span className={entry.status === "error" ? "text-[#8a4b1f]" : "text-muted"}>
                    {entry.status}
                    {entry.note ? ` — ${entry.note}` : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
