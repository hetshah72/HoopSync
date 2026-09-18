"use client";

import type { FieldPath, UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  COACH_PERSONALITIES,
  EQUIPMENT_OPTIONS,
  POSITIONS,
  SKILL_CATEGORIES,
  onboardingSchema,
} from "@/lib/validation/onboarding";
import {
  COACH_PERSONALITY_INFO,
  COMPETITIVE_LEVEL_LABELS,
  EDUCATION_LEVEL_LABELS,
  EQUIPMENT_LABELS,
  PRIMARY_GOAL_SUGGESTIONS,
  SKILL_LABELS,
  TEAM_LEVEL_SUGGESTIONS,
  TEAM_ROLE_SUGGESTIONS,
} from "@/lib/onboarding-options";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChipGroup } from "@/components/ui/chip-group";
import { DateField } from "@/components/ui/date-field";

/**
 * The onboarding question groups, extracted so the wizard (progressive, one
 * group per step) and the profile screen (BRD 7.1: "persist profile data so
 * it can be edited later" - every group at once, flat) render exactly the
 * same inputs from exactly the same schema. Without this the two would
 * drift, and a field added to onboarding would silently become uneditable.
 *
 * `equipment`/`parentalConsentGiven` use zod `.default()`, which makes them
 * optional on input but always-present on output - a plain single-generic
 * useForm<OnboardingInput>() can't satisfy both sides. The three-generic
 * form (input shape for fields, output shape for the validated submit
 * payload) is what react-hook-form's resolver typing actually expects here.
 */
export type FormInput = z.input<typeof onboardingSchema>;
export type FormOutput = z.output<typeof onboardingSchema>;
export type OnboardingForm = UseFormReturn<FormInput, unknown, FormOutput>;

interface FieldsProps {
  form: OnboardingForm;
}

/**
 * Renders the real message for a field.
 *
 * This replaces a helper that rendered the same "Please check this field."
 * under every input regardless of what was wrong (audit ONB-02/ONB-07) -
 * which on a flow whose success criterion is "a new player can complete
 * onboarding without abandoning it partway through" is the difference
 * between a fixable mistake and a dead end.
 */
