import { expect, test } from "playwright/test";

test.use({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});

test("la CSP autorise les endpoints du pixel", async ({ page }) => {
  const violations: string[] = [];
  const gatewayProbe = "https://capig.datah04.com/events/csp-regression-test";
  let gatewayAllowed = false;
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") && /capig\.datah04\.com|facebook\.com|facebook\.net/.test(text)) violations.push(text);
  });
  await page.route(gatewayProbe, async (route) => {
    gatewayAllowed = true;
    await route.fulfill({ status: 204 });
  });

  const response = await page.goto("/produits/ensemble-3-pieces-petit-compagnon");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("connect-src 'self' https://capig.datah04.com https://www.facebook.com https://connect.facebook.net");

  const accept = page.getByRole("button", { name: "Accepter", exact: true });
  if (await accept.isVisible()) await accept.click();
  await page.getByRole("button", { name: "Ajouter au panier", exact: true }).click();
  await page.evaluate((url) => fetch(url, { method: "POST", mode: "no-cors", body: "{}" }), gatewayProbe);

  expect(gatewayAllowed).toBe(true);
  expect(violations).toEqual([]);
});
