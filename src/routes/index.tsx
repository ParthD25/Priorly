import { Link, createFileRoute } from "@tanstack/react-router";

import { ClassificationBadge, Page } from "~/components/ui";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Priorly — what already exists around your startup idea" },
      {
        name: "description",
        content:
          "Priorly returns a source-backed report on the companies, patents and published research that overlap a startup idea — every finding with a link and a date, and a plain list of what was not checked.",
      },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    title: "Describe the idea",
    body: "Problem, target customer, proposed features, technology, business model. The features you describe are the unit of analysis, so write them concretely.",
  },
  {
    title: "It is split into capabilities",
    body: "Each discrete mechanism is analysed on its own, and the whole workflow is analysed once more as a single query — so an end-to-end competitor is not missed by splitting the idea up.",
  },
  {
    title: "Each capability is searched",
    body: "Published research through OpenAlex, patent publications through a pluggable patent connector, and competitor/product pages when a web-search source is connected.",
  },
  {
    title: "You get a report you can check",
    body: "One row per capability with a classification, the matched source behind it, why it matched, and a list of every source that was not searched.",
  },
];

const NOT_DOING = [
  "It is not legal advice, and it does not replace an attorney. Patentability, freedom to operate and ownership are separate legal questions.",
  "It does not produce claim charts or interpret claim scope.",
  "It does not give you a uniqueness score. One number would hide exactly the uncertainty you need to see.",
  "It does not fill a gap with a guess. If a source was not connected, the report says so on the page.",
];

function Landing() {
  return (
    <Page>
      <section className="mx-auto max-w-5xl px-5 pt-14 pb-10 sm:px-8 sm:pt-20">
        <p className="label-caps">Startup innovation &amp; IP due diligence</p>
        <h1 className="mt-3 max-w-[20ch] font-display text-4xl font-semibold text-ink sm:text-5xl">
          Find out what already exists before you build it.
        </h1>
        <p className="mt-5 max-w-[62ch] text-[17px] text-muted">
          Describe your startup idea. Priorly returns a source-backed report on the companies,
          patents and published research that overlap it: which capabilities are genuinely
          different, which ownership questions are open, and what evidence is still missing.
        </p>
        <p className="mt-3 max-w-[62ch] text-[15px] text-muted">
          Every finding carries a link to the source and the date it was published, and is labelled
          known overlap, potential differentiation or insufficient evidence.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/analyze" className="btn btn-primary no-underline">
            Analyze an idea
          </Link>
          <Link to="/analyze" search={{ example: true }} className="btn btn-quiet no-underline">
            Run the BlueCore example
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted">
          No account needed. The BlueCore example is a worked demo case: an aquatic-management
          product for pools and waterparks.
        </p>
      </section>

      <section className="border-y border-hairline bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
          <p className="label-caps">What the report looks like</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">One row per capability</h2>
          <div className="mt-5 overflow-x-auto border border-hairline">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#f6f5f1] text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th className="border-b border-hairline px-4 py-2 font-semibold">Capability</th>
                  <th className="border-b border-hairline px-4 py-2 font-semibold">
                    Classification
                  </th>
                  <th className="border-b border-hairline px-4 py-2 font-semibold">
                    Strongest matched source
                  </th>
                  <th className="border-b border-hairline px-4 py-2 font-semibold">Why it matched</th>
                </tr>
              </thead>
              <tbody className="text-[15px]">
                <tr className="align-top">
                  <td className="border-b border-hairline px-4 py-3">
                    Checks employee lifeguard certifications and availability
                  </td>
                  <td className="border-b border-hairline px-4 py-3">
                    <ClassificationBadge value="KNOWN_OVERLAP" />
                  </td>
                  <td className="border-b border-hairline px-4 py-3 text-muted">
                    source title, publisher, date — linked
                  </td>
                  <td className="border-b border-hairline px-4 py-3 text-muted">
                    the terms that matched, and where
                  </td>
                </tr>
                <tr className="align-top">
                  <td className="border-b border-hairline px-4 py-3">
                    Finds a qualified replacement and requests manager approval
                  </td>
                  <td className="border-b border-hairline px-4 py-3">
                    <ClassificationBadge value="POTENTIAL_DIFFERENTIATION" />
                  </td>
                  <td className="border-b border-hairline px-4 py-3 text-muted">
                    related work, not the same mechanism
                  </td>
                  <td className="border-b border-hairline px-4 py-3 text-muted">
                    what differs, in plain English
                  </td>
                </tr>
                <tr className="align-top">
                  <td className="px-4 py-3">Records compliance evidence</td>
                  <td className="px-4 py-3">
                    <ClassificationBadge value="INSUFFICIENT_EVIDENCE" />
                  </td>
                  <td className="px-4 py-3 text-muted">nothing strong enough to say</td>
                  <td className="px-4 py-3 text-muted">stated as unknown, not as clear</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-[75ch] text-xs text-muted">
            Illustrative layout only — these three rows are not findings from a real report and
            carry no sources. In a generated report every row links to the source it was compared
            against, and the report also lists what was not searched.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <p className="label-caps">How it works</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">Four steps, all inspectable</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="border-l-2 border-accent/30 pl-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                Step {index + 1}
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold">{step.title}</h3>
              <p className="mt-1 max-w-[52ch] text-[15px] text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-hairline bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
          <div className="grid gap-8 sm:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="label-caps">Boundaries</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">What Priorly is not</h2>
              <p className="mt-2 max-w-[46ch] text-[15px] text-muted">
                The product is built to make a qualified legal review easier, not to stand in for
                one. It is deliberately narrow about what it claims.
              </p>
            </div>
            <ul className="space-y-3 text-[15px]">
              {NOT_DOING.map((item) => (
                <li key={item} className="flex gap-3 border-b border-hairline pb-3 last:border-0">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 bg-ink/40" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-14 sm:px-8">
        <div className="border border-hairline bg-white p-6 sm:p-8">
          <h2 className="font-display text-2xl font-semibold">
            Start with the worked example, then run your own
          </h2>
          <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
            The BlueCore demo case is a lifeguard-certification and shift-replacement workflow for
            pools and waterparks. Loading it fills the form; you can edit anything before running
            the analysis.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/analyze" search={{ example: true }} className="btn btn-primary no-underline">
              Load the BlueCore example
            </Link>
            <Link to="/analyze" className="btn btn-quiet no-underline">
              Start from a blank form
            </Link>
          </div>
        </div>
      </section>
    </Page>
  );
}