export function FieldError({
  form,
  name,
}: FieldsProps & { name: FieldPath<FormInput> }) {
  const error =
    form.formState.errors[name as keyof typeof form.formState.errors];
  const message = (error as { message?: string } | undefined)?.message;
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** Asked only when the auth provider gave us no name to work with. */
export function NameField({ form }: FieldsProps) {
  return (
    <Field label="What should we call you?" htmlFor="displayName">
      <Input
        id="displayName"
        autoComplete="given-name"
        placeholder="e.g. Jordan"
        {...form.register("displayName")}
      />
      <FieldError form={form} name="displayName" />
    </Field>
  );
}

/**
 * Date of birth, held in form state as a real `Date` but rendered as the
 * `YYYY-MM-DD` string the DOM wants.
 *
 * Deliberately controlled rather than `register(..., { valueAsDate: true })`:
 * the schema wants a Date, so a registered input would end up with a Date
 * object in its DOM `value`. Parsing goes through `parseDateInputValue`, so
 * the Date is UTC midnight and `calculateAge` reads the same calendar day on
 * the phone and on the server - the under-13 consent step can't appear on
 * one and not the other (audit ONB-13).
 */
function DateOfBirthField({ form }: FieldsProps) {
  const value = form.watch("dateOfBirth");
  return (
    <Field label="Date of birth" htmlFor="dateOfBirth">
      <DateField
        id="dateOfBirth"
        value={value instanceof Date ? value : undefined}
        onChange={(date) =>
          form.setValue("dateOfBirth", date as FormInput["dateOfBirth"], {
            shouldValidate: true,
          })
        }
        min={DOB_BOUNDS.min}
        max={DOB_BOUNDS.max}
        // Opens around the age this app is actually for (BRD: youth/teen
        // players) rather than on this month, which for a date of birth is
        // always the wrong answer.
        defaultViewDate={DOB_BOUNDS.defaultView}
      />
      <FieldError form={form} name="dateOfBirth" />
    </Field>
  );
}

/**
 * Selectable range for a date of birth: nobody signing up was born tomorrow,
 * and a 1900s birth year in a youth basketball app is a typo rather than a
 * user. Computed once per module load - the boundary only has to be right to
 * the day, and a session doesn't outlive a day of accuracy here.
 */
const DOB_BOUNDS = (() => {
  const now = new Date();
  const [year, month, day] = [
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ];
  return {
    min: new Date(Date.UTC(year - 100, month, day)),
    max: new Date(Date.UTC(year, month, day)),
    defaultView: new Date(Date.UTC(year - 15, month, 1)),
  };
})();

/**
 * Height as feet + inches rather than one raw inches box.
 *
 * `heightInches` stays the stored unit; only the input is split. No teenager
 * knows their height in inches, and the old single field (placeholder "e.g.
 * 70") was the most likely place in the flow to stall or be filled in wrong.
 */
function HeightField({ form }: FieldsProps) {
  const total = form.watch("heightInches");
  const feet = typeof total === "number" ? Math.floor(total / 12) : undefined;
  const inches = typeof total === "number" ? total % 12 : undefined;

  function set(nextFeet: number | undefined, nextInches: number | undefined) {
    const f = nextFeet ?? feet ?? 0;
    const i = nextInches ?? inches ?? 0;
    form.setValue("heightInches", f * 12 + i, { shouldValidate: true });
  }

  return (
    <Field label="Height">
      <div className="flex items-center gap-2">
        <Input
          id="heightFeet"
          type="number"
          inputMode="numeric"
          min={3}
          max={8}
          aria-label="Height in feet"
          placeholder="5"
          value={feet ?? ""}
          onChange={(e) =>
            set(
              e.target.value === "" ? undefined : Number(e.target.value),
              undefined,
            )
          }
        />
        <span className="text-muted-foreground text-sm">ft</span>
        <Input
          id="heightInchesPart"
          type="number"
          inputMode="numeric"
          min={0}
          max={11}
          aria-label="Height in inches"
          placeholder="10"
          value={inches ?? ""}
          onChange={(e) =>
            set(
              undefined,
              e.target.value === "" ? undefined : Number(e.target.value),
            )
          }
        />
        <span className="text-muted-foreground text-sm">in</span>
      </div>
      <FieldError form={form} name="heightInches" />
    </Field>
  );
}

export function BasicsFields({
  form,
  askName,
}: FieldsProps & { askName: boolean }) {
  return (
    <>
      {askName && <NameField form={form} />}
      <DateOfBirthField form={form} />
      <HeightField form={form} />
      <Field label="Weight (lbs)" htmlFor="weightLbs">
        <Input
          id="weightLbs"
          type="number"
          inputMode="numeric"
          placeholder="e.g. 150"
          {...form.register("weightLbs", { valueAsNumber: true })}
        />
        <FieldError form={form} name="weightLbs" />
      </Field>
      <Field label="Education level">
        <ChipGroup
          options={Object.entries(EDUCATION_LEVEL_LABELS).map(
            ([value, label]) => ({
              value,
              label,
            }),
          )}
          value={form.watch("educationLevel") ?? ""}
          onChange={(v) =>
            form.setValue("educationLevel", v as FormInput["educationLevel"], {
              shouldValidate: true,
            })
          }
        />
        <FieldError form={form} name="educationLevel" />
      </Field>
      <Field label="Expected graduation year" htmlFor="expectedGraduationYear">
        <Input
          id="expectedGraduationYear"
          type="number"
          inputMode="numeric"
          placeholder="e.g. 2028"
          {...form.register("expectedGraduationYear", { valueAsNumber: true })}
        />
        <FieldError form={form} name="expectedGraduationYear" />
      </Field>
    </>
  );
}

export function BackgroundFields({ form }: FieldsProps) {
  const onTeam = form.watch("onTeam");

  return (
    <>
      <Field label="Position">
        <ChipGroup
          options={POSITIONS.map((p) => ({ value: p, label: p }))}
          value={form.watch("position") ?? ""}
          onChange={(v) =>
            form.setValue("position", v as FormInput["position"], {
              shouldValidate: true,
            })
          }
        />
        <FieldError form={form} name="position" />
      </Field>
      <Field label="Competitive level">
        <ChipGroup
          options={Object.entries(COMPETITIVE_LEVEL_LABELS).map(
            ([value, label]) => ({
              value,
              label,
            }),
          )}
          value={form.watch("competitiveLevel") ?? ""}
          onChange={(v) =>
            form.setValue(
              "competitiveLevel",
              v as FormInput["competitiveLevel"],
              {
                shouldValidate: true,
              },
            )
          }
        />
        <FieldError form={form} name="competitiveLevel" />
      </Field>
      <Field label="Currently on a team?">
        <ChipGroup
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          value={onTeam ? "yes" : "no"}
          onChange={(v) =>
            form.setValue("onTeam", v === "yes", { shouldValidate: true })
          }
        />
      </Field>
      {onTeam && (
        <>
          <Field label="Team name" htmlFor="teamName">
            <Input
              id="teamName"
              placeholder="e.g. Lincoln High Ravens"
              {...form.register("teamName")}
            />
            <FieldError form={form} name="teamName" />
          </Field>
          <Field label="Team level">
            <ChipGroup
              options={TEAM_LEVEL_SUGGESTIONS.map((t) => ({
                value: t,
                label: t,
              }))}
              value={form.watch("teamLevel") ?? ""}
              onChange={(v) =>
                form.setValue("teamLevel", v as string, {
                  shouldValidate: true,
                })
              }
            />
            <FieldError form={form} name="teamLevel" />
          </Field>
          <Field label="Your role on the team">
            <ChipGroup
              options={TEAM_ROLE_SUGGESTIONS.map((r) => ({
                value: r,
                label: r,
              }))}
              value={form.watch("roleOnTeam") ?? ""}
              onChange={(v) =>
                form.setValue("roleOnTeam", v as string, {
                  shouldValidate: true,
                })
              }
            />
            <FieldError form={form} name="roleOnTeam" />
          </Field>
        </>
      )}
    </>
  );
}

export function GoalsFields({ form }: FieldsProps) {
  return (
    <>
      <Field label="Primary goal">
        <ChipGroup
          options={PRIMARY_GOAL_SUGGESTIONS.map((g) => ({
            value: g,
            label: g,
          }))}
          value={form.watch("primaryGoal") || ""}
          onChange={(v) =>
            form.setValue("primaryGoal", v as string, { shouldValidate: true })
          }
        />
        <FieldError form={form} name="primaryGoal" />
      </Field>
      <Field label="Skills to improve">
        <ChipGroup
          multiple
          options={SKILL_CATEGORIES.map((s) => ({
            value: s,
            label: SKILL_LABELS[s],
          }))}
          value={form.watch("focusAreas") ?? []}
          onChange={(v) =>
            form.setValue("focusAreas", v as FormInput["focusAreas"], {
              shouldValidate: true,
            })
          }
        />
        <FieldError form={form} name="focusAreas" />
      </Field>
    </>
  );
}

export function TrainingFields({ form }: FieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Games per week" htmlFor="gamesPerWeek">
          <Input
            id="gamesPerWeek"
            type="number"
            inputMode="numeric"
            {...form.register("gamesPerWeek", { valueAsNumber: true })}
          />
          <FieldError form={form} name="gamesPerWeek" />
        </Field>
        <Field label="Practices per week" htmlFor="practiceFrequencyPerWeek">
          <Input
            id="practiceFrequencyPerWeek"
            type="number"
            inputMode="numeric"
            {...form.register("practiceFrequencyPerWeek", {
              valueAsNumber: true,
            })}
          />
          <FieldError form={form} name="practiceFrequencyPerWeek" />
        </Field>
      </div>
      <Field label="Equipment available">
        <ChipGroup
          multiple
          options={EQUIPMENT_OPTIONS.map((e) => ({
            value: e,
            label: EQUIPMENT_LABELS[e],
          }))}
          value={form.watch("equipment") ?? []}
          onChange={(v) =>
            form.setValue("equipment", v as FormInput["equipment"])
          }
        />
        <FieldError form={form} name="equipment" />
      </Field>
    </>
  );
}

