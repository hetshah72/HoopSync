import { ObjectId } from "mongodb";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import {
  getProfileByUserId,
  isOnboardingComplete,
} from "@/server/services/profileService";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const profile = await getProfileByUserId(new ObjectId(session.user.id));
  if (isOnboardingComplete(profile)) {
    redirect("/home");
  }

  return (
    <OnboardingWizard
      userId={session.user.id}
      sessionName={session.user.name}
    />
  );
}
