import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MediaDisclosure } from "@/lib/media-provenance";

/**
 * The one way a disclosure reaches the screen (BRD 7.14 / 6.4).
 *
 * Every surface that plays content renders this, so the label is always
 * derived from the asset rather than typed beside it. The chip variant exists
 * because a poster frame on the feed needs the source visible *on the frame* -
 * an unlabelled still of placeholder footage is exactly the thing BRD 6.4's
 * "clearly labeled" clause forbids, and the feed's one media-bearing card is
 * a placeholder today, so that is the shipping case rather than a hypothetical.
 */
export function MediaSourceChip({
  disclosure,
  className,
}: {
  disclosure: MediaDisclosure;
  className?: string;
}) {
  return (
    <Badge
      variant={disclosure.isPlaceholder ? "warning" : "secondary"}
      className={cn("text-[0.6875rem] font-medium", className)}
    >
      {disclosure.sourceLabel}
    </Badge>
  );
}

/**
 * The full disclosure: the sentence, plus a credit line when one is owed.
 * Renders nothing when the content speaks for itself (a player's own upload
 * needs no disclaimer and no "courtesy of" line).
 */
export function MediaDisclosureNote({
  disclosure,
  className,
}: {
  disclosure: MediaDisclosure;
  className?: string;
}) {
  if (!disclosure.note && !disclosure.attribution) return null;

  return (
    <p className={cn("text-xs italic text-muted-foreground", className)}>
      {disclosure.note}
      {disclosure.note && disclosure.attribution ? " " : null}
      {disclosure.attribution ? (
        <span className="not-italic">{disclosure.attribution}</span>
      ) : null}
    </p>
  );
}
