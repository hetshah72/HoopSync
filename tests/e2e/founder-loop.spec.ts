import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { signUpNewPlayer } from "./helpers/auth";

/**
 * Walks the exact founder-defined connected loop end-to-end against a real
 * dev server + real MongoDB, signing up a brand-new account so onboarding
 * runs for real (BRD v1.1 §7-8, CLAUDE.md "Acceptance bar for the
 * MVP loop"): onboard -> Home feed -> study an NBA player -> generate &
 * complete a workout -> Progress updates -> record + tap-log a shooting
 * session -> exact replay -> Share With Coach -> Coach -> train again ->
 * Progress updates again -> Feed still renders.
 *
 * OPENAI_API_KEY is intentionally unset in this dev environment, so the
 * Coach step asserts the real, honest "not configured" fallback rather than
 * a fabricated reply - see coach-service's graceful-degradation behavior.
 *
 * Every getByRole button/link name match below uses `exact: true` - in dev
 * mode Next.js overlays its own Dev Tools toggle button on every page with
 * accessible name "Close Next.js Dev Tools", which substring-matches common
 * short names like "Next" under Playwright's default (non-exact) matching.
 *
 * Deliberately out of scope (covered elsewhere, not part of this connected
 * loop): per-field onboarding validation errors, Like/Save/Share feed
 * actions, Goals (see goal-auto-tracking.spec.ts). Game Film is covered only for its
 * Share With Coach hand-off (BRD v1.1 §7 "Analysis -> Share to Coach"), which
 * is the second of the two Analyze entry points and shares that edge.
 * Each new user created by a run of this suite is real, persisted, throwaway
 * test data in the local dev database - it is not cleaned up afterward.
 */

const SAMPLE_VIDEO = path.join(__dirname, "fixtures", "sample-clip.mp4");
const OBJECT_ID = /[0-9a-f]{24}/;

function button(scope: Page | Locator, name: string) {
  return scope.getByRole("button", { name, exact: true });
}
function link(scope: Page | Locator, name: string) {
  return scope.getByRole("link", { name, exact: true });
}
function nav(page: Page) {
  return page.getByRole("navigation");
}
/** The <p> holding a stat's numeric value sits next to (not inside) the <p>
 * carrying its label - scope to the exact label text (anchored) since some
 * labels ("Makes") are substrings of unrelated prose elsewhere on the same
 * page (e.g. the Mechanical Breakdown card's "Makes vs. misses" heading). */
function statCard(page: Page, label: string) {
  return page.locator("p", { hasText: new RegExp(`^${label}$`) }).locator("..");
}

