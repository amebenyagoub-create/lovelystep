import webpush from "web-push";
import { spawnSync } from "node:child_process";

const keys = webpush.generateVAPIDKeys();

if (process.argv.includes("--railway")) {
  const service = process.env.RAILWAY_SERVICE || "lovelystep";
  const railway = (args, input) => process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "railway", ...args], { encoding: "utf8", input })
    : spawnSync("railway", args, { encoding: "utf8", input });
  const list = railway(["variable", "list", "--service", service, "--json"]);
  if (list.status !== 0) throw new Error(list.stderr || list.error?.message || "Railway est inaccessible.");
  const current = JSON.parse(list.stdout);
  const hasPublic = Object.hasOwn(current, "WEB_PUSH_VAPID_PUBLIC_KEY");
  const hasPrivate = Object.hasOwn(current, "WEB_PUSH_VAPID_PRIVATE_KEY");
  if (hasPublic !== hasPrivate) throw new Error("Une seule clé Web Push existe déjà. Corrigez la paire avant de continuer.");
  if (hasPublic && hasPrivate) {
    console.log("Les clés Web Push Railway existent déjà : aucune modification.");
    process.exit(0);
  }
  const values = {
    WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    WEB_PUSH_CONTACT: "mailto:admin@lovelystep.com",
  };
  for (const [name, value] of Object.entries(values)) {
    const result = railway(["variable", "set", name, "--stdin", "--service", service, "--skip-deploys", "--json"], value);
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Impossible d'ajouter ${name}.`);
  }
  console.log("Clés Web Push ajoutées au service Railway " + service + ".");
} else {
  console.log("WEB_PUSH_VAPID_PUBLIC_KEY=" + keys.publicKey);
  console.log("WEB_PUSH_VAPID_PRIVATE_KEY=" + keys.privateKey);
  console.log("WEB_PUSH_CONTACT=mailto:admin@lovelystep.com");
}
