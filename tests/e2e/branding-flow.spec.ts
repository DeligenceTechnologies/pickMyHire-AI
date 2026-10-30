import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

// Company branding: upload a logo and colour, then candidate pages show the
// company's identity and no platform branding. No AI calls are made.

async function system<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await db.begin(async (tx) => { await tx`select set_config('app.system', 'on', true)`; return fn(tx); })) as T;
  } finally {
    await db.end();
  }
}

const LOGO = path.join(__dirname, "fixtures/company-logo.png");

test("company logo and colour replace platform branding on candidate pages", async ({ page, browser }) => {
  const id = Date.now().toString(36);
  const company = `Brand Test ${id}`;
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Robin Owner");
  await page.getByLabel("Work email").fill(`brand-${id}@e2e.test`);
  await page.getByLabel("Company / workspace name").fill(company);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-brand-secret`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Bad files are rejected before anything is stored.
  for (const [name, mime, body, msg] of [
    ["logo.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /PNG, JPG or WebP/],
    ["fake.png", "image/png", Buffer.from("not really an image"), /PNG, JPG or WebP/],
    ["huge.png", "image/png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2_200_000)]), /2 MB/],
  ] as const) {
    const res = await page.request.post("/api/organizations/branding", { multipart: { file: { name, mimeType: mime, buffer: body } } });
    expect(res.ok()).toBeFalsy();
    expect((await res.json()).error).toMatch(msg);
  }

  // Upload the logo and pick a colour in Settings → Branding.
  await page.goto("/settings/branding");
  await page.waitForLoadState("networkidle"); // the upload handler attaches on hydration
  await page.getByLabel("Logo file").setInputFiles(LOGO);
  await expect(page.getByText("Logo updated")).toBeVisible();
  await page.getByLabel("Colour", { exact: true }).fill("#e11d48");
  await page.getByRole("button", { name: "Save colour" }).click();
  await expect(page.getByText("Brand colour saved")).toBeVisible();

  // Public apply page: company logo, company colour, no platform branding.
  const { orgId, slug, token } = await system(async (tx) => {
    const [org] = await tx<{ id: string }[]>`select id from organizations where name = ${company}`;
    const s = `brand-test-${id}`;
    const [job] = await tx<{ id: string }[]>`insert into jobs (organization_id, title, status, apply_enabled, apply_slug, description)
      values (${org.id}, 'Brand Role', 'active', true, ${s}, 'A role to test branding.') returning id`;
    const [c] = await tx<{ id: string }[]>`insert into candidates (organization_id, name, email) values (${org.id}, 'Casey Candidate', ${`cand-${id}@e2e.test`}) returning id`;
    const t = `brandtoken${id}${"x".repeat(32)}`.slice(0, 40);
    const { createHash } = await import("node:crypto");
    await tx`insert into interviews (organization_id, job_id, candidate_id, secure_token_hash, status, token_expires_at)
      values (${org.id}, ${job.id}, ${c.id}, ${createHash("sha256").update(t).digest("hex")}, 'invited', now() + interval '7 days')`;
    return { orgId: org.id, slug: s, token: t };
  });
  const anon = await browser.newContext();
  const cp = await anon.newPage();
  for (const url of [`/apply/${slug}`, `/interview/${token}`]) {
    await cp.goto(url);
    await expect(cp.getByRole("img", { name: company }).first()).toBeVisible();
    await expect(cp.locator("body")).not.toContainText(/PickMyHire|pickmyhire|DeliberateHire/);
    expect(await cp.title()).not.toMatch(/PickMyHire|DeliberateHire/);
    expect(await cp.locator('link[rel="icon"]').first().getAttribute("href")).toContain(`/api/public/logo/${orgId}`);
  }
  // Primary button uses the brand colour (#e11d48 → rgb(225, 29, 72)).
  const bg = await cp.getByRole("link", { name: "Get started" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(225, 29, 72)");

  // The logo route serves the image with long caching.
  const src = await cp.getByRole("img", { name: company }).first().getAttribute("src");
  const img = await cp.request.get(src!);
  expect(img.headers()["content-type"]).toBe("image/png");
  expect(img.headers()["cache-control"]).toContain("immutable");

  // Without a logo, candidates see the company name instead.
  await page.goto("/settings/branding");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Logo removed")).toBeVisible();
  await cp.goto(`/apply/${slug}`);
  await expect(cp.getByRole("img", { name: company })).toHaveCount(0);
  await expect(cp.getByText(company).first()).toBeVisible();
  expect((await cp.request.get(`/api/public/logo/${orgId}`)).status()).toBe(404);

  // Platform admins can manage a company's branding too.
  const adminEmail = `brand-admin-${id}@e2e.test`;
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await ap.goto("/signup?code=1");
  await ap.getByLabel("Full name").fill("Ada Admin");
  await ap.getByLabel("Work email").fill(adminEmail);
  await ap.getByLabel("Company / workspace name").fill(`Admin ${id}`);
  await ap.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await ap.getByLabel("Password").fill(`pw-${id}-admin-secret`);
  await ap.getByRole("button", { name: "Create workspace" }).click();
  await expect(ap).toHaveURL(/\/dashboard/);
  // Not yet an admin: refused.
  expect((await ap.request.patch(`/api/admin/companies/${orgId}/branding`, { data: { color: "#0f766e" } })).status()).toBe(403);
  execSync(`npm run -s admin:grant -- ${adminEmail}`, { stdio: "pipe" });
  await ap.goto(`/admin/companies/${orgId}`);
  await ap.waitForLoadState("networkidle");
  await ap.getByLabel("Logo file").setInputFiles(LOGO);
  await expect(ap.getByText("Logo updated")).toBeVisible();
  await cp.goto(`/apply/${slug}`);
  await expect(cp.getByRole("img", { name: company }).first()).toBeVisible();
  await anon.close();
  await admin.close();
});
