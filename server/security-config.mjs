export function assertSafeRuntime(env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Priorly's local SQLite account server is NOT approved for production. Provision managed identity/database and complete the security release gate.");
  }
  const host = env.HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Priorly's developer server must bind to loopback only. Remote hosting requires a production auth and persistence implementation.");
  }
  return { host };
}
