import type { CoachPersonality } from "@/types/db";

export interface CoachPersonalityOption {
  id: CoachPersonality;
  label: string;
  description: string;
}

export const COACH_PERSONALITIES: CoachPersonalityOption[] = [
  {
    id: "encouraging",
    label: "Encouraging",
    description: "Warm and positive - leads with what's working before what to fix.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Friendly and even-handed - a mix of encouragement and direct feedback.",
  },
  {
    id: "direct",
    label: "Direct",
    description: "No fluff - short, blunt, gets straight to the fix.",
  },
  {
    id: "elite_trainer",
    label: "Elite Trainer",
    description: "High-performance register - technical, demanding, pro-level standard.",
  },
];

export function personalityLabel(id: CoachPersonality): string {
  return COACH_PERSONALITIES.find((p) => p.id === id)?.label ?? id;
}
