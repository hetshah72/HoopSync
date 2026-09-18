import { describe, expect, it } from "vitest";
import {
  AVATAR_ACCEPT,
  AVATAR_IMAGE_TYPES,
  avatarExtensionFor,
  sniffAvatarImageType,
} from "@/lib/avatar-image";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const WEBP = bytes(
  // "RIFF" + a 4-byte length + "WEBP"
  0x52,
  0x49,
  0x46,
  0x46,
  0x24,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
);

describe("sniffAvatarImageType", () => {
  it("identifies each accepted format from its leading bytes", () => {
    expect(sniffAvatarImageType(JPEG)).toBe("image/jpeg");
    expect(sniffAvatarImageType(PNG)).toBe("image/png");
    expect(sniffAvatarImageType(WEBP)).toBe("image/webp");
  });

  /**
   * The whole point of sniffing: an upload's declared Content-Type is
   * attacker-controlled, so a script-bearing document renamed to .png must
   * still be rejected.
   */
  it("rejects content that only claims to be an image", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const html = new TextEncoder().encode("<!doctype html><html></html>");

    expect(sniffAvatarImageType(svg)).toBeNull();
    expect(sniffAvatarImageType(html)).toBeNull();
  });

  it("rejects a truncated signature rather than reading past the buffer", () => {
    expect(sniffAvatarImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffAvatarImageType(bytes())).toBeNull();
    // "RIFF" alone is a container marker, not necessarily WebP.
    expect(sniffAvatarImageType(bytes(0x52, 0x49, 0x46, 0x46))).toBeNull();
  });

  it("never returns a type outside the accepted list", () => {
    for (const sample of [JPEG, PNG, WEBP]) {
      const type = sniffAvatarImageType(sample);
      expect(type).not.toBeNull();
      expect(AVATAR_IMAGE_TYPES).toContain(type);
      expect(avatarExtensionFor(type!)).toMatch(/^(jpg|png|webp)$/);
    }
  });
});

describe("AVATAR_ACCEPT", () => {
  it("offers the picker exactly the formats the server will take", () => {
    expect(AVATAR_ACCEPT.split(",")).toEqual([...AVATAR_IMAGE_TYPES]);
  });
});
