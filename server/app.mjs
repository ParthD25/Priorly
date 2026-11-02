import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { researchIdea, InputError } from "./research.mjs";

const FILES = new Map([
  ["/", ["../index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["../index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["../app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["../styles.css", "text/css; charset=utf-8"]]
]);
const LIMIT = 12 * 1024;
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

function send(res, code, data, extra = {}) {
  res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > LIMIT) {
      const e = new Error("Request body too large.");
      e.statusCode = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const e = new Error("Request must be valid JSON.");
    e.statusCode = 400;
    throw e;
  }
}

export function createApp({
  service = researchIdea,
  clock = () => Date.now(),
  maxRequests = 20,
  windowMs = 15 * 60 * 1000
} = {}) {
  const buckets = new Map();
  return createServer(async (req, res) => {
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;

      if (pathname === "/api/v1/health" && req.method === "GET") {
        return send(res, 200, { status: "ok", version: "0.2.0" });
      }
      if (pathname === "/api/v1/research") {
        if (req.method !== "POST") return send(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, { Allow: "POST" });
        if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          return send(res, 415, { error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Use application/json." } });
        }
        const origin = req.headers.origin;
        if (origin) {
          let matches = false;
          try { matches = new URL(origin).host === req.headers.host; } catch {}
          if (!matches) return send(res, 403, { error: { code: "ORIGIN_DENIED", message: "Cross-site requests are not permitted." } });
        }
        const key = req.socket.remoteAddress || "unknown";
        const current = clock();
        const window = buckets.get(key);
        if (!window || current >= window.resetAt) buckets.set(key, { count: 1, resetAt: current + windowMs });
        else {
          window.count += 1;
          if (window.count > maxRequests) {
            return send(res, 429, { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } }, { "Retry-After": String(Math.max(1, Math.ceil((window.resetAt - current) / 1000))) });
          }
        }
        const body = await readBody(req);
        const result = await service(body);
        return send(res, 200, result);
      }
      if (req.method === "GET" && FILES.has(pathname)) {
        const [file, mime] = FILES.get(pathname);
        const bytes = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": mime });
        return res.end(bytes);
      }
      return send(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
    } catch (error) {
      if (error instanceof InputError) return send(res, 400, { error: { code: "INVALID_IDEA", message: error.message } });
      if (error?.statusCode === 400 || error?.statusCode === 413) {
        return send(res, error.statusCode, { error: { code: error.statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", message: error.message } });
      }
      // Do not leak internals, requests, environment variables or upstream bodies.
      console.error("Request failed:", id, error instanceof Error ? error.name : "UnknownError");
      return send(res, 500, { error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred.", requestId: id } });
    }
  });
}
