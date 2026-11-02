import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Page } from "~/components/ui";
import { analyzeIdea, fetchRuntimeStatus, type RuntimeStatus } from "~/lib/api";
import { reportStorageKey } from "~/lib/client-store";
import { BLUECORE_EXAMPLE, type Intake } from "~/lib/types";

export const Route = createFileRoute("/analyze")({
  validateSearch: (search: Record<string, unknown>): { example?: boolean } => ({
    example: search.example === true || search.example === "1" || search.example === "true",
  }),
  head: () => ({
    meta: [
      { title: "Analyze an idea — Priorly" },
      {
        name: "description",
        content:
          "Describe your startup idea and get a source-backed report on the research, patents and companies that overlap it.",
      },
    ],
  }),
  component: AnalyzePage,
});

const EMPTY: Intake = {
  startupName: "",
  problem: "",
  customer: "",
  features: "",
  technology: "",
  businessModel: "",
};

function AnalyzePage() {
  const navigate = useNavigate();
  const { example } = Route.useSearch();
  const [form, setForm] = useState<Intake>(example ? BLUECORE_EXAMPLE : EMPTY);
  const [loadedExample, setLoadedExample] = useState(Boolean(example));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRuntimeStatus()
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (field: keyof Intake) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const loadExample = () => {
    setForm(BLUECORE_EXAMPLE);
    setLoadedExample(true);
    setError(null);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (running) return;
    setError(null);

    if (form.problem.trim().length < 20) {
      setError("Describe the problem in at least a sentence.");
      return;
    }
    if (form.features.trim().length < 20) {
      setError(
        "Describe the proposed features/mechanisms in at least a sentence — the report is built from this text.",
      );
      return;
    }

    setRunning(true);
    try {
      const result = await analyzeIdea({ data: form });
      if (!result.ok) {
        setError(result.error);
        setRunning(false);
        return;
      }
      try {
        window.sessionStorage.setItem(
          reportStorageKey(result.report.id),
          JSON.stringify(result.report),
        );
      } catch {
        // Storage full or blocked: the server copy is still there for the share link.
      }
      await navigate({ to: "/report/$id", params: { id: result.report.id } });
    } catch (caught) {
      setError(
        (caught as Error).message ||
          "The analysis request failed. Check your connection and try again.",
      );
      setRunning(false);
    }
  };

  return (
    <Page>
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="label-caps">Intake</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">
          Describe the idea you want checked
        </h1>
        <p className="mt-3 max-w-[64ch] text-[15px] text-muted">
          Write your features the way you would explain them to an engineer: what the product does,
          in what order, using what mechanism. The report is built from this text, so vague
          descriptions produce vague evidence.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={loadExample} className="btn btn-quiet">
            Load the BlueCore example
          </button>
          {loadedExample ? (
            <span className="text-xs text-muted">
              Example loaded — edit anything before running.
            </span>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <div>
            <label htmlFor="startupName" className="label-caps">
              Startup name <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="startupName"
              className="field mt-1.5"
              value={form.startupName}
              onChange={update("startupName")}
              placeholder="BlueCore"
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="problem" className="label-caps">
              Problem <span className="text-[#b06a34]">*</span>
            </label>
            <textarea
              id="problem"
              className="field mt-1.5 min-h-[110px]"
              value={form.problem}
              onChange={update("problem")}
              required
              minLength={20}
              placeholder="What breaks today, and how do people cope with it?"
            />
          </div>

          <div>
            <label htmlFor="customer" className="label-caps">
              Target customer
            </label>
            <textarea
              id="customer"
              className="field mt-1.5 min-h-[70px]"
              value={form.customer}
              onChange={update("customer")}
              placeholder="Who has this problem, and at what scale?"
            />
          </div>

          <div>
            <label htmlFor="features" className="label-caps">
              Proposed features / mechanisms <span className="text-[#b06a34]">*</span>
            </label>
            <textarea
              id="features"
              className="field mt-1.5 min-h-[150px]"
              value={form.features}
              onChange={update("features")}
              required
              minLength={20}
              placeholder={"One capability per line works best, for example:\n- Identifies an understaffed pool\n- Checks lifeguard certifications and availability\n- Requests manager approval"}
            />
            <p className="mt-1.5 text-xs text-muted">
              One mechanism per line (or one clause per sentence) gives the sharpest breakdown.
            </p>
          </div>

          <div>
            <label htmlFor="technology" className="label-caps">
              Underlying technology
            </label>
            <textarea
              id="technology"
              className="field mt-1.5 min-h-[70px]"
              value={form.technology}
              onChange={update("technology")}
              placeholder="Stack, data sources, and any mechanism you consider technical."
            />
          </div>

          <div>
            <label htmlFor="businessModel" className="label-caps">
              Business model
            </label>
            <textarea
              id="businessModel"
              className="field mt-1.5 min-h-[60px]"
              value={form.businessModel}
              onChange={update("businessModel")}
              placeholder="How it is sold and priced."
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="border border-[#d9b79a] bg-[#fbf0e4] px-4 py-3 text-sm text-[#8a4b1f]"
            >
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-4 border-t border-hairline pt-5">
            <button type="submit" className="btn btn-primary" disabled={running}>
              {running ? "Running analysis…" : "Run the analysis"}
            </button>
            <span className="text-xs text-muted">
              Usually 5–15 seconds. Nothing is published; the report gets a private link.
            </span>
          </div>
        </form>

        {running ? <RunningPanel /> : null}

        <SourceStatusPanel status={status} />

        <p className="mt-8 text-xs text-muted">
          Priorly is not legal advice and does not replace an attorney.{" "}
          <Link to="/" className="link">
            What this does and does not do
          </Link>
          .
        </p>
      </div>
    </Page>
  );
}

function RunningPanel() {
  return (
    <div className="mt-6 border border-hairline bg-white px-5 py-4" aria-live="polite">
      <p className="text-sm font-semibold">Working</p>
      <ol className="mt-2 space-y-1 text-sm text-muted">
        <li>1. Splitting your description into capabilities</li>
        <li>2. Searching each capability, and the whole workflow, against live sources</li>
        <li>3. Comparing what came back and writing the report</li>
      </ol>
      <p className="mt-2 text-xs text-muted">
        Keep this tab open. A failed search is recorded in the report rather than silently retried.
      </p>
    </div>
  );
}

function SourceStatusPanel({ status }: { status: RuntimeStatus | null }) {
  const rows: { label: string; on: boolean; off: string }[] = [
    { label: "Research (OpenAlex)", on: true, off: "" },
    {
      label: "Patent publications",
      on: Boolean(status?.patents),
      off: "not connected — the report will say no patent search was performed",
    },
    {
      label: "Competitor web search",
      on: Boolean(status?.competitors),
      off: "not connected — no company or product pages will be searched",
    },
    {
      label: "Claim-level comparison (LLM)",
      on: Boolean(status?.llm),
      off: "not connected — the report runs in retrieval-only mode",
    },
    {
      label: "Report storage",
      on: Boolean(status && status.storage === "mongodb"),
      off: "in-memory for this server process — share links work while it is running",
    },
  ];

  return (
    <div className="mt-8 border border-hairline bg-white px-5 py-4">
      <p className="label-caps">What is connected right now</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex flex-wrap items-baseline gap-x-2">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 ${row.on ? "bg-accent" : "bg-[#c9c6bd]"}`}
            />
            <span className="font-medium">{row.label}</span>
            <span className="text-muted">{row.on ? "connected" : row.off}</span>
          </li>
        ))}
      </ul>
      {status === null ? (
        <p className="mt-2 text-xs text-muted">Checking server capabilities…</p>
      ) : null}
    </div>
  );
}
