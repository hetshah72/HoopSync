"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import {
  TEAM_FIELD_MESSAGES,
  missingTeamFields,
  onboardingSchema,
} from "@/lib/validation/onboarding";
import { requiresParentalConsent } from "@/lib/age";
import { submitOnboarding } from "@/server/actions/onboardingActions";

import {
  BackgroundFields,
  BasicsFields,
  ConsentField,
  GoalsFields,
  PersonalityField,
  TrainingFields,
  type FormInput,
  type FormOutput,
} from "@/components/onboarding/onboarding-fields";
import {
  clearOnboardingDraft,
  useDraftWriter,
  useRestoredDraft,
} from "@/components/onboarding/use-onboarding-draft";

import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const BASE_STEPS = [
  "basics",
  "background",
  "goals",
  "training",
  "personality",
] as const;

const STEP_TITLES: Record<string, string> = {
  basics: "The basics",
  background: "Your basketball background",
  goals: "Goals & focus areas",
  training: "Training habits & equipment",
  personality: "Pick your Coach's personality",
  consent: "One more thing",
};

/**
 * Short labels for the step rail. Deliberately not the titles above: the
 * rail and the current step's heading are on screen together, and repeating
 * the same string in both is noise (and an ambiguous match for anything
 * looking the page up by text).
 */
const STEP_RAIL_LABELS: Record<string, string> = {
  basics: "Basics",
  background: "Background",
  goals: "Goals",
  training: "Training",
  personality: "Coach style",
  consent: "Consent",
};

/** One line of context under each step heading, so no step is a bare form. */
const STEP_SUBTITLES: Record<string, string> = {
  basics: "So workouts match your age, size and level.",
  background: "Where you play now, and the position you play.",
  goals: "What you're training for, and what to work on first.",
  training: "How often you play, and what you can train with.",
  personality: "How you want your Coach to talk to you.",
  consent: "Required before an account can be created for a player under 13.",
};

/**
 * Which fields "Continue" validates on each step.
 *
 * Built inside the component (via useMemo) rather than mutated into a
 * module-level constant during render, which is what the previous version
 * did for the conditional team fields - a render-phase side effect on
 * shared state that only worked because exactly one wizard is ever mounted.
 */
function useStepFields(
  askName: boolean,
  onTeam: boolean | undefined,
): Record<string, FieldPath<FormInput>[]> {
  return useMemo(
    () => ({
      basics: [
        ...(askName ? (["displayName"] as FieldPath<FormInput>[]) : []),
        "dateOfBirth",
        "heightInches",
        "weightLbs",
        "educationLevel",
        "expectedGraduationYear",
      ],
      background: onTeam
        ? ["position", "competitiveLevel", "onTeam", "teamName", "teamLevel", "roleOnTeam"]
        : ["position", "competitiveLevel", "onTeam"],
      goals: ["primaryGoal", "focusAreas"],
      training: ["gamesPerWeek", "practiceFrequencyPerWeek", "equipment"],
      personality: ["coachPersonality"],
      consent: ["parentalConsentGiven"],
    }),
    [askName, onTeam],
  );
}

