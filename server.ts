import { createServer } from "node:http";
import next from "next";
import { initializeDatabase } from "./src/lib/db";
import { startScheduler } from "./src/lib/scheduler";

const dev = process.argv.includes("dev");
const app = next({ dev, hostname: "127.0.0.1", port: 3030 });
const handle = app.getRequestHandler();

await initializeDatabase();
await app.prepare();
await startScheduler();

const server = createServer((request, response) => { void handle(request, response); });
server.listen(3030, "127.0.0.1", () => {
  console.log("Vuela esta disponible en http://127.0.0.1:3030");
  console.log("Deja esta ventana/proceso abierto para conservar las ejecuciones programadas.");
});

function shutdown() { server.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