/**
 * The shared look for the full-width "pick one of these" cards below.
 *
 * They were flat `border-input` rectangles that marked the choice with a 5%
 * primary tint - a change so faint it was hard to tell what was selected.
 * Selection is now carried three ways (ember border, tinted surface, and a
 * filled check) so it never rests on a single low-contrast channel.
 */
function optionCardClass(selected: boolean): string {
  return cn(
    "press relative w-full rounded-xl border p-3.5 pr-12 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    selected
      ? "border-brand/45 bg-brand-soft/45 shadow-sm"
      : "border-border bg-card hover:bg-accent/60",
  );
}

function OptionCheck({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1/2 right-3.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-brand bg-brand text-brand-foreground"
          : "border-input bg-transparent text-transparent",
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

export function PersonalityField({ form }: FieldsProps) {
  const selectedPersonality = form.watch("coachPersonality");
  return (
    <div className="space-y-2">
      {COACH_PERSONALITIES.map((p) => {
        const info = COACH_PERSONALITY_INFO[p];
        const selected = selectedPersonality === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              form.setValue("coachPersonality", p, { shouldValidate: true })
            }
            className={optionCardClass(selected)}
          >
            <div className="text-sm font-semibold">{info.label}</div>
            <div className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-snug">
              {info.description}
            </div>
            <OptionCheck selected={selected} />
          </button>
        );
      })}
      <FieldError form={form} name="coachPersonality" />
    </div>
  );
}

export function ConsentField({ form }: FieldsProps) {
  const given = form.watch("parentalConsentGiven");
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Based on the date of birth entered, a parent or guardian needs to
        confirm they&apos;re okay with this account being created.
      </p>
      <button
        type="button"
        aria-pressed={Boolean(given)}
        onClick={() => form.setValue("parentalConsentGiven", !given)}
        className={optionCardClass(Boolean(given))}
      >
        <div className="text-sm font-semibold">
          {given ? "Confirmed" : "A parent/guardian confirms this"}
        </div>
        <OptionCheck selected={Boolean(given)} />
      </button>
    </div>
  );
}
