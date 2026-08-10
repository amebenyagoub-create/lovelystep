import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

async function existingPython(): Promise<string> {
  const configured = process.env.BACKGROUND_REMOVAL_PYTHON?.trim();
  const localPython = path.join(
    process.cwd(),
    ".python-bg",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const candidates = [configured, localPython].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next configured runtime.
    }
  }

  throw new Error(
    "La suppression d’arrière-plan n’est pas installée. Exécutez « npm run background:setup », puis relancez le serveur.",
  );
}

function runBackgroundRemoval(python: string, manifestPath: string, modelDirectory: string): Promise<void> {
  const script = path.join(process.cwd(), "scripts", "remove-background.py");
  const model = process.env.BACKGROUND_REMOVAL_MODEL?.trim() || "birefnet-general-lite";

  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, "--manifest", manifestPath, "--model", model], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        U2NET_HOME: modelDirectory,
        OMP_NUM_THREADS: process.env.BACKGROUND_REMOVAL_THREADS || "4",
        PYTHONUNBUFFERED: "1",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("La suppression d’arrière-plan a dépassé 5 minutes."));
    }, PROCESS_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Impossible de démarrer la suppression d’arrière-plan : ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "La suppression d’arrière-plan a échoué."));
    });
  });
}

export async function removeImageBackgrounds(images: Buffer[]): Promise<Buffer[]> {
  if (!images.length) return [];
  const python = await existingPython();
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "lovelystep-bg-"));
  const modelDirectory = path.join(process.cwd(), "data", "background-removal-models");
  const manifestPath = path.join(temporaryDirectory, "manifest.json");

  try {
    await fs.mkdir(modelDirectory, { recursive: true });
    const jobs = images.map((_, index) => ({
      input: path.join(temporaryDirectory, `${index}.input`),
      output: path.join(temporaryDirectory, `${index}.png`),
    }));
    await Promise.all(images.map((image, index) => fs.writeFile(jobs[index].input, image)));
    await fs.writeFile(manifestPath, JSON.stringify({ jobs }), "utf8");
    await runBackgroundRemoval(python, manifestPath, modelDirectory);
    return await Promise.all(jobs.map((job) => fs.readFile(job.output)));
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
