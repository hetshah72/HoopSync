import type { Page } from "@playwright/test";

/**
 * Getting an account into the browser, which every suite here has to do first.
 *
 * These drive the real sign-up and sign-in forms rather than a test-only
 * shortcut, so the path a reviewer takes is the path under test. (There used
 * to be a dev-only passwordless provider that did this in one click; it was
 * removed along with magic-link sign-in when email/password landed.)
 *
 * Not named `*.spec.ts`, so Playwright doesn't collect it as a test file.
 */

/** Satisfies the sign-up rules: 8+ characters, with a letter and a number. */
export const E2E_PASSWORD = "e2e-password-1";

/**
 * The account `npm run db:seed` creates, with its documented password.
 *
 * Read on call rather than at import: one suite loads `.env.local` with
 * dotenv in its own module body, which runs *after* this module has been
 * imported - constants here would have captured the defaults before those
 * variables existed.
 */
export function demoCredentials(): { email: string; password: string } {
  return {
    email: process.env.SEED_DEMO_USER_EMAIL || "demo.player@hoopsync.dev",
    password: process.env.SEED_DEMO_USER_PASSWORD || "demo-player-1",
  };
}

/** Signs in as that seeded account. It is already onboarded, so this lands
 * straight on Home. */
export async function signInAsDemoPlayer(page: Page): Promise<void> {
  await signInWithPassword(page, demoCredentials());
}

/**
 * Creates a brand-new account. Resolves once onboarding is on screen - a
 * player with no profile yet is always redirected there.
 */
export async function signUpNewPlayer(
  page: Page,
  { email, name, password = E2E_PASSWORD }: {
    email: string;
    name: string;
    password?: string;
  },
): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.waitForURL("**/onboarding");
}

/** Signs an existing account in and waits for the expected destination. */
export async function signInWithPassword(
  page: Page,
  { email, password, waitForUrl = "**/home" }: {
    email: string;
    password: string;
    waitForUrl?: string;
  },
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(waitForUrl);
}
