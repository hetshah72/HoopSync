"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Wraps the app in `next-themes`, which writes `class="dark"` onto <html> -
 * the hook `@custom-variant dark (&:is(.dark *))` in globals.css is keyed to.
 *
 * `defaultTheme="system"` means a first-time visitor gets whatever their OS is
 * set to and never sees a theme they didn't ask for. The choice is only
 * persisted once they actually pick one.
 *
 * `disableTransitionOnChange` suppresses our own colour transitions for the
 * one frame the class flips; without it every bordered surface on the page
 * animates its colour separately and the switch looks like a fault.
 *
 * next-themes injects a blocking inline script so the class is on <html>
 * before first paint - which is why <html> carries `suppressHydrationWarning`
 * in the root layout. Without that React flags the server/client mismatch the
 * script deliberately creates.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
