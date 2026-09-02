import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const environment = path.join(root, ".python-bg");
const python = process.env.BACKGROUND_REMOVAL_BOOTSTRAP_PYTHON || (process.platform === "win32" ? "py" : "python3");
const prefix = process.platform === "win32" && python === "py" ? ["-3"] : [];
const runtime = path.join(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!existsSync(runtime)) run(python, [...prefix, "-m", "venv", environment]);
run(runtime, ["-m", "pip", "install", "--upgrade", "pip"]);
run(runtime, ["-m", "pip", "install", "-r", path.join(root, "requirements-background-removal.txt")]);
console.log("Suppression d’arrière-plan installée. Le modèle sera téléchargé au premier traitement.");
