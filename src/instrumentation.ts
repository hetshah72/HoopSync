import type { Instrumentation } from "next";

/**
 * Page and Server Action errors, into the same stream as everything else.
 *
 * `withErrorHandling` (`src/server/http.ts`) already logs unhandled Route
 * Handler errors. Nothing was doing the same for a Server Component render or
 * a Server Action, so a page that threw left only Next's own stderr line - and
 * the `digest` the error screens now print had nothing structured to match
 * against.
 *
 * The logger is imported lazily rather than at module scope. Every file under
 * `src/server/**` starts with `import "server-only"`, whose default export is a
 * bare throw outside Next's "react-server" resolution condition, and
 * instrumentation is not guaranteed to be compiled under it (the same trap
 * CLAUDE.md documents for `scripts/db/**`). Importing inside the handler keeps
 * a resolution failure from taking the whole server down at boot, and costs one
 * cached dynamic import on a path that only runs when something already broke.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  /**
   * React may have re-wrapped the original throw during RSC rendering, so the
   * digest - not the message - is what ties this line to the reference code
   * shown on the error screen.
   */
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest?: unknown }).digest)
      : undefined;

  try {
    const { logger } = await import("@/server/logger");
    logger.error(
      {
        err,
        digest,
        path: request.path,
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      "Unhandled error during render",
    );
  } catch {
    // Logging must never be the reason a request fails, and this runs while
    // the app is already in a bad state - so a logger that won't load falls
    // back to stderr rather than throwing on top of the original error.
    console.error("[instrumentation] render error", { digest, err });
  }
};
