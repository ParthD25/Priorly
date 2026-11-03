import { createApp } from "./app.mjs";
import { assertSafeRuntime } from "./security-config.mjs";
import { createSupabaseStore } from "./supabase-store.mjs";

const port = Number(process.env.PORT || 8080);
const { host } = assertSafeRuntime(process.env);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}
const backend=process.env.PRIORLY_BACKEND||"sqlite";
if(!["sqlite","supabase"].includes(backend))throw new Error("Unknown PRIORLY_BACKEND.");
const store=backend==="supabase"?createSupabaseStore():undefined;
const server = store?createApp({store}):createApp();
server.listen(port, host, () => {
  console.log("Priorly research API running at http://" + host + ":" + port);
});
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
