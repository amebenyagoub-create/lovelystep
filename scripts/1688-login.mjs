import { chromium } from "playwright";
import path from "node:path";

const profile = path.join(process.cwd(), "data", "1688-profile");
const context = await chromium.launchPersistentContext(profile, { headless: false, locale: "zh-CN" });
const page = context.pages()[0] ?? await context.newPage();
await page.goto("https://www.1688.com", { waitUntil: "domcontentloaded" });
console.log("Connectez-vous à 1688 dans la fenêtre ouverte. Fermez la fenêtre quand la connexion est terminée.");
await new Promise((resolve) => context.on("close", resolve));
