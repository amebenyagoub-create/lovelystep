import { expect, test } from "playwright/test";

test("la CSP autorise les endpoints du pixel", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") && /capig\.datah04\.com|facebook\.com|facebook\.net/.test(text)) violations.push(text);
  });

  const response = await page.goto("/produits/ensemble-3-pieces-petit-compagnon");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("connect-src 'self' https://capig.datah04.com https://www.facebook.com https://connect.facebook.net");

  const accept = page.getByRole("button", { name: "Accepter", exact: true });
  if (await accept.isVisible()) await accept.click();
  await page.getByRole("button", { name: "Ajouter au panier", exact: true }).click();
  await page.waitForTimeout(1_000);

  expect(violations).toEqual([]);
});
