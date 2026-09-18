import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * BRD 7.5's first functional requirement: "Player records themselves shooting
 * from within the app."
 *
 * This can only be proven in a real browser. The recorder is `getUserMedia` +
 * `MediaRecorder` end to end - a unit test would have to stub both, which
 * would leave exactly the things that actually break untested: whether the
 * negotiated codec produces a blob the upload route accepts, and whether the
 * `File` reaches it with a `video/*` type at all (a `File` built from a blob
 * without an explicit type arrives as application/octet-stream and is
 * rejected).
 *
 * Chromium gets a synthetic camera and auto-granted permission from the
 * `--use-fake-*-for-media-stream` flags in playwright.config.ts.
 *
 * Signs in as the seeded demo account, which is already onboarded - this spec
 * is about the ingest path, not the wizard (founder-loop.spec.ts covers that,
 * and covers the upload path alongside tap-logging).
 *
 * Every getByRole name match uses `exact: true` - in dev mode Next.js overlays
 * a "Close Next.js Dev Tools" button on every page, which substring-matches
 * short names under Playwright's default matching.
 *
 * The session this creates is real, persisted, throwaway data in the local dev
 * database; it is not cleaned up afterward.
 */

const OBJECT_ID = /[0-9a-f]{24}/;

function button(scope: Page | Locator, name: string) {
  return scope.getByRole("button", { name, exact: true });
}

test.describe.serial("Record a shooting session in-app (BRD 7.5)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("offers both ingest paths, with recording first", async () => {
    await signInAsDemoPlayer(page);
    await page.goto("/analyze/shooting/new");

    // BRD 7.5 asks for recording; upload stays for footage shot elsewhere.
    // Both have to be reachable, or the hub's "Record, then tap-log" promise
    // is copy the app can't keep.
    await expect(page.getByText("Record a session")).toBeVisible();
    await expect(page.getByText("Upload a shooting clip")).toBeVisible();
    await expect(button(page, "Turn on camera")).toBeEnabled();
  });

  test("records a clip and lands on the tap-to-log screen for it", async () => {
    await button(page, "Turn on camera").click();

    // The preview only appears once getUserMedia actually resolved - if
    // permission were denied the component swaps in the upload fallback
    // instead, and this button would never exist.
    const start = button(page, "Start recording");
    await expect(start).toBeVisible();
    await start.click();

    // The running timer is the only signal that MediaRecorder is live.
    await expect(page.getByText(/^\d+:\d{2}$/)).toBeVisible();

    const stop = button(page, "Stop & start logging");
    await expect(stop).toBeVisible();

    // Long enough for more than one 1s timeslice, so the blob is assembled
    // from several chunks rather than a single trivial one.
    await page.waitForTimeout(2500);
    await stop.click();

    // The real assertion: the recording uploaded and became a real session.
    // Reaching this URL means the blob passed the route's video/* check and
    // startSession stored it.
    await page.waitForURL(new RegExp(`/analyze/shooting/${OBJECT_ID.source}$`));

    // ...and it opens on tap-to-log, not a dead end - the shot chart the
    // player taps into is the 300x300 court diagram.
    await expect(page.locator('svg[viewBox="0 0 300 300"]')).toBeVisible();
    await expect(
      page.getByText(/tap the court where each shot happens/i),
    ).toBeVisible();
  });

  test("the recorded session is identified by date on screen (BRD 7.5 'Session and date')", async () => {
    // Same page as the previous step - the session header has to say which
    // session this is, which it previously didn't anywhere on the screen.
    await expect(page.getByText("Shooting Session")).toBeVisible();

    const year = new Date().getFullYear().toString();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(year);
  });

  test("the new session is playable back from the Analyze hub", async () => {
    const sessionUrl = page.url();

    await page.goto("/analyze");
    // A session still being logged must report the shots it actually holds -
    // the hub read 0/0 for every in-progress session before the counters were
    // kept in step on append.
    const row = page.getByRole("link", { name: /Shooting Session/ }).first();
    await expect(row).toBeVisible();

    await page.goto(sessionUrl);
    await expect(page.locator("video")).toBeVisible();
  });
});
