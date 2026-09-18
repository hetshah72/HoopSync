import { HoopSyncMark, HoopSyncWordmark } from "@/components/brand/hoopsync-mark";

/**
 * The frame both auth screens sit in: a dark brand panel on the left at
 * desktop widths, the form on the right.
 *
 * The brand panel is always dark regardless of theme - it's a fixed brand
 * surface, not a themed one - while the form side uses the normal tokens so
 * it matches the rest of the app in either mode. Below `lg` the panel is
 * dropped entirely and the form gets the full width with a compact wordmark
 * above it, since the audience is overwhelmingly on phones and a decorative
 * half-screen there would just push the fields below the fold.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />
      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[22rem]">
          <div className="mb-8 lg:hidden">
            <HoopSyncWordmark />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** What a player gets, stated as the three things the app actually does. */
const PROOF_POINTS = [
  "Daily workouts built around your goals, position and equipment",
  "Log every shot as you take it and see exactly where you score from",
  "A coach that reads your real session numbers, not generic advice",
];

function BrandPanel() {
  return (
    // `dark` rather than hard-coded near-blacks: inside it every token below
    // resolves to the design system's dark palette, so this panel stays a
    // fixed dark surface in either theme without inventing its own colours.
    <div className="dark relative hidden overflow-hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
      <CourtLines />

      {/* A warm wash from the corner, so the panel reads as lit rather than
          flat black. */}
      <div
        aria-hidden
        className="absolute -top-40 -left-32 size-[28rem] rounded-full bg-brand/20 blur-[120px]"
      />

      <div className="relative">
        <HoopSyncWordmark />
      </div>

      <div className="relative max-w-lg">
        <h1 className="text-4xl leading-[1.1] font-semibold text-balance">
          Your always-available virtual basketball trainer.
        </h1>
        <ul className="mt-8 space-y-4">
          {PROOF_POINTS.map((point) => (
            <li
              key={point}
              className="flex gap-3 text-sm text-muted-foreground"
            >
              <HoopSyncMark className="mt-0.5 size-4 shrink-0 text-brand" />
              <span className="text-pretty">{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-muted-foreground/70">
        Built for players who train on their own.
      </p>
    </div>
  );
}

/** Half-court geometry, barely there - depth without a photograph. */
function CourtLines() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      className="pointer-events-none absolute -right-24 -bottom-24 size-[32rem] text-white/[0.07]"
    >
      <circle cx="200" cy="200" r="56" />
      <rect x="144" y="200" width="112" height="150" />
      <path d="M40 350a160 160 0 0 1 320 0" />
      <path d="M40 350h320" />
    </svg>
  );
}
