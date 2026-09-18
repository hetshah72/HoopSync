"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { FormInput } from "@/components/onboarding/onboarding-fields";

/**
 * Keeps a half-finished wizard alive across a refresh, an accidental back
 * swipe, a locked phone or a closed tab.
 *
 * BRD 7.1's success criterion is "a new player can complete onboarding
 * without abandoning it partway through", and until now nothing was saved
 * until "Finish" - closing the tab on step 4 lost every answer (audit
 * ONB-12).
 *
 * Deliberately `localStorage` rather than a server-side partial profile:
 * the `playerProfiles` collection validator requires `focusAreas`,
 * `equipment` and `coachPersonality` (`scripts/db/init.ts`), so a draft
 * written at step 1 would be rejected outright, and relaxing the validator
 * to permit half-built profiles would weaken the guarantee every downstream
 * reader depends on. A separate drafts collection would buy cross-device
 * resume that nothing in the BRD asks for, at the cost of a new collection,
 * repository, service and action. The trade-off is that a draft doesn't
 * follow the player to another device - which is not what abandonment
 * actually looks like on a phone.
 *
 * The key is scoped per user so two accounts sharing a browser can't
 * inherit each other's answers.
 */
const VERSION = 1;

export function draftStorageKey(userId: string): string {
  return `hoopsync:onboarding-draft:v${VERSION}:${userId}`;
}

interface StoredDraft {
  stepIndex: number;
  values: Record<string, unknown>;
}

/** `dateOfBirth` is the only Date in the payload; JSON turns it into a string. */
function reviveValues(values: Record<string, unknown>): Partial<FormInput> {
  const revived = { ...values } as Record<string, unknown>;
  if (typeof revived.dateOfBirth === "string") {
    const parsed = new Date(revived.dateOfBirth);
    revived.dateOfBirth = Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return revived as Partial<FormInput>;
}

export interface RestoredDraft {
  stepIndex: number;
  values: Partial<FormInput>;
}

/**
 * `useSyncExternalStore`'s `getSnapshot` must be referentially stable or React
 * re-renders forever, and the draft is read exactly once per mount, so the
 * parsed result is memoised per user.
 */
const snapshotCache = new Map<string, RestoredDraft | null>();

function readDraft(userId: string): RestoredDraft | null {
  if (snapshotCache.has(userId)) return snapshotCache.get(userId) ?? null;

  let result: RestoredDraft | null = null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredDraft;
      result = {
        stepIndex: typeof parsed.stepIndex === "number" ? parsed.stepIndex : 0,
        values: reviveValues(parsed.values ?? {}),
      };
    }
  } catch {
    // A private window, cleared site data, or a draft written by an older
    // version - start clean rather than blocking onboarding on it.
    result = null;
  }

  snapshotCache.set(userId, result);
  return result;
}

/** Never changes after mount - the draft is read once, not subscribed to. */
const subscribe = () => () => {};

/**
 * Reads any saved draft.
 *
 * `useSyncExternalStore` rather than an effect: localStorage *is* an external
 * store, and this is the one primitive that reads one without a
 * setState-in-effect cascade while still giving the server render something
 * coherent. The server snapshot is `undefined`, which the wizard shows as a
 * skeleton - so it never renders step 1 and then yanks the player to step 4.
 */
export function useRestoredDraft(userId: string): RestoredDraft | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readDraft(userId),
    () => undefined,
  );
}

/** Persists every change, and clears the draft once onboarding completes. */
export function useDraftWriter(
  userId: string,
  values: Partial<FormInput>,
  stepIndex: number,
  enabled: boolean,
) {
  // Avoids re-writing identical JSON on every keystroke-driven re-render.
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      const payload = JSON.stringify({ stepIndex, values } satisfies StoredDraft);
      if (payload === lastWritten.current) return;
      lastWritten.current = payload;
      window.localStorage.setItem(draftStorageKey(userId), payload);
    } catch {
      // Storage unavailable or full - onboarding still works, it just
      // won't survive a refresh.
    }
  }, [userId, values, stepIndex, enabled]);
}

export function clearOnboardingDraft(userId: string) {
  // The in-memory snapshot has to go too, or a wizard mounted again in the
  // same session (a completed player revisiting /onboarding) would restore
  // answers that no longer exist in storage.
  snapshotCache.delete(userId);
  try {
    window.localStorage.removeItem(draftStorageKey(userId));
  } catch {
    // Nothing to do - the draft is a convenience, not a source of truth.
  }
}
