import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A native <select> wearing the app's field styling.
 *
 * Deliberately not the Base UI `Select` from `ui/select.tsx`: the filters that
 * use this sit inside URL-driven server-rendered <form>s that must work with
 * JavaScript off, and a native control also gets the platform picker on a
 * phone - which is the better experience for a 30-item team list anyway.
 *
 * `appearance-none` plus our own chevron is what makes it stop looking like a
 * 1998 form control; the wrapper is `relative` so the chevron can sit over the
 * field without stealing the click (`pointer-events-none`).
 */
export function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0 flex-1">
      <select
        data-slot="native-select"
        className={cn(
          "h-10 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-card py-1 pr-9 pl-3 text-sm font-medium shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 dark:bg-input/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
