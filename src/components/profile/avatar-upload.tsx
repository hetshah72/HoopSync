"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AVATAR_ACCEPT,
  AVATAR_IMAGE_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_SIZE_MESSAGE,
  AVATAR_TYPE_MESSAGE,
  type AvatarImageType,
} from "@/lib/avatar-image";

const INPUT_ID = "profile-avatar-file";

/**
 * The profile photo control on the identity card.
 *
 * Three behaviours worth knowing about:
 *
 * - The trigger is a `<label>` wrapping the avatar, not a button that
 *   proxies a click to a hidden input. The input is `sr-only` but still
 *   focusable, so the keyboard path is the browser's own rather than
 *   something re-implemented here.
 * - A chosen file is previewed from an object URL immediately. Waiting for
 *   the round trip to show anything makes a phone upload feel like the tap
 *   missed.
 * - `avatarUrl` (uploaded, removable) and `providerImageUrl` (from Google,
 *   ours to show but not to delete) are separate props, so "Remove" only
 *   appears when there is actually an upload to remove.
 */
export function AvatarUpload({
  displayName,
  avatarUrl,
  providerImageUrl,
}: {
  displayName: string;
  avatarUrl?: string;
  providerImageUrl?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [busy, setBusy] = useState<"uploading" | "removing" | null>(null);

  /**
   * `undefined` means "whatever the server last told us"; a string is a
   * local preview or a just-saved URL; `null` is a just-removed photo. The
   * override keeps the avatar from flickering back to the old image during
   * the `router.refresh()` that follows a successful write.
   */
  const [override, setOverride] = useState<string | null | undefined>(
    undefined,
  );

  const uploaded = override === undefined ? avatarUrl : (override ?? undefined);
  const shown = uploaded ?? providerImageUrl;
  const initial = displayName.trim()[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function previewLocally(file: File) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setOverride(objectUrlRef.current);
  }

  async function handleFile(file: File) {
    // The same two rules the route enforces, so an obviously-wrong file is
    // rejected here instead of after a pointless upload. The server still
    // checks - and checks the bytes, not the declared type.
    if (!AVATAR_IMAGE_TYPES.includes(file.type as AvatarImageType)) {
      toast.error(AVATAR_TYPE_MESSAGE);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(AVATAR_SIZE_MESSAGE);
      return;
    }

    previewLocally(file);
    setBusy("uploading");
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Couldn't save that photo.");
      }
      // Swap the object URL for the stored one before refreshing, so the
      // preview and the server agree by the time the new render lands.
      setOverride(body.data.avatarUrl as string);
      toast.success("Profile photo updated.");
      // The header avatar in the app shell reads the same profile
      // server-side; this is what updates it too.
      router.refresh();
    } catch (err) {
      setOverride(undefined);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save that photo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("removing");
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Couldn't remove that photo.");
      }
      setOverride(null);
      toast("Profile photo removed.");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove that photo.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <label
        htmlFor={INPUT_ID}
        className="group ring-border focus-within:ring-brand relative block cursor-pointer rounded-full shadow-sm ring-1 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-[var(--card)]"
      >
        <Avatar className="size-16">
          {shown && <AvatarImage src={shown} alt="" />}
          <AvatarFallback className="bg-brand-soft font-heading text-brand-soft-foreground text-xl font-bold">
            {initial}
          </AvatarFallback>
        </Avatar>

        {/* Desktop affordance: the whole avatar dims to a camera on hover or
            keyboard focus. Phones have no hover, which is why the badge
            below is always visible rather than relying on this. */}
        <span
          aria-hidden
          className="bg-foreground/55 text-background pointer-events-none absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {busy === "uploading" ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Camera className="size-5" />
          )}
        </span>

        <span
          aria-hidden
          className="bg-brand-strong text-brand-foreground ring-card absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full shadow-sm ring-2"
        >
          {busy === "uploading" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Camera className="size-3" />
          )}
        </span>

        <input
          ref={inputRef}
          id={INPUT_ID}
          type="file"
          accept={AVATAR_ACCEPT}
          disabled={busy !== null}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the *same* file again still fires change -
            // otherwise a failed upload can't be retried without picking
            // something else first.
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        <span className="sr-only">Upload a profile photo</span>
      </label>

      {uploaded && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy !== null}
          className="text-muted-foreground hover:text-foreground -mb-1 h-6 px-2 text-[0.6875rem]"
          onClick={() => void remove()}
        >
          {busy === "removing" ? "Removing..." : "Remove"}
        </Button>
      )}
    </div>
  );
}
