/** A hairline rule with a label, separating the two ways in. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[0.7rem] font-medium tracking-[0.14em] text-muted-foreground/80 uppercase">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
