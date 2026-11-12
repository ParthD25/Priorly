import { Link, createFileRoute } from "@tanstack/react-router";

import { Page } from "~/components/ui";

export const Route = createFileRoute("/data")({
  head: () => ({
    meta: [
      { title: "Where your data goes — Priorly" },
      {
        name: "description",
        content:
          "Plainly, what Priorly's preview build stores, where it is stored, who can see it, and what we do not claim.",
      },
    ],
  }),
  component: DataPage,
});

function Row({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hairline py-6">
      <h2 className="font-display text-xl font-semibold">{question}</h2>
      <div className="mt-2 max-w-[68ch] space-y-3 text-[15px] leading-relaxed text-muted">
        {children}
      </div>
    </div>
  );
}

function DataPage() {
  return (
    <Page>
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="label-caps">Data &amp; confidentiality</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">Where your data goes</h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-muted">
          Written for someone deciding whether to type a client&rsquo;s idea into this page. It
          describes <strong className="font-semibold text-ink">this preview build</strong> as it
          actually behaves today, not the production app we are building.
        </p>

        <div className="mt-8">
          <Row question="What is stored when you run an analysis">
            <p>
              The text you type into the form — the problem, the target customer, the proposed
              features and mechanisms, the technology and the business model — together with the
              report generated from it and the sources that were retrieved.
            </p>
            <p>
              The report is kept as a whole, and also broken into rows: one per capability, one per
              source, one per link between a capability and a source, plus a record of which
              searches were actually run and which sources were not connected.
            </p>
          </Row>

          <Row question="Where it is stored">
            <p>
              In a Postgres database hosted by Supabase, in tables prefixed <code>priorly_</code>.
              The application reaches it from the server, never from your browser.
            </p>
            <p>
              Supabase&rsquo;s platform protections apply to that database. We have not
              independently audited them, and this page does not claim we have.
            </p>
          </Row>

          <Row question="Who can see it">
            <p>
              <strong className="font-semibold text-ink">
                Anyone who has the report link.
              </strong>{" "}
              This preview build has no accounts, so it has no per-user lock: the report page is
              reachable by its address, and the address is the only thing protecting it. A link
              shared by accident is a report shared.
            </p>
            <p>
              Internally, the team that runs this site can read the database directly. That is a
              small team, but it is not zero people.
            </p>
          </Row>

          <Row question="What we do not do">
            <p>
              We do not use what you submit to train models. There is no model in this build doing
              the comparison — the analysis is term matching over retrieved titles and abstracts,
              and the report says so on its face.
            </p>
            <p>
              We do not sell it, and we do not send it anywhere except the source databases we
              search (OpenAlex), which receive search terms, not your document.
            </p>
          </Row>

          <Row question="How it is deleted">
            <p>
              It is not deleted automatically — there is no expiry. Ask us and we will delete the
              report and its rows; the request needs no justification.
            </p>
          </Row>

          <Row question="What this page does not claim">
            <p>
              It does not claim encryption guarantees, retention policies, audit certification or a
              confidentiality undertaking. None of those exist in this build yet. The production app
              is being built to a law-firm standard, and when it is, this page will describe that
              build instead — with the same rule: only what we can point at.
            </p>
            <p className="text-ink">
              Until then: do not put confidential client material into this preview.
            </p>
          </Row>
        </div>

        <p className="mt-10 text-sm">
          <Link to="/" className="link">
            Back to the overview
          </Link>
          <span className="px-2 text-muted">·</span>
          <Link to="/analyze" className="link">
            Run an analysis
          </Link>
        </p>
      </div>
    </Page>
  );
}
