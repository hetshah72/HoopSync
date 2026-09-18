"use client";

import { TriangleAlert } from "lucide-react";

import { ErrorState } from "@/components/layout/error-state";
import "./globals.css";

/**
 * This replaces the root layout, so it is what renders when the root layout
 * itself throws.
 *
 * It inherits nothing from `app/layout.tsx` - not the <html>/<body>, not the
 * stylesheet, not the `next/font` variables. The stylesheet is imported above.
 * The font variables get plain fallback stacks inline rather than re-running
 * `next/font`, for two reasons: `--font-sans` in globals.css resolves to
 * `var(--font-geist-sans)`, and leaving that undefined drops the whole page to
 * the browser's default serif; and a page that only renders when the app is
 * already broken shouldn't additionally be waiting on a font download.
 *
 * The retry control is a bare <button> rather than our <Button>: this page
 * should pull in as little as possible, and `Button` drags in @base-ui/react.
 * The classes below are `buttonVariants({ variant: "brand" })` flattened by
 * hand - if the brand button changes this won't follow, and that is the trade.
 *
 * `metadata` isn't supported in a Client Component, so the title is React's
 * <title> element.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={
        {
          "--font-geist-sans":
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          "--font-geist-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
          "--font-display":
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        } as React.CSSProperties
      }
    >
      <body className="flex min-h-full flex-col">
        <title>Something went wrong - HoopSync</title>
        <main className="ambient-canvas flex flex-1 items-center justify-center px-4 py-16">
          <ErrorState
            className="bg-card w-full max-w-md"
            icon={TriangleAlert}
            title="HoopSync couldn't start"
            description="The app failed before it could draw anything. Reloading usually clears it."
            digest={error.digest}
            actions={
              <button
                type="button"
                onClick={() => retry()}
                className="bg-brand-strong text-brand-foreground inline-flex h-10 shrink-0 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm"
              >
                Try again
              </button>
            }
          />
        </main>
      </body>
    </html>
  );
}
