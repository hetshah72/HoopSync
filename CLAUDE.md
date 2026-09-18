@AGENTS.md

# HoopSync

AI-powered basketball development platform for youth/teen players (Next.js App Router + TypeScript + MongoDB). Requirements: `docs/HoopSync_BRD_v1.0.md` (original, historical baseline - do not edit) and `docs/HoopSync_BRD_v1.1.md` (**current source of truth for MVP scope** - clarified after founder review). Architecture: `docs/implementation-plan.md` (see its §16 addendum for how v1.1 changed it).

## Navigation & Analyze (don't get this wrong)

Bottom nav is exactly: **Home | Train | Players | Analyze | Coach | Progress**. Goals lives *inside* Progress, not as its own tab. So do Achievements — Progress has exactly three tabs: **Overview | Goals | Achievements**.

**Analyze is a standalone top-level section**, not a Coach feature. It contains two entry points - Shooting Session and Game Film - each with its own results view. Coach is reached only afterward, optionally, via "Share With Coach." Never route shot/game-footage analysis through Coach.

## Layering rule (don't skip layers)

```
app/**  (routes, Server/Client Components)  ->  never touches MongoDB directly
  -> server/actions/** or app/api/**/route.ts
    -> server/services/**   (business logic)
      -> server/repositories/**  (the only code that knows MongoDB query/collection shape)
        -> server/db/**  (driver client + typed collection getters)
```

- Every file under `src/server/**` starts with `import "server-only"` - an accidental import from a Client Component fails the build, not at runtime.
- `src/lib/**` is isomorphic (safe on client and server) - Zod schemas live here so client forms and server validation share one definition.
- Mutations: **Server Actions** (`src/server/actions/**`) for simple page-scoped form submits; **Route Handlers** (`app/api/**/route.ts`) for anything a client hook fetches/polls (React Query), file-upload URL issuance, or external sync jobs.
- Route handlers/services throw `AppError` subclasses (`src/server/errors.ts`); wrap handlers with `withErrorHandling` (`src/server/http.ts`) for a consistent JSON error shape.

## Commands

```
npm run dev          # start the dev server
npm run build         # production build
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run test           # vitest (unit + integration)
npm run test:watch    # vitest watch mode
npm run test:e2e       # playwright
npm run format         # prettier --write .
npm run db:init        # create collections/validators/indexes (safe to re-run)
npm run db:seed        # idempotent dev/test sample data (safe to re-run)
npm run db:sync-roster # pull the current NBA roster from balldontlie (safe to re-run)
```

All three require `MONGODB_URI` in `.env.local` (copy from `.env.example`). `db:sync-roster` also needs `BALLDONTLIE_API_KEY`.

Scripts under `scripts/db/**` **cannot import `@/server/**`** - those files start with `import "server-only"`, whose default export throws outside Next's `react-server` condition, and `tsx` doesn't set one. Logic a script and a service both need goes in `src/lib/**` (see `src/lib/nba-roster.ts`, shared by `db:sync-roster` and `nbaPlayerService`).

## Data model

Collection shapes live in `src/types/db.ts`; collection name constants (shared by the app and by `scripts/db/*`) live in `src/lib/db-constants.ts`. NBA player roster/bio data comes from the balldontlie.io sync, not hand-seeded - `scripts/db/seed.ts` seeds only hand-authored *editorial* content (Learn/Skills/Signature Moves) for a marquee tier, and the sync adopts those records by name. Roster sync never writes `editorial`.

## NBA Player Mode: authored vs archetype (read before touching player content)

BRD 7.4 requires **every** profile across the full ~570-player roster to carry at least one Signature Move with a matching drill. Hand-authoring that is impossible, so coverage comes from authored **archetype packs** (`src/lib/player-archetypes.ts`): a player is deterministically classified by position + height into one of seven role profiles.

`playerEditorialService.resolvePlayerEditorial()` resolves **per section** - hand-authored content always wins, archetype content only fills gaps - and reports `provenance` plus per-section `sources`.

