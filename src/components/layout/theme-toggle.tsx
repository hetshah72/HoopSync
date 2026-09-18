"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";

const OPTIONS = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "system", label: "Match system theme", icon: Monitor },
] as const;

/**
 * Theme controls, in the two shapes the two chromes have room for.
 *
 * Both wait for mount before rendering live state. The server has no idea
 * which theme the browser resolved, so rendering the real value on the first
 * pass is a guaranteed hydration mismatch; they render an inert placeholder of
 * the same size instead, which also means no layout shift when it arrives.
 *
 * Accessible names are spelled out ("Light theme", not "Light") so they can't
 * collide with the onboarding chips that use those bare words.
 */

/** Three-state segmented control, for the desktop rail's footer. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl border border-border/70 bg-muted p-1 shadow-[inset_0_1px_2px_0_var(--shadow-weak)]",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={mounted ? active : undefined}
            onClick={() => setTheme(value)}
            className={cn(
              "press inline-flex size-7 items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "border border-border/60 bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Single icon button that flips between light and dark, for the phone header
 * where a three-way control would crowd out the brand lockup.
 *
 * It switches on `resolvedTheme`, so a player still on "system" gets the
 * opposite of what they are actually looking at rather than of the word
 * "system".
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "press relative inline-flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {/* Both icons are always mounted and cross-faded, so the control never
          reflows and there is nothing to swap in after hydration. */}
      <Sun
        aria-hidden
        className={cn(
          "size-[1.05rem] transition-all duration-300",
          isDark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0",
        )}
      />
      <Moon
        aria-hidden
        className={cn(
          "absolute size-[1.05rem] transition-all duration-300",
          isDark ? "scale-100 rotate-0" : "scale-0 -rotate-90 opacity-0",
        )}
      />
    </button>
  );
}
