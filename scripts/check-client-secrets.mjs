import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const secrets = [process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY].filter(Boolean);
if (secrets.length !== 2) throw new Error("Both server-side AI keys must be configured before this check.");

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

for (const path of await filesUnder(".next/static")) {
  const contents = await readFile(path);
  if (secrets.some((secret) => contents.includes(Buffer.from(secret)))) {
    throw new Error(`A server-side credential was found in a client asset: ${path}`);
  }
}

console.log(JSON.stringify({ ok: true, clientSecretsExposed: false }, null, 2));
