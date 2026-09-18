import { test, expect, type Page } from "@playwright/test";
import { signUpNewPlayer } from "./helpers/auth";

/**
 * The app's own date picker (`src/components/ui/date-field.tsx`), exercised on
 * the field it was built for: onboarding's date of birth.
 *
 * The other suites fill this field with `.fill()`, which drives the underlying
 * `<input type="date">` and never touches the calendar - so without this spec
 * the entire panel, its roving focus and its month arithmetic have no coverage
 * at all. None of it can be asserted anywhere but a real browser.
 *
 * `exact: true` on the month/year selects: their accessible names ("Month",
 * "Year") are substrings of the arrow buttons' ("Previous month", "Next
 * month"), and Playwright's default matching is substring.
 */

const PANEL = "Choose a date";

function openCalendar(page: Page) {
  return page.getByRole("button", { name: "Open calendar" }).click();
}
function monthSelect(page: Page) {
  return page.getByLabel("Month", { exact: true });
}
function yearSelect(page: Page) {
  return page.getByLabel("Year", { exact: true });
}
function panel(page: Page) {
  return page.getByRole("dialog", { name: PANEL });
}
function dateOfBirth(page: Page) {
  return page.getByLabel("Date of birth");
}
/** What the browser reports as focused, by its accessible name. */
function focusedLabel(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
}

test.describe.serial("Date picker (onboarding date of birth)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signUpNewPlayer(page, {
      email: `e2e-datepicker-${Math.random().toString(36).slice(2)}@hoopsync.dev`,
      name: "Riley",
    });
    await expect(page.getByText("The basics")).toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("opens near a player's likely birth year, not on this month", async () => {
    await openCalendar(page);
    await expect(panel(page)).toBeVisible();

    // The whole reason this replaced the native picker: the native one opens
    // on the current month, leaving a teenager ~190 arrow presses from their
    // own birth year.
    const year = Number(await yearSelect(page).inputValue());
    const age = new Date().getUTCFullYear() - year;
    expect(age).toBeGreaterThan(5);
    expect(age).toBeLessThan(40);

    // Focus lands in the grid, or arrow keys and Escape would go to the
    // trigger button instead.
    expect(await focusedLabel(page)).toMatch(/\d{4}$/);
  });

  test("reaches any date through the month and year selects", async () => {
    await yearSelect(page).selectOption("2009");
    await monthSelect(page).selectOption("2"); // March

    await page.getByRole("gridcell", { name: /March 14, 2009/ }).click();

    await expect(dateOfBirth(page)).toHaveValue("2009-03-14");
    // Choosing a day is the end of the interaction - the panel shouldn't
    // have to be dismissed separately.
    await expect(panel(page)).toBeHidden();
  });

  test("reopens on the chosen date rather than resetting", async () => {
    await openCalendar(page);
    await expect(monthSelect(page)).toHaveValue("2");
    await expect(yearSelect(page)).toHaveValue("2009");
    await expect(
      page.getByRole("gridcell", { name: /March 14, 2009/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("arrow keys move by day and week, Enter picks", async () => {
    await page.keyboard.press("ArrowRight");
    expect(await focusedLabel(page)).toContain("March 15, 2009");

    await page.keyboard.press("ArrowDown");
    expect(await focusedLabel(page)).toContain("March 22, 2009");

    await page.keyboard.press("Enter");
    await expect(dateOfBirth(page)).toHaveValue("2009-03-22");
  });

  test("PageUp crosses into the previous month, clamping the day", async () => {
    await openCalendar(page);
    // 31 March has no counterpart in February: a month back must land on the
    // 28th, not roll forward into March again.
    await monthSelect(page).selectOption("2");
    await page.getByRole("gridcell", { name: /March 31, 2009/ }).click();
    await openCalendar(page);

    await page.keyboard.press("PageUp");
    expect(await focusedLabel(page)).toContain("February 28, 2009");
    await expect(monthSelect(page)).toHaveValue("1");
  });

  test("Escape closes it and hands focus back to the trigger", async () => {
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    expect(await focusedLabel(page)).toBe("Open calendar");
    // Escaping is a cancel, so the previously chosen date survives it.
    await expect(dateOfBirth(page)).toHaveValue("2009-03-31");
  });

  test("refuses a date outside the allowed range", async () => {
    // Nobody signing up was born in the future, so the current month is the
    // last one reachable and the days after today in it aren't selectable.
    const now = new Date();
    const [year, month, day] = [
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ];

    await openCalendar(page);
    await yearSelect(page).selectOption(String(year));
    await monthSelect(page).selectOption(String(month));

    await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();

    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    if (day < daysInMonth) {
      const tomorrow = new Intl.DateTimeFormat("en", {
        dateStyle: "full",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month, day + 1)));
      await expect(
        page.getByRole("gridcell", { name: tomorrow }),
      ).toBeDisabled();
    }

    await page.keyboard.press("Escape");
  });

  test("Clear empties the field", async () => {
    await openCalendar(page);
    await page.getByRole("button", { name: "Clear" }).click();

    await expect(dateOfBirth(page)).toHaveValue("");
    await expect(panel(page)).toBeHidden();
  });

  test("typing still works, and the calendar follows what was typed", async () => {
    // The field is still a real date input - this is how every other suite
    // fills it, and it must keep working.
    await dateOfBirth(page).fill("2008-01-01");
    await openCalendar(page);

    await expect(monthSelect(page)).toHaveValue("0");
    await expect(yearSelect(page)).toHaveValue("2008");
    await page.keyboard.press("Escape");
  });
});
