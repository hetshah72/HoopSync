import { ObjectId } from "mongodb";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { getProfileByUserId } from "@/server/services/profileService";
import { ProfileForm } from "@/components/profile/profile-form";
import { NotificationPreferencesForm } from "@/components/profile/notification-preferences-form";
import type { FormInput } from "@/components/onboarding/onboarding-fields";
import { resolveProfileAge } from "@/lib/age";
import {
  COACH_PERSONALITY_INFO,
  COMPETITIVE_LEVEL_LABELS,
  EDUCATION_LEVEL_LABELS,
} from "@/lib/onboarding-options";
import { PageHeader } from "@/components/layout/page-header";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Your profile" };

/** `74` -> `6'2"`. Nobody reads their own height in inches. */
function formatHeight(inches?: number): string | undefined {
  if (typeof inches !== "number" || !Number.isFinite(inches)) return undefined;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * BRD 7.1 FR3: "persist profile data so it can be edited later and is
 * available to every other module".
 *
 * Lives under `(app)` so it inherits the shell's auth + onboarding-complete
 * gate and the bottom nav - the six nav tabs are fixed by BRD v1.1 §4, so
 * the entry point is the header, not a seventh tab.
 */
export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const profile = await getProfileByUserId(new ObjectId(session.user.id));
  if (!profile) {
    redirect("/onboarding");
  }

  // Hydrates the same form the wizard fills in. `undefined` is deliberate
  // for genuinely-absent values so the field renders empty rather than
  // showing a fabricated default the player never chose.
  const defaultValues: FormInput = {
    displayName: profile.displayName ?? session.user.name ?? "",
    dateOfBirth: profile.consent?.dateOfBirth,
    heightInches: profile.heightInches,
    weightLbs: profile.weightLbs,
    educationLevel: profile.educationLevel,
    expectedGraduationYear: profile.expectedGraduationYear,
    position: profile.position as FormInput["position"],
    competitiveLevel: profile.competitiveLevel,
    onTeam: profile.onTeam ?? false,
    teamName: profile.teamName ?? "",
    teamLevel: profile.teamLevel ?? "",
    roleOnTeam: profile.roleOnTeam ?? "",
    primaryGoal: profile.primaryGoal ?? "",
    focusAreas: profile.focusAreas,
    gamesPerWeek: profile.gamesPerWeek,
    practiceFrequencyPerWeek: profile.practiceFrequencyPerWeek,
    equipment: profile.equipment,
    coachPersonality: profile.coachPersonality,
    parentalConsentGiven: profile.consent?.parentalConsentGiven ?? false,
  } as FormInput;

  const displayName =
    profile.displayName ?? session.user.name ?? session.user.email ?? "Player";
  const age = resolveProfileAge(profile);

  // Only facts the player actually gave us. A profile written before a field
  // existed shows three tiles rather than a tile reading "-".
  const facts = [
    { label: "Age", value: age ? String(age) : undefined },
    { label: "Height", value: formatHeight(profile.heightInches) },
    {
      label: "Weight",
      value: profile.weightLbs ? `${profile.weightLbs} lb` : undefined,
    },
    {
      label: "Class of",
      value: profile.expectedGraduationYear
        ? String(profile.expectedGraduationYear)
        : undefined,
    },
  ].filter((fact): fact is { label: string; value: string } =>
    Boolean(fact.value),
  );

  // De-duplicated: education level and competitive level are different
  // questions that very often have the same answer ("High School"), and two
  // identical chips side by side reads as a bug.
  const tags = [
    ...new Set(
      [
        profile.position,
        profile.competitiveLevel
          ? COMPETITIVE_LEVEL_LABELS[profile.competitiveLevel]
          : undefined,
        profile.educationLevel
          ? EDUCATION_LEVEL_LABELS[profile.educationLevel]
          : undefined,
        profile.onTeam ? profile.teamName : undefined,
      ].filter((tag): tag is string => Boolean(tag)),
    ),
  ];

  const coachStyle = profile.coachPersonality
    ? COACH_PERSONALITY_INFO[profile.coachPersonality]?.label
    : undefined;

  return (
    // Narrower than the shell's desktop measure: this is a form, and a text
    // input stretched across 1200px is a worse target than a short one.
    <div className="space-y-4 lg:max-w-3xl">
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="These answers drive your workouts, your feed, and how Coach talks to you."
      />

      {/* The identity card. The screen used to open straight into a form
          field, which gave a player no sense of whose profile they were
          looking at or what the app currently believes about them. */}
      <Card className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="bg-brand/10 pointer-events-none absolute -top-24 -right-20 size-64 rounded-full blur-3xl"
        />

        <CardContent className="flex items-center gap-4">
          <AvatarUpload
            displayName={displayName}
            avatarUrl={profile.avatarUrl}
            providerImageUrl={session.user.image ?? undefined}
          />

          <div className="min-w-0 flex-1">
            <h2 className="font-heading truncate text-xl leading-tight font-bold tracking-tight">
              {displayName}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag, index) => (
                <Badge key={tag} variant={index === 0 ? "brand" : "outline"}>
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>

        {facts.length > 0 && (
          <CardContent>
            {/* gap-px over a border-coloured ground: hairline dividers that
                survive the grid wrapping to two columns on a phone. */}
            <dl className="bg-border/70 ring-border/70 grid grid-cols-2 gap-px overflow-hidden rounded-xl ring-1 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label} className="bg-card px-3.5 py-3">
                  <dd className="tabular font-heading text-lg leading-none font-bold tracking-tight">
                    {fact.value}
                  </dd>
                  <dt className="text-muted-foreground mt-1.5 text-[0.6875rem] font-medium">
                    {fact.label}
                  </dt>
                </div>
              ))}
            </dl>
          </CardContent>
        )}

        {coachStyle && (
          <CardContent>
            <p className="text-muted-foreground text-xs">
              Coach is currently set to{" "}
              <span className="text-foreground font-semibold">
                {coachStyle}
              </span>
              .
            </p>
          </CardContent>
        )}
      </Card>

      <NotificationPreferencesForm
        preferences={profile.notificationPreferences}
      />

      <ProfileForm
        defaultValues={defaultValues}
        consentAlreadyGiven={Boolean(profile.consent?.parentalConsentGiven)}
      />
    </div>
  );
}
