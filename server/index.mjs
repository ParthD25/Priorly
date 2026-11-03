import { createApp } from "./app.mjs";
import { assertSafeRuntime } from "./security-config.mjs";

const port = Number(process.env.PORT || 8080);
const { host } = assertSafeRuntime(process.env);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}
const server = createApp();
server.listen(port, host, () => {
  console.log("Priorly research API running at http://" + host + ":" + port);
});
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
