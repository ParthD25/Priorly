import { createApp } from "./app.mjs";

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";
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
