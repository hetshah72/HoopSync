"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Check,
  Dumbbell,
  Loader2,
  Megaphone,
  RotateCcw,
  ShieldCheck,
  Target,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { onboardingSchema } from "@/lib/validation/onboarding";
import { requiresParentalConsent } from "@/lib/age";
import { saveProfile } from "@/server/actions/profileActions";
import { cn } from "@/lib/utils";

import {
  BackgroundFields,
  BasicsFields,
  ConsentField,
  GoalsFields,
  NameField,
  PersonalityField,
  TrainingFields,
  type FormInput,
  type FormOutput,
} from "@/components/onboarding/onboarding-fields";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Every answer, normalised to a comparable string.
 *
 * The chip pickers set their values through `setValue` without
 * `shouldDirty`, so react-hook-form's own `formState.isDirty` stays false
 * after a chip change - gating Save on it would make chip-only edits
 * unsaveable. Comparing against the last-saved values instead is honest
 * regardless of how a field was written. Multi-selects are sorted because
 * toggling a chip off and back on reorders the array without changing the
 * answer.
 */
function normalize(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return [...value].map(String).sort().join("|");
  if (value === undefined || value === null) return "";
  return String(value);
}

function hasChanges(current: FormInput, baseline: FormInput): boolean {
  const a = current as Record<string, unknown>;
  const b = baseline as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].some((key) => normalize(a[key]) !== normalize(b[key]));
}

/**
 * The profile edit screen (BRD 7.1 FR3).
 *
 * Onboarding was built one-shot: there was no route anywhere that let a
 * player change an answer afterwards, which also left workout generation's
 * "try adding equipment in your profile" error pointing at a screen that
 * didn't exist. Every question is here, rendered by the *same* components
 * the wizard uses so the two can't diverge - but flat and sectioned rather
 * than paged, because editing one field shouldn't mean stepping through six
 * screens.
 */
export function ProfileForm({
  defaultValues,
  consentAlreadyGiven,
}: {
  defaultValues: FormInput;
  /** A guardian already consented, so an edit shouldn't demand it again. */
  consentAlreadyGiven: boolean;
}) {
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues,
  });

  const router = useRouter();
  const [saving, setSaving] = useState(false);
  /** What's on the server right now - the thing "unsaved" is measured against. */
  const [baseline, setBaseline] = useState<FormInput>(defaultValues);

  const values = form.watch();
  const dateOfBirth = values.dateOfBirth;
  const parentalConsentGiven = values.parentalConsentGiven;
  const dirty = hasChanges(values, baseline);
  const errorCount = Object.keys(form.formState.errors).length;

  // Editing a date of birth can move a player across the COPPA threshold,
  // so the gate is re-evaluated here exactly as it is in the wizard.
  const needsConsent = useMemo(
    () =>
      dateOfBirth instanceof Date &&
      requiresParentalConsent(dateOfBirth) &&
      !consentAlreadyGiven,
    [dateOfBirth, consentAlreadyGiven],
  );

  const consentBlocked = needsConsent && !parentalConsentGiven;
  /** Nothing to save and nothing wrong means no bar at all. */
  const showBar = dirty || saving || errorCount > 0;

  async function onValid(data: FormOutput) {
    setSaving(true);
    try {
      await saveProfile(data);
      // The form is now what the server holds, so the bar settles back to
      // "saved" without waiting for the refresh to round-trip.
      setBaseline(form.getValues());
      toast.success("Profile updated.");
      // Home, Train and Coach all read this profile server-side; refreshing
      // is what makes the change visible there rather than only here.
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  function onInvalid() {
    // The form is long and the button lives at the bottom of it, so a silent
    // rejection reads as a dead button. Say what happened; react-hook-form
    // focuses the first offending field from here.
    toast.error("Some answers need another look before this can save.");
  }

  function discard() {
    form.reset(baseline);
    toast("Changes discarded.");
  }

  return (
    <div className="space-y-4 pb-4">
      <Section
        title="You"
        description="Name, age and measurements."
        icon={UserRound}
      >
        <NameField form={form} />
        <BasicsFields form={form} askName={false} />
      </Section>

      <Section
        title="Your basketball background"
        description="Where you play now, and the position you play."
        icon={Trophy}
      >
        <BackgroundFields form={form} />
      </Section>

      <Section
        title="Goals & focus areas"
        description="What every generated workout is built around."
        icon={Target}
      >
        <GoalsFields form={form} />
      </Section>

      <Section
        title="Training habits & equipment"
        description="Drills are only prescribed for gear you actually have."
        icon={Dumbbell}
      >
        <TrainingFields form={form} />
      </Section>

      <Section
        title="Coach personality"
        description="How Coach talks to you after a session."
        icon={Megaphone}
      >
        <PersonalityField form={form} />
      </Section>

      {needsConsent && (
        <Section
          title="Parent or guardian consent"
          description="Required before this profile can be saved."
          icon={ShieldCheck}
        >
          <ConsentField form={form} />
        </Section>
      )}

      {/* The action bar. This was a bare full-width button sitting directly
          on the page: it scrolled over the cards with nothing behind it and
          read as a black band cutting the form in half. It is now a floating
          bar that says what state the form is in, rather than leaving "did
          that save?" to the toast alone.

          Two deliberate calls. It is opaque, not frosted like the tab bar -
          a translucent surface this small lets the field labels underneath
          ghost through it, which looks like a rendering fault. And it only
          exists while there is something to do: a permanently-parked
          disabled button is dead weight on every screenful of a long form.

          The offset clears the floating tab bar *and* the iOS home
          indicator; from `lg` the tab bar is gone, so it drops to the edge. */}
      {showBar && (
        <div className="animate-rise sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 lg:bottom-6">
          <div className="border-border/70 bg-card ring-foreground/5 rounded-2xl border p-2.5 shadow-xl ring-1">
            {/* Two rows on a phone so the status line survives at 360px, one
              row from `sm` where there is room beside the buttons. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 pt-1 sm:pt-0">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    errorCount > 0 && !saving ? "bg-destructive" : "bg-brand",
                    !saving && "animate-pulse",
                  )}
                />
                <p
                  aria-live="polite"
                  className="truncate text-[0.8125rem] font-medium"
                >
                  {saving
                    ? "Saving your changes..."
                    : errorCount > 0
                      ? "Some answers need another look."
                      : "You have unsaved changes."}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {dirty && !saving && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={discard}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw />
                    Discard
                  </Button>
                )}

                <Button
                  type="button"
                  size="lg"
                  className="flex-1 sm:min-w-[10.5rem] sm:flex-none"
                  disabled={saving || !dirty || consentBlocked}
                  onClick={form.handleSubmit(onValid, onInvalid)}
                >
                  {saving ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check />
                      Save changes
                    </>
                  )}
                </Button>
              </div>
            </div>

            {consentBlocked && (
              <p className="text-muted-foreground px-1.5 pt-2 pb-0.5 text-xs sm:pt-2.5">
                A parent or guardian needs to confirm above before this can
                save.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-xl"
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription className="text-xs leading-snug">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}
