import { cn } from "cn"

/**
 * A travelling sheen rather than a pulse. A pulsing block reads as "broken and
 * blinking"; a sheen reads as "loading", and it survives being stacked - ten
 * pulsing rows all dim in unison, which looks like a rendering fault.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-shimmer rounded-lg bg-muted bg-[size:200%_100%] bg-linear-to-r from-muted via-[color-mix(in_oklab,var(--muted),var(--card)_70%)] to-muted",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
