import { spawn } from "node:child_process";
import path from "node:path";

export function startRestartSupervisor() {
  const root = process.cwd();
  const windowsDrive = path.parse(process.execPath).root;
  const scriptHost = path.join(windowsDrive, "Windows", "System32", "wscript.exe");
  const scriptPath = path.join(root, "reiniciar-vuela.vbs");
  const mode = process.argv.includes("dev") ? "dev" : "start";
  const supervisor = spawn(scriptHost, [scriptPath, process.execPath, mode], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  return new Promise<void>((resolve, reject) => {
    supervisor.once("error", reject);
    supervisor.once("spawn", () => { supervisor.unref(); resolve(); });
  });
}
