import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * Every screen in the app used to open straight into a control - a search box,
 * a form, a tab strip - with nothing naming the place you had just navigated
 * to. The eyebrow/title pair gives each destination an identity and gives the
 * scroll somewhere to start.
 *
 * The eyebrow is the only place ember type is allowed at small sizes; it is a
 * category label, never a sentence.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  back,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Sub-pages that aren't a nav destination get a way back to their parent. */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header className={cn("mb-5 flex items-start gap-3", className)}>
      {back && (
        <Link
          href={back.href}
          aria-label={back.label}
          className={buttonVariants({
            variant: "outline",
            size: "icon",
            className: "mt-0.5 shrink-0 rounded-full",
          })}
        >
          <ArrowLeft className="size-4" />
        </Link>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {eyebrow && (
          <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-brand-ink uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="font-heading text-[1.625rem] leading-tight font-bold tracking-tight text-balance">
          {title}
        </h1>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </header>
  );
}

/** The rule-and-label divider between groups of cards within a screen. */
export function SectionHeading({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 font-heading text-sm font-semibold tracking-tight">
        {title}
        {count !== undefined && (
          <span className="tabular rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}
