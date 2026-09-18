import { Button } from "@/components/ui/button";

/**
 * The Google button, including Google's own mark.
 *
 * Presentational only - it's a plain submit button, so the page can wrap it
 * in the `<form action={serverAction}>` that actually calls `signIn`, and the
 * OAuth hand-off still works with JavaScript disabled.
 */
export function GoogleButton({ label }: { label: string }) {
  return (
    <Button
      type="submit"
      variant="outline"
      className="h-11 w-full gap-3 rounded-xl border-border bg-card text-[0.95rem] font-medium shadow-xs transition-shadow hover:bg-muted/60 hover:shadow-sm"
    >
      <GoogleG />
      {label}
    </Button>
  );
}

/** Google's four-colour "G", per their branding guidelines for sign-in. */
function GoogleG() {
  return (
    <svg viewBox="0 0 18 18" className="size-[1.125rem]" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
