import { describe, expect, it } from "vitest";
import {
  BLOCKED_MEDIA_HOSTS,
  allowedHostsFromEnv,
  classifyMediaUrl,
  mediaUrlRejectionMessage,
} from "@/lib/media-url-policy";

/**
 * BRD 7.14 success criterion #2 - "No league-owned footage is used before the
 * pending license is in place" - is only meaningful if it is mechanical.
 * These are the assertions a reviewer can point at.
 */
describe("classifyMediaUrl", () => {
  it("allows our own relative URLs, which is where dev uploads and vendored files live", () => {
    expect(classifyMediaUrl("/uploads/videos/abc.mp4")).toEqual({ ok: true });
    expect(classifyMediaUrl("/drill-demos/placeholder-drill-demo.mp4")).toEqual({
      ok: true,
    });
  });

  it("allows a signed GCS URL, query string and all", () => {
    const url =
      "https://storage.googleapis.com/hoopsync/shot-sessions/u1/x.mp4?X-Goog-Expires=604800&X-Goog-Signature=deadbeef";
    expect(classifyMediaUrl(url)).toEqual({ ok: true });
  });

  it("refuses league-owned footage", () => {
    const verdict = classifyMediaUrl("https://www.nba.com/video/highlight.mp4");
    expect(verdict).toMatchObject({ ok: false, reason: "blocked_host" });
  });

  it("refuses a subdomain of a blocked host, not just the bare domain", () => {
    expect(
      classifyMediaUrl("https://cdn.assets.nba.com/clip.mp4"),
    ).toMatchObject({ ok: false, reason: "blocked_host" });
  });

  it("does not let a lookalike domain pass as a blocked one, or vice versa", () => {
    // "notnba.com" merely ends with the same letters; it must not match, or
    // the denylist would refuse unrelated legitimate licensors.
    expect(classifyMediaUrl("https://notnba.com/x.mp4")).toMatchObject({
      reason: "unlisted_host",
    });
  });

  it("refuses an unknown host at write time, so nothing arrives unvetted", () => {
    expect(classifyMediaUrl("https://random-cdn.example/x.mp4")).toMatchObject({
      ok: false,
      reason: "unlisted_host",
    });
  });

  it("accepts an unknown host once it is allowlisted, so a licence needs no redeploy", () => {
    expect(
      classifyMediaUrl("https://licensor.example/clip.mp4", {
        extraHosts: ["licensor.example"],
      }),
    ).toEqual({ ok: true });
  });

  it("still refuses a league host even when someone allowlists it", () => {
    // The denylist is the BRD-load-bearing half and must not be overridable
    // by configuration - otherwise criterion #2 is one env var from untrue.
    expect(
      classifyMediaUrl("https://www.nba.com/x.mp4", {
        extraHosts: ["nba.com"],
      }),
    ).toMatchObject({ ok: false, reason: "blocked_host" });
  });

  it("in denyOnly mode (the read path) tolerates an unlisted host but never a blocked one", () => {
    expect(
      classifyMediaUrl("https://random-cdn.example/x.mp4", { denyOnly: true }),
    ).toEqual({ ok: true });
    expect(
      classifyMediaUrl("https://www.nba.com/x.mp4", { denyOnly: true }),
    ).toMatchObject({ ok: false, reason: "blocked_host" });
  });

  it("refuses schemes that aren't http(s), including data: payloads", () => {
    expect(classifyMediaUrl("data:video/mp4;base64,AAAA")).toMatchObject({
      ok: false,
      reason: "unsupported_scheme",
    });
  });

  it("refuses a protocol-relative URL rather than treating it as our own path", () => {
    // "//evil.example/x.mp4" starts with "/" - the relative check must not
    // wave it through, because a browser resolves it to an external host.
    expect(classifyMediaUrl("//evil.example/x.mp4")).toMatchObject({
      ok: false,
    });
  });

  it("refuses an unparseable URL instead of throwing", () => {
    expect(classifyMediaUrl("not a url")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("covers the leagues and the scrape sources the BRD names", () => {
    expect(BLOCKED_MEDIA_HOSTS).toContain("nba.com");
    expect(BLOCKED_MEDIA_HOSTS).toContain("youtube.com");
  });
});

describe("allowedHostsFromEnv", () => {
  it("parses, trims, lowercases and ignores blanks", () => {
    expect(allowedHostsFromEnv(" A.com , b.com ,,")).toEqual([
      "a.com",
      "b.com",
    ]);
  });

  it("treats an unset variable as no extra hosts", () => {
    expect(allowedHostsFromEnv(undefined)).toEqual([]);
  });
});

describe("mediaUrlRejectionMessage", () => {
  it("names the host and the rule, so the failure is actionable", () => {
    const message = mediaUrlRejectionMessage({
      ok: false,
      reason: "blocked_host",
      host: "nba.com",
    });
    expect(message).toContain("nba.com");
    expect(message).toContain("licence");
  });
});
