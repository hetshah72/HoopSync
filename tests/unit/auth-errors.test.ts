import { describe, expect, it } from "vitest";
import { describeAuthError, describeAuthPageError } from "@/lib/auth-errors";

/**
 * Two maps of failure copy that deliberately do not share wording, and the
 * tests that keep them apart.
 *
 * `describeAuthError` renders inside the sign-in form and points at controls on
 * that page. `describeAuthPageError` renders on `/auth/error`, a standalone
 * screen with no form on it, where "below" would be a lie. Merging them looks
 * like an obvious cleanup and is the regression these tests exist to catch.
 */

/** Every code either Auth.js can send us or a stale link can put in the URL. */
const PAGE_CODES = [
  "Configuration",
  "AccessDenied",
  "Verification",
  "WebAuthnVerificationError",
  "OAuthAccountNotLinked",
  "AccountNotLinked",
  "OAuthSignInError",
  "OAuthCallbackError",
  "CredentialsSignin",
  "MissingCSRF",
];

describe("describeAuthPageError", () => {
  it("gives every handled code a title and a description", () => {
    for (const code of PAGE_CODES) {
      const copy = describeAuthPageError(code);
      expect(copy.title.length, `title for ${code}`).toBeGreaterThan(0);
      expect(
        copy.description.length,
        `description for ${code}`,
      ).toBeGreaterThan(0);
    }
  });

  it("falls back rather than returning nothing", () => {
    for (const unknown of [undefined, "", "NopeNotReal", "<script>"]) {
      const copy = describeAuthPageError(unknown);
      expect(copy.title).toBe("Something went wrong");
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });

  it("never echoes the code it was given", () => {
    // The `?error=` parameter reaches this page attacker-controlled, so it may
    // only ever select copy we wrote - never become copy itself.
    for (const code of [...PAGE_CODES, "Call 1-800-555-0100"]) {
      const { title, description, reason } = describeAuthPageError(code);
      const rendered = [title, description, reason ?? ""].join(" ");
      expect(rendered, `copy for ${code}`).not.toContain(code);
    }
  });

  it("writes copy that doesn't point at controls on another page", () => {
    // The whole reason this is a second map and not a widened first one.
    for (const code of [undefined, ...PAGE_CODES]) {
      expect(
        describeAuthPageError(code).description,
        `description for ${code}`,
      ).not.toMatch(/\bbelow\b/i);
    }
  });

  it("doesn't blame the player's configuration for Auth.js's catch-all", () => {
    // "Configuration" is what Auth.js collapses adapter failures, network
    // blips and a cancelled Google consent into - so the copy must not assert
    // that anything is actually misconfigured.
    const { title, description } = describeAuthPageError("Configuration");
    expect(`${title} ${description}`).not.toMatch(/configur/i);
  });
});

describe("describeAuthError", () => {
  it("leaves the sign-in form copy alone", () => {
    expect(describeAuthError("CredentialsSignin")).toBe(
      "Incorrect email or password.",
    );
    expect(describeAuthError(undefined)).toBeUndefined();
  });

  it("still points at the form it renders inside", () => {
    // Intentionally the inverse of the guard above: this copy *wants* "below",
    // because there really is a form underneath it. Anyone unifying the two
    // maps breaks this and the guard above at the same time.
    expect(describeAuthError("OAuthAccountNotLinked")).toMatch(/\bbelow\b/i);
  });

  it("no longer sends players to a support channel that doesn't exist", () => {
    expect(describeAuthError("Configuration")).not.toMatch(/contact support/i);
  });
});
