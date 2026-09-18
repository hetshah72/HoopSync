"use client";

import { Check } from "lucide-react";

import { HoopSyncWordmark } from "@/components/brand/hoopsync-mark";
import { Progress } from "@/components/ui/progress";
import { cn } from "cn";

/**
 * The frame the onboarding wizard renders inside - the same split the auth
 * screens use, so signing up and setting up read as one continuous flow.
 *
 * The dark panel carries the step rail rather than marketing copy: once a
 * player is in the wizard, the useful thing to show them is how much is left.
 * Its labels are deliberately shorter than the step headings ("Basics" vs
 * "The basics") so a heading is never duplicated on screen.
 */
export function OnboardingShell({
  steps,
  currentIndex,
  children,
}: {
  /** Short rail labels, in order. */
  steps: string[];
  currentIndex: number;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[20rem_1fr]">
      <StepRail steps={steps} currentIndex={currentIndex} />

      <main className="flex flex-col items-center px-6 py-10 sm:px-10 lg:justify-center lg:py-16">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <HoopSyncWordmark />
          </div>

          {/* The one authoritative progress readout: rendered once, at every
              width, so it can't drift between the mobile and desktop views. */}
          <div className="mb-8 space-y-2">
            <Progress value={((currentIndex + 1) / steps.length) * 100} />
            <p className="text-xs text-muted-foreground">
              Step {currentIndex + 1} of {steps.length}
            </p>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}

function StepRail({
  steps,
  currentIndex,
}: {
  steps: string[];
  currentIndex: number;
}) {
  return (
    // `dark` scopes the design system's dark palette to this panel, the same
    // way the auth screens' brand panel does, so the two match without either
    // of them hard-coding a colour.
    <div className="dark relative hidden overflow-hidden bg-background p-10 text-foreground lg:flex lg:flex-col lg:justify-between">
      <div
        aria-hidden
        className="absolute -top-40 -left-32 size-[26rem] rounded-full bg-brand/20 blur-[120px]"
      />

      <div className="relative">
        <HoopSyncWordmark />
      </div>

      <ol className="relative space-y-1">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                current && "bg-accent text-foreground",
                !current && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-medium",
                  done && "border-brand bg-brand text-brand-foreground",
                  current && "border-brand text-brand-ink",
                  !done && !current && "border-border text-muted-foreground/70",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              {step}
            </li>
          );
        })}
      </ol>

      <p className="relative text-xs text-muted-foreground/70">
        Your answers shape every workout, drill and Coach reply from here on.
      </p>
    </div>
  );
}
