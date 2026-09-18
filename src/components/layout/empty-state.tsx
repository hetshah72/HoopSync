import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The app was full of empty states rendered as a grey paragraph in a bare
 * card, which reads as a system message rather than an invitation. This gives
 * the zero state the same care as the populated one: a framed icon, a short
 * headline, the explanation underneath, and - where there is one - the action
 * that resolves it.
 *
 * The icon tile is decorative; the headline carries the meaning, so the icon
 * is hidden from assistive tech rather than labelled.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-foreground ring-1 ring-brand/15"
      >
        <Icon className="size-5" />
      </span>
      <h3 className="font-heading text-base font-semibold tracking-tight">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
