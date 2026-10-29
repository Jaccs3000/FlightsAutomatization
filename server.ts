import { createServer } from "node:http";
import next from "next";
import { initializeDatabase } from "./src/lib/db";
import { startScheduler } from "./src/lib/scheduler";
import { autoUnlockRememberedVault } from "./src/lib/vault";

const dev = process.argv.includes("dev");
const app = next({ dev, hostname: "127.0.0.1", port: 3030 });
const handle = app.getRequestHandler();

await initializeDatabase();
await app.prepare();
const rememberedVault = await autoUnlockRememberedVault();
if (rememberedVault.remembered && !rememberedVault.unlocked) console.warn("No se pudo desbloquear la boveda con la clave recordada; la app iniciara bloqueada.");
await startScheduler();

const server = createServer((request, response) => { void handle(request, response); });
server.listen(3030, "127.0.0.1", () => {
  console.log("Vuela esta disponible en http://127.0.0.1:3030");
  console.log("Deja esta ventana/proceso abierto para conservar las ejecuciones programadas.");
});

function shutdown() { server.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
