import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Priorly — startup innovation & IP due diligence" },
      {
        name: "description",
        content:
          "Describe a startup idea and get a source-backed report on the research, patents and companies that overlap it — with a link and a date for every finding.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <p className="label-caps">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">
        That page does not exist. Start from the{" "}
        <a className="link" href="/">
          landing page
        </a>{" "}
        or{" "}
        <a className="link" href="/analyze">
          run an analysis
        </a>
        .
      </p>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div
          role="note"
          className="border-b border-[#d9c9a8] bg-[#f6efe0] px-5 py-2 text-center text-[13px] text-[#6b5424] sm:px-8"
        >
          <strong className="font-semibold">Preview build.</strong> Priorly&rsquo;s production app
          is still in development. This demo runs a real search and returns real, cited sources, but
          it is a prototype &mdash; please don&rsquo;t paste confidential or client material into it.{" "}
          <a href="/data" className="underline underline-offset-2 hover:no-underline">
            Where your data goes
          </a>
        </div>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
