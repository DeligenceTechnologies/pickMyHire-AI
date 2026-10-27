import { expect, test, type Page } from "@playwright/test";

// Cookie consent and Google Analytics. Google's script is replaced by a stub, so
// nothing is sent to Google; the test checks what would be loaded and when.
const GA = "G-85EEW34HLJ";
const disabled = (page: Page) => page.evaluate((id) => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA);
const config = (page: Page) => page.evaluate(() => {
  const dl = ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => Array.from(a));
  return dl.find((a) => a[0] === "config")?.[2] as Record<string, unknown> | undefined;
});

test.beforeEach(async ({ context }) => {
  // Analytics only runs on the live domain; this flag lets the test browser run it locally.
  await context.addInitScript(() => localStorage.setItem("pmh-analytics-test", "1"));
});

test("nothing loads until the visitor accepts, and declining is remembered", async ({ page }) => {
  const gaRequests: string[] = [];
  await page.route("**/www.googletagmanager.com/**", (r) => { gaRequests.push(r.request().url()); return r.fulfill({ contentType: "text/javascript", body: "" }); });
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Cookie consent" });
  await expect(banner).toBeVisible();
  await page.waitForTimeout(800);
  expect(gaRequests).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/_ga/);
  await banner.getByRole("button", { name: "Decline" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await page.waitForTimeout(800);
  await expect(banner).toBeHidden();
  expect(gaRequests).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toContain("pmh_consent=denied");
});

test("after accepting, analytics runs on public pages only, with clean addresses", async ({ page }) => {
  const gaRequests: string[] = [];
  await page.route("**/www.googletagmanager.com/**", (r) => { gaRequests.push(r.request().url()); return r.fulfill({ contentType: "text/javascript", body: "" }); });
  await page.goto("/?utm_source=linkedin&utm_campaign=launch");
  await page.getByRole("region", { name: "Cookie consent" }).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => gaRequests.length).toBe(1);
  expect(gaRequests[0]).toContain(`id=${GA}`);
  expect(await disabled(page)).toBe(false);
  const cfg = await config(page);
  expect(cfg).toMatchObject({ page_location: "http://localhost:3000/?utm_source=linkedin&utm_campaign=launch", allow_google_signals: false, allow_ad_personalization_signals: false });

  // Moving into the app (here: the sign-up page) switches analytics off before anything is sent.
  await page.getByRole("link", { name: "Start free trial" }).first().click();
  await page.waitForURL(/\/signup/);
  expect(await disabled(page)).toBe(true);
  // Back to a public page: on again.
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/");
  await expect.poll(() => disabled(page)).toBe(false);

  // Candidate interview links never load analytics, even with consent.
  const fresh = await page.context().newPage();
  const freshRequests: string[] = [];
  await fresh.route("**/www.googletagmanager.com/**", (r) => { freshRequests.push(r.request().url()); return r.fulfill({ contentType: "text/javascript", body: "" }); });
  await fresh.goto("/interview/not-a-real-token-123456");
  await fresh.waitForTimeout(800);
  expect(freshRequests).toEqual([]);
  await expect(fresh.getByRole("region", { name: "Cookie consent" })).toBeHidden();
  await fresh.close();

  // A private parameter on a public page: loaded, but switched off.
  await page.goto("/?code=SECRET");
  await page.waitForTimeout(500);
  expect(await disabled(page)).toBe(true);
  expect(JSON.stringify(await config(page))).not.toContain("SECRET");
});

test("cookie settings let the visitor withdraw consent, which removes analytics cookies", async ({ page, context }) => {
  await page.route("**/www.googletagmanager.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await context.addCookies([{ name: "pmh_consent", value: "granted", url: "http://localhost:3000" }, { name: "_ga", value: "GA1.1.123.456", url: "http://localhost:3000" }]);
  await page.goto("/demo");
  await expect(page.getByRole("region", { name: "Cookie consent" })).toBeHidden();
  await page.getByRole("button", { name: "Cookie settings" }).first().click();
  await page.getByRole("region", { name: "Cookie consent" }).getByRole("button", { name: "Decline" }).click();
  expect(await disabled(page)).toBe(true);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "_ga")).toBeUndefined();
  expect(cookies.find((c) => c.name === "pmh_consent")?.value).toBe("denied");
  await page.goto("/cookies");
  await expect(page.getByRole("heading", { name: "How we use cookies" })).toBeVisible();
});

// With Google's real script (hits are intercepted and never reach Google). Needs internet,
// so it runs only when asked: GA_LIVE_TEST=1 npx playwright test analytics
test("with the real Google script, nothing is sent from private pages", async ({ page }) => {
  test.skip(!process.env.GA_LIVE_TEST, "set GA_LIVE_TEST=1 to run against Google's real script");
  const hits: string[] = [];
  await page.route(/google-analytics\.com\/g\/collect|googletagmanager\.com\/g\/collect/, (r) => { hits.push(r.request().url() + "\n" + (r.request().postData() ?? "")); return r.fulfill({ status: 204, body: "" }); });
  await page.goto("/?utm_source=linkedin");
  await page.getByRole("region", { name: "Cookie consent" }).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => hits.some((h) => h.includes("en=page_view")), { timeout: 20_000 }).toBe(true);
  // Client-side navigation into a private page: Google's own history tracking must stay silent.
  const before = hits.length;
  await page.getByRole("link", { name: "Start free trial" }).first().click();
  await page.waitForURL(/\/signup/);
  await page.waitForTimeout(4000);
  const after = hits.slice(before).join("\n");
  expect(after).not.toContain("signup");
  const addresses = hits.flatMap((h) => [...h.matchAll(/[?&]d[lr]=([^&\n]*)/g)].map((m) => decodeURIComponent(m[1])));
  expect(addresses.join(" ")).not.toMatch(/code=|\/interview\/|\/candidates|\/signup/);
  // Back on the public site, page views resume.
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/");
  await page.locator('a[href="/demo"]').first().click();
  await page.waitForURL(/\/demo/);
  await expect.poll(() => hits.slice(before).some((h) => decodeURIComponent(h).includes("/demo")), { timeout: 20_000 }).toBe(true);
});
