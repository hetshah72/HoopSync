import { describe, expect, it } from "vitest";
import {
  resolveCallbackPath,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

const valid = {
  name: "Jordan",
  email: "jordan@example.com",
  password: "hoopsync1",
  confirmPassword: "hoopsync1",
};

describe("signUpSchema", () => {
  it("accepts a well-formed sign-up", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("normalizes the email so one address can't become two accounts", () => {
    const parsed = signUpSchema.parse({
      ...valid,
      email: "  Jordan@Example.COM ",
    });
    expect(parsed.email).toBe("jordan@example.com");
  });

  it("trims the name", () => {
    expect(signUpSchema.parse({ ...valid, name: "  Jordan  " }).name).toBe(
      "Jordan",
    );
  });

  it("reports a mismatched confirmation on the confirmation field", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      confirmPassword: "hoopsync2",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]?.path).toEqual(["confirmPassword"]);
  });

  it("requires a password with length, a letter and a number", () => {
    const reject = (password: string) =>
      expect(
        signUpSchema.safeParse({
          ...valid,
          password,
          confirmPassword: password,
        }).success,
      ).toBe(false);

    reject("short1"); // too short
    reject("allletters"); // no number
    reject("12345678"); // no letter
    reject("a1".repeat(100)); // absurdly long
  });

  it("rejects a missing name and a malformed email", () => {
    expect(signUpSchema.safeParse({ ...valid, name: "   " }).success).toBe(
      false,
    );
    expect(signUpSchema.safeParse({ ...valid, email: "nope" }).success).toBe(
      false,
    );
  });
});

describe("signInSchema", () => {
  it("normalizes the email the same way sign-up does", () => {
    expect(
      signInSchema.parse({ email: " JORDAN@example.com ", password: "x" })
        .email,
    ).toBe("jordan@example.com");
  });

  it("does not apply sign-up's password rules", () => {
    // An account whose password predates a rules change must still be able to
    // sign in; length/complexity is a sign-up-time concern.
    expect(
      signInSchema.safeParse({ email: "jordan@example.com", password: "old" })
        .success,
    ).toBe(true);
  });

  it("still requires a password to have been typed", () => {
    expect(
      signInSchema.safeParse({ email: "jordan@example.com", password: "" })
        .success,
    ).toBe(false);
  });
});

describe("resolveCallbackPath", () => {
  it("keeps an in-app path", () => {
    expect(resolveCallbackPath("/analyze/game-film")).toBe(
      "/analyze/game-film",
    );
  });

  it("falls back when there is nothing to resolve", () => {
    expect(resolveCallbackPath(undefined)).toBe("/home");
    expect(resolveCallbackPath("")).toBe("/home");
  });

  it("refuses anything that would leave the site", () => {
    // Each of these is a destination a browser will happily navigate to.
    for (const hostile of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "http://localhost:3000/home",
    ]) {
      expect(resolveCallbackPath(hostile)).toBe("/home");
    }
  });

  it("refuses to send a freshly signed-in player back to an auth page", () => {
    expect(resolveCallbackPath("/sign-in")).toBe("/home");
    expect(resolveCallbackPath("/sign-up")).toBe("/home");
  });

  it("refuses the auth error page", () => {
    // Landing on a failure screen after a successful sign-in reads as a bug,
    // and this is also the value that trips Auth.js's ErrorPageLoop guard.
    expect(resolveCallbackPath("/auth/error")).toBe("/home");
  });

  it("rejects a rejected path even when it carries a query string", () => {
    // The proxy preserves `req.nextUrl.search` in callbackUrl, so matching on
    // the bare path was not enough.
    expect(resolveCallbackPath("/auth/error?error=Configuration")).toBe("/home");
    expect(resolveCallbackPath("/sign-in?callbackUrl=%2Fhome")).toBe("/home");
  });

  it("keeps a legitimate path that merely starts with a rejected one", () => {
    // The check is on the whole path segment, not a prefix - `/authors` is a
    // perfectly good destination and must survive.
    expect(resolveCallbackPath("/authors")).toBe("/authors");
    expect(resolveCallbackPath("/analyze?tab=report")).toBe(
      "/analyze?tab=report",
    );
  });
});