test.describe.serial("Founder connected loop (P0.8)", () => {
  let page: Page;
  const email = `e2e-${Math.random().toString(36).slice(2)}@hoopsync.dev`;
  let shotSessionUrl: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("sign up with a brand-new account and complete onboarding", async () => {
    await test.step("password sign-up drops a never-before-seen user into onboarding", async () => {
      await signUpNewPlayer(page, { email, name: "Jordan" });
      await expect(page.getByText("The basics")).toBeVisible();
      await expect(page.getByText("Step 1 of 5")).toBeVisible();
    });

    await test.step("basics", async () => {
      // Sign-up already captured the name (BRD 7.1 "Account: ... name"), so
      // onboarding must not ask for it a second time.
      await expect(page.getByLabel("What should we call you?")).toBeHidden();
      await page.getByLabel("Date of birth").fill("2008-01-01");
      await page.getByLabel("Height in feet").fill("6");
      await page.getByLabel("Height in inches").fill("0");
      await page.getByLabel("Weight (lbs)").fill("180");
      await button(page, "High School").click();
      await page.getByLabel("Expected graduation year").fill("2028");
      await button(page, "Continue").click();
      await expect(page.getByText("Your basketball background")).toBeVisible();
    });

    await test.step("background (adult DOB must never surface the consent step)", async () => {
      await button(page, "Point Guard").click();
      await button(page, "High School").click();
      await button(page, "Continue").click();
      await expect(page.getByText("Goals & focus areas")).toBeVisible();
    });

    await test.step("goals - select Shooting so the later shot session ties into a real focus area", async () => {
      await button(page, "Become a better all-around player").click();
      await button(page, "Shooting").click();
      await button(page, "Continue").click();
      await expect(page.getByText("Training habits & equipment")).toBeVisible();
    });

    await test.step("training - select Hoop + Ball so equipment never blocks workout generation", async () => {
      await page.getByLabel("Games per week").fill("2");
      await page.getByLabel("Practices per week").fill("3");
      await button(page, "Hoop").click();
      await button(page, "Ball").click();
      await button(page, "Continue").click();
      await expect(page.getByText("Pick your Coach's personality")).toBeVisible();
    });

    await test.step("personality + finish (skips the consent step for an adult DOB)", async () => {
      await page.locator("button", { hasText: "Balanced" }).click();
      await expect(button(page, "Finish")).toBeVisible();
      await button(page, "Finish").click();
      await page.waitForURL("**/home");
      // Regression guard: submitOnboarding must not call redirect() itself.
      // The wizard awaits it inside a try/catch, which catches redirect()'s
      // internal NEXT_REDIRECT throw and toasts a successful signup as an
      // error - the navigation still happens, so waitForURL alone passes.
      await expect(page.getByText("NEXT_REDIRECT")).toHaveCount(0);
    });
  });

  test("home feed reflects the just-completed onboarding answers", async () => {
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(
      page.getByText("Your goal: Become a better all-around player"),
    ).toBeVisible();
    await expect(page.getByText("Shooting", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Coach is set to")).toContainText("Balanced");
  });

  /**
   * BRD 7.1 FR2 + its success criterion: onboarding must "generate an initial
   * personalized recommendation / starting plan" that "visibly drives at
   * least one Home-screen recommendation immediately afterward". Ranking the
   * static feed by tag overlap didn't satisfy that - it only re-sorts, and
   * changes nothing at all for a focus area no seeded card carries.
   */
  test("home shows a real, startable starting plan built from the onboarding answers", async () => {
    const plan = page.getByText("Your starting plan");
    await expect(plan).toBeVisible();
    await expect(
      page.getByText("Built from the answers you just gave us."),
    ).toBeVisible();

    await link(page, "Start your first workout").click();
    await page.waitForURL(/\/train\/[a-f0-9]{24}/);
    // A real workout document, not a placeholder card.
    await expect(page.getByText("Your starting plan")).toBeVisible();

    await page.goBack();
    await page.waitForURL("**/home");
  });

  test("study Stephen Curry and start a matching workout from a real signature move", async () => {
    await link(nav(page), "Players").click();
    await page.waitForURL("**/players");

    await page.getByRole("link", { name: /Stephen Curry/ }).click();
    await page.waitForURL(new RegExp(`/players/${OBJECT_ID.source}$`));

    const startMatchingWorkout = button(page, "Start Matching Workout");
    await expect(startMatchingWorkout).toBeVisible();
    await startMatchingWorkout.click();
    await page.waitForURL(new RegExp(`/train/${OBJECT_ID.source}$`));

    await expect(button(page, "Start Workout")).toBeVisible();
  });

  test("complete the generated workout", async () => {
    await button(page, "Start Workout").click();
    await expect(page.getByText(/Drill 1 of \d+/)).toBeVisible();

    // Exercise the individual drill-completion toggle at least once - real
    // coverage of a path "Complete Workout" alone would otherwise mask.
    await button(page, "Mark complete").click();
    await expect(button(page, "Marked complete")).toBeVisible();

    // Enabled, not merely visible: Next is always rendered and is disabled on
    // the last drill, so a visibility check spins forever on a 1-drill workout.
    while (await button(page, "Next").isEnabled().catch(() => false)) {
      await button(page, "Next").click();
    }

    await button(page, "Complete Workout").click();
    await page.waitForURL("**/train");
  });

  test("progress reflects the completed workout", async () => {
    await link(nav(page), "Progress").click();
    await page.waitForURL("**/progress");

    const workoutsCard = statCard(page, "Workouts completed");
    await expect(workoutsCard).toContainText("1");
    const streakCard = statCard(page, "Current streak");
    await expect(streakCard).toContainText("1");

    // Achievements (BRD 7.13). The tier line sits under the measured stats,
    // and the tab shows the milestone that first workout actually earned.
    await expect(page.getByText(/training XP|XP ·/).first()).toBeVisible();

    await page.getByRole("tab", { name: "Achievements" }).click();
    await expect(page.getByText("On the Board").first()).toBeVisible();
    // A locked milestone shows real progress, not a padlock.
    await expect(page.getByText("Ten Deep").first()).toBeVisible();
  });

  test("record and tap-log a real shooting session across 3 zones", async () => {
    await link(nav(page), "Analyze").click();
    await page.waitForURL("**/analyze");

    await link(page, "Shooting Session").click();
    await page.waitForURL("**/analyze/shooting/new");

    await page.getByLabel("Video file").setInputFiles(SAMPLE_VIDEO);
    const uploadButton = button(page, "Upload & Start Logging");
    await expect(uploadButton).toBeEnabled();
    await uploadButton.click();
    await page.waitForURL(new RegExp(`/analyze/shooting/${OBJECT_ID.source}$`));

    const svg = page.locator('svg[viewBox="0 0 300 300"]');
    await expect(svg).toBeVisible();
    const box = await svg.boundingBox();
    if (!box) throw new Error("Court diagram has no bounding box.");

    async function tapAndConfirm(xPct: number, yPct: number, made: boolean) {
      await svg.click({ position: { x: (xPct / 100) * box!.width, y: (yPct / 100) * box!.height } });
      await button(page, made ? "Make" : "Miss").click();
    }

    // Tap the paint first and verify the real, deterministic zone
    // classification before confirming - this is genuinely computed from
    // the tap coordinates (src/lib/shot-zones.ts), not a stub.
    await svg.click({ position: { x: (50 / 100) * box.width, y: (10 / 100) * box.height } });
    await expect(page.getByText("Paint", { exact: true })).toBeVisible();
    await button(page, "Make").click();

    await tapAndConfirm(5, 10, false); // left_corner_3, miss
    await tapAndConfirm(95, 10, false); // right_corner_3, miss

    await expect(page.getByText(/1\/3 logged/)).toBeVisible();
    const finishButton = button(page, "Finish & Analyze Session");
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    await expect(page.getByText("Shot Chart")).toBeVisible();
    shotSessionUrl = page.url();
  });

  test("shot chart filters, exact replay, and the labeled mechanical breakdown all show real data", async () => {
    const attemptsCard = statCard(page, "Attempts");
    await expect(attemptsCard).toContainText("3");
    const makesCard = statCard(page, "Makes");
    await expect(makesCard).toContainText("1");

    await button(page, "made").click();
    await expect(page.locator('circle[fill="#10b981"]')).toHaveCount(1);
    await button(page, "missed").click();
    await expect(page.locator('circle[stroke="#ef4444"]')).toHaveCount(2);
    await button(page, "all").click();

    const madeMarker = page.locator('circle[fill="#10b981"]').first();
    await madeMarker.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Make");
    await expect(dialog).toContainText("Paint");
    await button(page, "Close").click();
    await expect(dialog).toBeHidden();

    // With 3 distinct zones tapped, finalize always has a real best/weakest
    // zone to generate a (labeled) mechanical narrative from.
    await expect(page.getByText("Simulated mechanical analysis.")).toBeVisible();
  });

  test("finishing the session updates Progress with no reload (BRD 7.11)", async () => {
    // The success criterion is "within the same session, with no refresh or
    // manual step", so this navigates by tapping the nav link and never calls
    // page.reload().
    await link(nav(page), "Progress").click();
    await page.waitForURL("**/progress");

    // The exact numbers this run tap-logged: 1 make out of 3 attempts.
    await expect(statCard(page, "Sessions logged")).toContainText("1");
    await expect(statCard(page, "Shots made")).toContainText("1/3");
    await expect(statCard(page, "Field goal %")).toContainText("33.3%");

    // The session is in the unified history alongside the earlier workout.
    await expect(page.getByText("Session history")).toBeVisible();
    await expect(page.getByText("Shooting session")).toBeVisible();

    // Every zone here has 1-2 attempts, well under the evidence bar, so
    // Progress must decline to name a strength or weakness rather than
    // inventing one from two missed shots.
    await expect(page.getByText(/Not enough shots from any one spot yet/)).toBeVisible();

    // Back to the report so the Share With Coach step continues from it.
    await page.goto(shotSessionUrl);
  });

  test("share with coach carries this exact session's real context", async () => {
    await button(page, "Share With Coach").click();
    await page.waitForURL(new RegExp(`/coach/${OBJECT_ID.source}$`));
    await expect(page.getByText("Real session context attached")).toBeVisible();
    await expect(page.getByText("1/3")).toBeVisible();
  });

  // With no OPENAI_API_KEY in this environment, Coach used to answer with
  // nothing at all - the player's message sat unanswered under an error note
  // that vanished on reload (audit Bug Coach-3). It now falls back to a reply
  // composed from the player's own records, persisted like any other message
  // and labeled so it can't be mistaken for a generated one.
  test("coach always answers, and labels a composed reply honestly", async () => {
    const textarea = page.getByPlaceholder("Message Coach...");
    await textarea.fill("How did my session go?");
    const sendButton = textarea.locator("..").getByRole("button");
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await expect(page.getByText("How did my session go?")).toBeVisible();
    await expect(
      page.getByText(/no AI model was available for this reply/i),
    ).toBeVisible();

    // Both the question and the answer survive a reload - the point of
    // persisting the fallback rather than holding it in component state.
    await page.reload();
    await expect(page.getByText("How did my session go?")).toBeVisible();
    await expect(
      page.getByText(/no AI model was available for this reply/i),
    ).toBeVisible();
  });

  test("train again from the session's recommended workout (or a fresh one) and complete it", async () => {
    await page.goto(shotSessionUrl);
    const startWorkoutLink = link(page, "Start Workout");

    if (await startWorkoutLink.isVisible().catch(() => false)) {
      await startWorkoutLink.click();
    } else {
      // Recommended-workout generation is wrapped in try/catch server-side
      // and can legitimately produce nothing - fall back to a fresh
      // skill-based workout so "train again" is still exercised for real.
      await page.goto("/train");
      await button(page, "Shooting").click();
      await button(page, "Generate Workout").click();
    }
    await page.waitForURL(new RegExp(`/train/${OBJECT_ID.source}$`));

    await button(page, "Start Workout").click();
    await expect(page.getByText(/Drill 1 of \d+/)).toBeVisible();
    // Enabled, not merely visible: Next is always rendered and is disabled on
    // the last drill, so a visibility check spins forever on a 1-drill workout.
    while (await button(page, "Next").isEnabled().catch(() => false)) {
      await button(page, "Next").click();
    }
    await button(page, "Complete Workout").click();
    await page.waitForURL("**/train");
  });

  test("progress updates a second time and the feed still renders real content", async () => {
    await link(nav(page), "Progress").click();
    await page.waitForURL("**/progress");
    const workoutsCard = statCard(page, "Workouts completed");
    await expect(workoutsCard).toContainText("2");

    await link(nav(page), "Home").click();
    await page.waitForURL("**/home");
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(button(page, "Ask Coach").first()).toBeVisible();
  });

  // The other half of BRD v1.1 §7's "Analysis -> Share to Coach -> Coach gets
  // context" edge. Same requirement as the shooting hand-off above, different
  // analysis type - and the one the founder called out as previously broken.
  test("game film shares into Coach with the review's real findings attached", async () => {
    await link(nav(page), "Analyze").click();
    await page.waitForURL("**/analyze");
    await link(page, "Game Film").click();
    await page.waitForURL("**/analyze/game-film");

    await page.getByLabel("Game clip").setInputFiles(SAMPLE_VIDEO);
    await button(page, "Upload and review").click();
    await page.waitForURL(
      new RegExp(`/analyze/game-film/${OBJECT_ID.source}$`),
      { timeout: 30_000 },
    );
    // The upload responds before the review exists - analysis runs after the
    // response - so the report screen may show its polling state first and
    // swap itself out when the analysis lands. Generating the review also
    // builds a workout per weakness, so allow for both.
    await expect(page.getByText("Game Film Review")).toBeVisible({
      timeout: 60_000,
    });

    await button(page, "Share With Coach").click();
    await page.waitForURL(new RegExp(`/coach/${OBJECT_ID.source}$`));
    const conversationUrl = page.url();

    await expect(page.getByText("Real session context attached")).toBeVisible();
    // Never a generic greeting, and never overstating what the review is.
    // No OPENAI_API_KEY in this environment means no vision pass ran, so the
    // opener has to say plainly that the footage wasn't analysed.
    await expect(
      page.getByText(/nothing in the video was analysed/i),
    ).toBeVisible();

    // Sharing the same review again resumes that conversation instead of
    // stacking up identically-titled duplicates in the Coach list.
    await page.goBack();
    await page.waitForURL(
      new RegExp(`/analyze/game-film/${OBJECT_ID.source}$`),
    );
    await button(page, "Share With Coach").click();
    await page.waitForURL(new RegExp(`/coach/${OBJECT_ID.source}$`));
    expect(page.url()).toBe(conversationUrl);
  });
});
