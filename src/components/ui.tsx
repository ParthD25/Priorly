import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Classification, SourceType } from "~/lib/types";

export function SiteHeader() {
  return (
    <header className="border-b border-hairline bg-paper/95">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-baseline gap-2 no-underline">
          <span className="font-display text-xl font-semibold tracking-tight text-ink">Priorly</span>
          <span className="hidden text-xs text-muted sm:inline">
            innovation &amp; IP due diligence
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link to="/" className="text-muted no-underline hover:text-ink">
            Home
          </Link>
          <Link
            to="/analyze"
            className="border border-ink px-3 py-1.5 font-medium text-ink no-underline hover:bg-ink hover:text-paper"
          >
            Analyze an idea
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-hairline bg-white">
      <div className="mx-auto max-w-5xl px-5 py-8 text-sm text-muted sm:px-8">
        <p className="max-w-[70ch]">
          Priorly produces a source-backed research summary. It is <strong>not legal advice</strong>{" "}
          and does not replace an attorney. Patentability, freedom to operate and ownership are
          separate legal questions that require qualified legal review.
        </p>
        <p className="mt-3 max-w-[70ch] text-xs">
          Every finding links to the source it came from. When a source could not be searched, the
          report says so instead of filling the gap.
        </p>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

const CLASSIFICATION_STYLE: Record<Classification, string> = {
  KNOWN_OVERLAP: "border-[#d9b79a] bg-[#fbf0e4] text-[#8a4b1f]",
  POTENTIAL_DIFFERENTIATION: "border-[#a9cfc9] bg-[#e8f2f0] text-[#0f5f5c]",
  INSUFFICIENT_EVIDENCE: "border-[#d6d3ca] bg-[#f3f2ed] text-[#4f555e]",
};

const CLASSIFICATION_TEXT: Record<Classification, string> = {
  KNOWN_OVERLAP: "Known overlap",
  POTENTIAL_DIFFERENTIATION: "Potential differentiation",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

export function ClassificationBadge({ value }: { value: Classification }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${CLASSIFICATION_STYLE[value]}`}
    >
      {CLASSIFICATION_TEXT[value]}
    </span>
  );
}

export const CLASSIFICATION_DOT: Record<Classification, string> = {
  KNOWN_OVERLAP: "bg-[#b06a34]",
  POTENTIAL_DIFFERENTIATION: "bg-[#0f5f5c]",
  INSUFFICIENT_EVIDENCE: "bg-[#8b8f97]",
};

const SOURCE_LABEL: Record<SourceType, string> = {
  research: "Research",
  patent: "Patent",
  competitor: "Product",
};

export function SourceTypeTag({ type }: { type: SourceType }) {
  return (
    <span className="inline-block border border-hairline bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
      {SOURCE_LABEL[type]}
    </span>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {eyebrow ? <p className="label-caps mb-1">{eyebrow}</p> : null}
      <h2 id={id} className="font-display text-2xl font-semibold text-ink sm:text-[26px]">
        {title}
      </h2>
      {children ? <div className="mt-2 max-w-[70ch] text-[15px] text-muted">{children}</div> : null}
    </div>
  );
}