export function OnboardingWizard({
  userId,
  sessionName,
}: {
  userId: string;
  /** From the session. Both sign-up routes supply one (Google from the
   * profile, password sign-up from its Name field), so this is normally set
   * and the name step is skipped - but a provider is free to return none. */
  sessionName?: string | null;
}) {
  const askName = !sessionName?.trim();

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      displayName: sessionName?.trim() ?? "",
      onTeam: false,
      teamName: "",
      teamLevel: "",
      roleOnTeam: "",
      primaryGoal: "",
      focusAreas: [],
      equipment: [],
      parentalConsentGiven: false,
    },
  });

  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const restored = useRestoredDraft(userId);
  const [draftApplied, setDraftApplied] = useState(false);

  useEffect(() => {
    if (restored === undefined || draftApplied) return;
    if (restored) {
      for (const [key, value] of Object.entries(restored.values)) {
        if (value !== undefined) {
          form.setValue(key as FieldPath<FormInput>, value as never);
        }
      }
      setStepIndex(restored.stepIndex);
    }
    setDraftApplied(true);
  }, [restored, draftApplied, form]);

  const values = form.watch();
  // Only start writing once the restore has run, so an empty initial render
  // can't overwrite a saved draft before it's been read back.
  useDraftWriter(userId, values, stepIndex, draftApplied && !submitting);

  const dateOfBirth = values.dateOfBirth;
  const parentalConsentGiven = values.parentalConsentGiven;

  const needsParentalConsent = useMemo(
    () => dateOfBirth instanceof Date && requiresParentalConsent(dateOfBirth),
    [dateOfBirth],
  );

  const steps = useMemo(
    () => (needsParentalConsent ? [...BASE_STEPS, "consent"] : [...BASE_STEPS]),
    [needsParentalConsent],
  );
  // A DOB edit can shorten the flow out from under the current index.
  const safeStepIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[safeStepIndex];
  const isLastStep = safeStepIndex === steps.length - 1;

  const stepFields = useStepFields(askName, values.onTeam);

  async function handleNext() {
    const valid = await form.trigger(stepFields[currentStep] ?? []);

    // The "on a team -> team fields required" rule is an object-level
    // refinement, and zod skips those while a required key further down the
    // form is still missing - which is every step before the last. So on this
    // step the rule is applied directly, from the same `missingTeamFields`
    // the schema's refinement uses. (The refinement still runs on submit and
    // on the server, where the whole object is present.)
    let teamOk = true;
    if (currentStep === "background") {
      const missing = missingTeamFields(values);
      teamOk = missing.length === 0;
      for (const field of missing) {
        form.setError(field, {
          type: "manual",
          message: TEAM_FIELD_MESSAGES[field],
        });
      }
    }

    if (!valid || !teamOk) return;
    setStepIndex(Math.min(safeStepIndex + 1, steps.length - 1));
  }

  function handleBack() {
    setStepIndex(Math.max(0, safeStepIndex - 1));
  }

  async function onValid(data: FormOutput) {
    setSubmitting(true);
    try {
      await submitOnboarding(data);
    } catch (err) {
      setSubmitting(false);
      toast.error(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      return;
    }
    clearOnboardingDraft(userId);
    // Stays in the submitting state through the navigation so the Finish
    // button can't be double-tapped while /home loads.
    router.push("/home");
  }

  // Holding the first paint until the draft has been read back avoids
  // rendering step 1 and then jumping the player to step 4.
  if (!draftApplied) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <OnboardingShell
      steps={steps.map((step) => STEP_RAIL_LABELS[step])}
      currentIndex={safeStepIndex}
    >
      <div className="space-y-1.5">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
          {STEP_TITLES[currentStep]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {STEP_SUBTITLES[currentStep]}
        </p>
      </div>

      <div className="mt-8 space-y-5">
        {currentStep === "basics" && (
          <BasicsFields form={form} askName={askName} />
        )}
        {currentStep === "background" && <BackgroundFields form={form} />}
        {currentStep === "goals" && <GoalsFields form={form} />}
        {currentStep === "training" && <TrainingFields form={form} />}
        {currentStep === "personality" && <PersonalityField form={form} />}
        {currentStep === "consent" && <ConsentField form={form} />}
      </div>

      <div className="mt-10 flex gap-3">
        {safeStepIndex > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 rounded-xl text-[0.95rem]"
            onClick={handleBack}
            disabled={submitting}
          >
            Back
          </Button>
        )}
        {!isLastStep ? (
          <Button
            type="button"
            className={CONTINUE_CLASS}
            onClick={handleNext}
          >
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            className={CONTINUE_CLASS}
            // Mirrors the server-side gate in profileService: an under-13
            // account can't be created without confirmed consent.
            disabled={
              submitting || (needsParentalConsent && !parentalConsentGiven)
            }
            onClick={form.handleSubmit(onValid)}
          >
            {submitting ? "Saving..." : "Finish"}
          </Button>
        )}
      </div>
    </OnboardingShell>
  );
}

/** The accent CTA, matching the sign-up button the player just came from. */
const CONTINUE_CLASS =
  "h-11 flex-[2] rounded-xl bg-brand-strong text-[0.95rem] font-semibold text-brand-foreground shadow-lg transition-all hover:bg-brand-strong/90 disabled:shadow-none";