The rule that matters: **archetype content describes a role, never the individual.** It must be labeled in the UI as a coaching profile, never presented as film study of a named player or as NBA statistics - the same honesty bar as simulated analysis below. Never synthesize biographical or career claims about a real person from an archetype. Anything derived from an archetype must not be fed into logic that treats it as a statement about that specific player (see the `sources.signatureMoves === "authored"` gate in `generateWorkoutFromPlayer`).

Player imagery is a generated card unless `playerImageUrl` is set; never scrape images (BRD 7.4). Study-clip footage stays a labeled placeholder until a league licence exists (BRD 6.4/7.14).

## Achievements / XP (BRD 7.13) - derived, and deliberately quiet

XP and unlock state are **derived, never stored**. `src/lib/training-xp.ts` and `src/lib/achievements.ts` are pure functions over counters `userStats` already keeps. The `achievements` collection stores *only* the date a criterion was first observed met - **a missing row means "no date recorded", never "locked"**. Don't add a stored XP counter; the whole point is that it cannot drift and that past training counts retroactively.

Say **tier**, never "level" - `EducationLevel` and `CompetitiveLevel` already mean something else here. Tier names describe training commitment, never playing ability.

A **skill achievement is a volume award** ("Shooting Reps: 25"), never a rating - same honesty bar as `skill-metrics.ts`. `tests/unit/achievements.test.ts` fails the build if catalog copy reintroduces rating language.

Thresholds for workouts/streak/sessions come from `MILESTONE_THRESHOLDS` in `src/lib/notification-types.ts` so BRD 7.13 and 7.15 can't drift apart; a unit test enforces it. Rows stamped by an account's first-ever evaluation are marked `backfilled` and excluded from the feed card and toast - announcing a milestone passed months ago would be false about *when*.

Founder guidance is a hard constraint: gamification must never be more prominent than the coaching value. Achievements is the last tab, the last feed card, and a secondary toast. Don't promote it.

## AI/video analysis

Shot make/miss/location is **not** simulated - it comes from the player's own manual tap-to-log input during/after recording (real data, no CV). The deeper mechanical narrative ("why did you miss") is still generated, behind `ShotMechanicalAnalysisProvider`.

**Game Film analysis is real when it can be.** `GameFootageAnalysisProvider` has two implementations, and which one ran is recorded on the document as `provenance`, never assumed by the caller:

- `VisionGameFootageAnalysisProvider` - the browser samples ~12 stills from the clip before upload (`src/lib/extract-video-frames.ts`, so the server never decodes video and needs no ffmpeg), a vision model reads them, and the findings plus timestamped `events` come back from the footage itself.
- `SimulatedGameFootageAnalysisProvider` - the fallback when no model is configured, the browser couldn't decode the clip, or the vision pass fails. `analyzeWithBestProvider` degrades to it rather than failing.

The honesty rule now cuts two ways, and all four surfaces (report, upload form, Coach context, Coach opener) read their wording from one place, `src/lib/game-film-provenance.ts`:

- **Vision findings** may describe the footage, but are labeled as a fallible AI read - never as measurement (BRD 7.6).
- **Heuristic findings** must never imply anything was watched. Their copy in `game-film-templates.ts` is written as a *coaching profile* ("closing out flat is the breakdown that most often lets shooters past"), never as observation ("you closed out flat"). Same rule as NBA archetypes: describes a pattern, not the individual.

Two invariants worth keeping: an `event` is dropped unless its timestamp matches a frame actually sent (a hallucinated moment renders as a seekable point in the player's own video), and the heuristic path writes `events: []` rather than inventing times. A game clip has ten players in it, so the upload asks for jersey colour/number - without it the model is told to refuse rather than analyse a stranger.

Don't special-case "simulated mode" logic outside the provider implementation.

## Acceptance bar for the MVP loop

A reviewer should be able to go end-to-end with zero dead buttons: onboard -> Home feed -> study an NBA player -> generate & complete a workout -> Progress updates -> record + tap-log a shooting session in Analyze -> tap a shot for its exact replay and feedback -> Share With Coach -> Coach demonstrably references that session's real numbers -> train again -> Progress updates again -> Feed reflects the new activity. Full acceptance criteria: `docs/HoopSync_BRD_v1.1.md` §6-§8.
