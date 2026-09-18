# HoopSync — Implementation Plan (Architecture & Setup)

## Context

HoopSync is a greenfield, production-quality full-stack web app (Next.js + TypeScript + MongoDB) implementing the features defined in the HoopSync Business Requirements Document (BRD, v1.0, Sept 7 2026). `d:\hoopsync` is currently empty — this is a from-scratch build, not a refactor.

The BRD is deliberately business-focused and explicitly defers technical architecture, data model, and stack decisions to this stage (BRD §1, §15). The founders face a real external deadline: a professional league requires a working MVP submitted Sept 14–Oct 16, 2026, and the MVP must **not** depend on unlicensed league footage or real computer-vision technology that hasn't been selected yet (BRD §6.4, §12). This plan turns the BRD's ~15 features into a concrete, incrementally-buildable architecture, with the AI/video-analysis pieces built behind swappable interfaces so placeholder logic today can be replaced by real providers later without reshaping the app.

Four architecturally-blocking decisions were confirmed with the user before finalizing this plan:
1. **Video AI analysis (shot detection, mechanics, game events):** simulated provider now, behind a swappable `AnalysisProvider` interface — not real computer vision.
2. **LLM provider (Coach chat + generated text):** OpenAI API.
3. **Video/object storage:** Google Cloud Storage.
4. **NBA player factual data:** balldontlie.io free API (roster/bio fields only; signature moves/"Learn" content are HoopSync editorial content seeded in MongoDB).

Everything else below (auth provider scope, ORM choice, workout-generation logic, hosting target, job-processing approach) is a reasonable engineering default, called out explicitly as an **assumption** so it can be challenged before implementation starts.

---

## 1. Requirements & Major Features (from BRD, scoped for this build)

**MVP (build now), mapped to BRD §6.1/§7:**
- Onboarding (progressive profile capture)
- Home / personalized feed
- Train / Workouts (generated from skill or "player-inspired" input)
- NBA Player Mode (searchable roster, Learn/Skills/Bio tabs, Signature Moves → drill)
- Shot Tracker (shot chart, make/miss, individual replay, session analysis)
- AI Shooting Analysis (basic — observation→issue→correction→drill feedback)
- Game Footage Analysis (basic upload + strengths/weaknesses/recommendations)
- Share With Coach (context hand-off)
- AI Coach (chat, personality settings: Encouraging/Balanced/Direct/Elite Trainer)
- Confidence / Mental Game (pre-game check-in, post-game recovery plan)
- Progress (workouts, streak, skill trends, session history)
- Goals (concrete targets, auto-tracked from activity)
- Fully connected state — no dead buttons, real cross-module data flow (BRD §11.2)

**Explicitly deferred (BRD §6.2/§6.3 "Phase 2" — not built in this pass, but not architecturally blocked either):**
Advanced AI mechanics/film analysis, live/real-time Coach, ~1,000-drill library, admin dashboard, payments/billing, Apple Sign-In. *(Achievements/XP has since been built — see §17. Notifications has since been built.)*

---

## 2. Key Assumptions (please flag any you want changed)

| # | Assumption | Rationale |
|---|---|---|
| A1 | Web app (responsive, installable as a PWA), not a native iOS/Android app | User explicitly requested Next.js; BRD flow language ("download/open app") implied mobile, but tech stack decision supersedes that |
| A2 | Auth: Google OAuth + email/password for MVP; Apple Sign-In deferred | Apple requires a paid developer account + extra setup; BRD lists Apple/email as "alternatives" not required for MVP. **Revised P0.10:** the email alternative is now name/email/password rather than a magic link — it needs no transactional-email vendor to work at all, it captures BRD 7.1's "name" at account creation rather than deferring it to onboarding, and it removed the dev-only passwordless bypass that was the only sign-in working in this environment |
| A3 | MongoDB access via the official native driver + Zod schemas, not Mongoose | Avoids duplicating schema definitions (Zod already covers validation + TS types); keeps one source of truth |
| A4 | "Generated" workouts (BRD §7.3) = rule-based assembly from a tagged drill library (skill/player tendency + difficulty progression), optionally enriched with OpenAI-generated coaching notes — not a fully LLM-authored workout | Deterministic, testable, cheap; matches BRD's actual bar ("not a random pre-built workout") without requiring per-workout LLM calls |
| A5 | Hosting target: Vercel (Next.js app) + MongoDB Atlas (already being provided) + Google Cloud Storage bucket | Standard, low-friction pairing for this stack |
| A6 | Simulated video analysis runs in-process (async, with a `jobs` status pattern) rather than a dedicated queue (BullMQ/Cloud Tasks) | Fast enough for simulated work; a real durable queue becomes necessary once real CV is plugged in — flagged as a Phase-2 infra item |
| A7 | COPPA / minors' consent: we build the *mechanism* (DOB capture, parental-consent flag/flow for under-13 users) but do **not** claim legal compliance | BRD §9.4 explicitly flags this as unresolved; needs founder/legal sign-off, not an engineering decision |
| A8 | Single "player" role for MVP + a minimal "admin" role for content management (drills, feed items, NBA player editorial content) | BRD §6.3 explicitly caps admin scope to "what MVP content management needs" |

---

## 3. Next.js Architecture

- **Framework:** Next.js (App Router), React, TypeScript in strict mode.
- **Rendering model:** Server Components by default for data-heavy pages (Home, Progress, Player profile, Goals). Client Components only where interactivity requires it (feed swiper, Active Workout timer, shot-chart canvas, Coach chat window, onboarding form steps).
- **Mutations — two mechanisms, used deliberately, not interchangeably:**
  - **Server Actions** (`'use server'`, colocated under `src/server/actions/`) for simple, page-scoped form mutations: onboarding steps, marking a workout complete, creating a goal, feed like/save.
  - **Route Handlers** (`app/api/**/route.ts`) for anything a client hook needs to fetch/poll/mutate via `fetch` (React Query), for file-upload presigned-URL issuance, and for the NBA-player sync job.
- **Route protection:** `src/proxy.ts` (Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`; it defaults to the Node.js runtime, which is what makes it possible to reach MongoDB from it if ever needed) guards the authenticated app shell, redirects unauthenticated users to sign-in, and redirects authenticated-but-onboarding-incomplete users to `/onboarding`.

### Frontend/Backend separation (the core rule)

- `src/app/**` and `src/components/**` — presentation only. Never import MongoDB, external API clients, or secrets directly.
- `src/server/**` — all backend logic (db access, business services, external API/LLM/storage clients, auth config). Every file starts with `import 'server-only'` so an accidental client import fails the build, not at runtime.
- `src/lib/**` — pure, isomorphic code safe on both sides: Zod schemas (single source of truth for client-side form validation *and* server-side request validation), formatting helpers, constants.
- Layering inside `src/server/`: **routes/actions → services → repositories → MongoDB driver.** Routes/actions never touch the database directly; they call a service; services contain business rules and call repositories; repositories are the only code that knows MongoDB collection/query shape. This gives each layer one responsibility (SOLID) and makes services unit-testable without a real database.

---

## 4. MongoDB Database Design

Native driver, one database (e.g. `hoopsync`), Zod-validated at the application boundary + light MongoDB `$jsonSchema` validators on the core collections as a second safety net.

| Collection | Purpose | Key fields | Notes |
|---|---|---|---|
| `users` | Auth identity | email, name, image, role, emailVerified | Owned by Auth.js MongoDB adapter |
| `accounts`, `sessions`, `verificationTokens` | Auth.js internals | — | Standard Auth.js adapter collections |
| `playerProfiles` | Domain profile (BRD §7.1) | userId (1:1), physical/school/basketball background, goals, focusAreas[], equipment[], coachPersonality, consent{dob, parentalConsent} | Separate from `users` — auth identity vs. domain profile are different concerns |
| `nbaPlayers` | Player database (BRD §7.4) | externalId (balldontlie), name, team, position, jerseyNumber, height, playerImageUrl, lastSyncedAt, **editorial:** learnContent, skills{}, bio, signatureMoves[] | Synced fields vs. editorial fields clearly separated per-document |
| `drills` | Master drill library | slug, name, skillTags[], difficulty, videoUrl, coachingCues, equipmentNeeded[] | Referenced (not duplicated) by workouts |
| `workouts` | Generated workout instances | userId, source{type, refId}, drills[] (snapshot: drillId, order, sets/reps/duration), status, completedAt | Snapshot embedded so a completed workout's historical content doesn't drift if the drill library changes |
| `shotSessions` | Shot Tracker sessions | userId, videoAssetId, status, shots[] {zone (fixed 9-zone enum — see below), location, made, timestampInVideoSeconds, replayStartSeconds, replayEndSeconds, feedbackText}, zoneBreakdown, bestZone, weakestZone, mechanicalBreakdown {observation, makesVsMisses, potentialIssue, correction, drillId}, recommendedWorkoutId | Shots embedded (bounded array per session, well under doc size limits). **v1.1 revision:** shots are populated by manual tap-to-log (real data), not fabricated — see BRD v1.1 §5. `mechanicalBreakdown` is a session-level generated narrative scoped to `weakestZone`, explicitly labeled as simulated in the UI. Zone values are one of: Top of Key 3, Right Wing 3, Right Mid, Right Corner 3, Left Wing 3, Left Mid, Free-Throw Mid, Paint, Left Corner 3 (BRD v1.1 §6). |
| `gameFootageAnalyses` | Game footage uploads | userId, videoAssetId, status, events[], strengths[], weaknesses[], recommendations[], recommendedWorkoutIds[] | |
| `coachConversations` | Chat metadata | userId, personality, lastMessageAt, contextRefs[] | |
| `coachMessages` | Chat messages | conversationId, role, content, createdAt | Separate collection (not embedded) — chat history can grow unbounded |
| `confidenceCheckins` | Pre/post-game mental-game flow | userId, type, feeling, routine, recoveryPlan{positives, areasToImprove, planSteps, isDataBacked}, relatedSessionId, relatedWorkoutId | One pre-game row per player per day, revised in place; `routine` is snapshotted at the time it was given |
| `goals` | Player goals | userId, type, targetValue, currentValue, unit, status, autoTrackedMetricKey | |
| `userStats` | Denormalized counters | userId (1:1), currentStreak, longestStreak, totalWorkoutsCompleted, lastActivityDate | Updated transactionally on workout/shot/goal-relevant events; avoids recomputing streaks from scratch on every Progress view |
| `feedItems` | Home feed content library | type, title, body, mediaAssetId, tags[], relatedPlayerId?, relatedDrillId? | |
| `feedInteractions` | Like/save/share | userId, feedItemId, action, createdAt | Compound unique index prevents duplicate like spam |
| `dailyQuotes` | Rotating quote | text, author, dateAssigned (unique) | |
| `mediaAssets` | Content provenance | url, type, source: original\|generated\|licensed\|public_domain\|placeholder, licenseNotes, uploadedBy | Directly satisfies BRD §7.14/§11.1 "traceable, legitimate source" success criterion |

**Indexes (representative, not exhaustive):** `playerProfiles.userId` (unique), `nbaPlayers.externalId` (unique) + text index on `name`, `workouts.userId+createdAt`, `shotSessions.userId+recordedAt`, `coachMessages.conversationId+createdAt`, `goals.userId+status`, `feedInteractions.userId+feedItemId` (unique), `userStats.userId` (unique).

### Hosted MongoDB instance — concerns to flag

Since you're providing an existing hosted MongoDB URL as the **development** database:
- **Least privilege:** the DB user in that connection string should be scoped `readWrite` on the `hoopsync` database only, not an admin/cluster-wide user.
- **Network access:** confirm the Atlas IP allowlist isn't `0.0.0.0/0` any longer than necessary for local dev convenience; tighten before anything resembling production traffic touches it.
- **Never run the seed script against a URI you consider production.** The seed script is dev/test data only — plan for a distinct `MONGODB_URI` per environment (dev/preview/prod) via Vercel env vars, not a shared cluster.
- **Backups:** confirm Atlas backup/point-in-time-recovery is enabled even for "dev" if any real user data (e.g. your own testing accounts, uploaded videos) will live there.
- **Secrets hygiene:** the URI (with credentials embedded) goes in `.env.local`/hosting-provider env vars only — never committed, never logged.

---

## 5. API / Server-Side Architecture

- **Route Handlers** grouped by resource under `app/api/`: `profile`, `nba-players` (+ `/sync` admin trigger), `workouts`, `shot-sessions` (+ `/upload-url`), `game-footage` (+ `/upload-url`), `coach/conversations`, `coach/messages`, `goals`, `feed` (+ `/interactions`), `auth/[...nextauth]`. *(Confidence check-ins ship as Server Actions, not a route handler: they are page-scoped form submits with no client polling, which is what the rule in CLAUDE.md calls for.)*
- Every handler: parse & validate input with a Zod schema from `src/lib/validation/`, delegate to a service, return a consistent envelope (`{ data }` or `{ error: { code, message } }`) via a shared `withErrorHandling` wrapper in `src/server/http.ts`.
- **AnalysisProvider abstraction, revised per BRD v1.1 §5:** shot make/miss/location is **not** behind a provider — it comes from the player's real manual tap-to-log input (see §7 Analyze below), so there is no `ShotDetectionProvider`. Only the deeper narrative layer is generated and sits behind a swappable interface:
  ```
  interface ShotMechanicalAnalysisProvider {
    generateMechanicalBreakdown(session: ShotSessionStats): Promise<MechanicalBreakdown>
  }
  interface GameFootageAnalysisProvider {
    analyzeGameFootage(video: MediaAssetRef, profile: PlayerProfile): Promise<GameFootageAnalysisResult>
  }
  ```
  `SimulatedShotMechanicalAnalysisProvider` / `SimulatedGameFootageAnalysisProvider` implement these with deterministic-but-varied generated output (observation → issue → correction → drill), **explicitly labeled as simulated in the UI** — matching the disclosure copy in the founder's reference screenshots.

  **Superseded for Game Film (shipped):** the real provider the paragraph above deferred now exists. `GameFootageAnalysisProvider` is `analyze(input: GameFilmAnalysisInput)` and has two implementations — `VisionGameFootageAnalysisProvider` (a vision model reads stills sampled from the upload, returning findings *and* timestamped `GameEvent`s) and the simulated one as fallback. `analyzeWithBestProvider()` picks between them and degrades rather than failing. Which one ran is persisted as `provenance: "vision_model" | "heuristic"` and is never assumed by a caller; documents predating the field read as `heuristic`.

  Frames are sampled **client-side** (`src/lib/extract-video-frames.ts`: `<video>` + `<canvas>`, ~12 stills at 512px), so no ffmpeg dependency, no server-side video decode, and a few hundred KB uploaded regardless of clip length — the decision that makes this viable on serverless. An event is discarded unless its timestamp matches a frame actually sent, and the heuristic path writes `events: []` rather than inventing any. Because a clip contains ten players, upload collects jersey colour/number; without it the model is instructed to decline rather than analyse a stranger. Disclosure copy for both paths lives in one place, `src/lib/game-film-provenance.ts`, shared by the report, the upload form and both Coach surfaces. Shot mechanical analysis remains simulated-only.
- **Async processing pattern:** applies to the *narrative generation* step (mechanical breakdown, game footage analysis), not shot detection itself (which is synchronous manual tap-to-log with no processing delay). Flow: finalize tap-logged shots / upload game footage → create/update the doc with `status: "processing"` → return immediately → an async task (triggered from the route handler, not blocking the response) runs the provider and updates `status: "completed"` → client polls a `GET .../[id]` status endpoint. **Built for Game Film**, since a multi-frame vision call can't sit inside the upload response: `POST /api/game-footage/upload` stores the clip, opens the `processing` document, returns the id, and runs the analysis in Next's `after()` (hence `maxDuration` on that route — `after` extends the invocation but does not escape its ceiling). `GET /api/game-footage/[analysisId]/status` is the poll, and `game-film-processing.tsx` calls `router.refresh()` when the status moves, so the finished report still renders server-side. Deliberately a small poll rather than React Query — nothing else in the codebase uses it. Shot sessions stay synchronous: there, `processing` means "the player is still tap-logging", not "a job is running". This satisfies the BRD's NFR ("app must never freeze while processing video", loading states) and keeps the swap-to-real-queue path clean (documented as a Phase-2 infra item once real CV work runs long enough to need BullMQ/Cloud Tasks).
- **External integrations**, each behind a thin client in `src/server/external/`: `balldontlieClient.ts` (NBA roster/bio sync), `openaiClient.ts` (Coach chat + generated text), `gcsClient.ts` (signed upload/download URLs for video).

---

## 6. Authentication & Security

- **Auth.js (NextAuth) v5** + `@auth/mongodb-adapter`, **JWT session strategy** (revised during Foundation implementation from the database-session assumption below the table: Next.js middleware historically ran Edge-only, which can't reach MongoDB, so JWT sessions were simpler and more portable; Next.js 16's Node-runtime proxy would now make database sessions workable again, but JWT is unchanged since it works fine and avoids a DB round-trip per navigation).
- **Providers (MVP):** Google OAuth (primary, per BRD) and a Credentials provider for email/password as the "alternative" BRD calls for (A2). Apple deferred. Passwords are hashed with scrypt from Node's standard library (`src/lib/password.ts`, self-describing cost parameters so they can be raised without invalidating existing hashes); accounts are created by a Server Action, never by `authorize`, which only ever checks an existing credential. A unique index on `users.email` — not the service's existence check — is what settles two simultaneous sign-ups for the same address. Auth.js refuses to auto-link a Google sign-in to an existing password account (`OAuthAccountNotLinked`); that stays refused, and the sign-in page explains it rather than silently merging identities.
- **Authorization:** `role` field on `users` (`player` default, `admin` for content management); admin-only routes/actions check role server-side, never trust client state.
- **Input validation:** Zod on every route handler and server action — no unvalidated input reaches a service.
- **File uploads:** signed, short-lived GCS upload URLs issued server-side (never expose GCS credentials to the client); server-side content-type and size-limit checks before issuing the URL.
- **Rate limiting:** a simple per-user limiter (in-memory for dev; Upstash Redis if available) on Coach chat and video-upload endpoints — BRD §10 explicitly ties pricing to AI/compute cost, so uncontrolled usage is a real cost risk even at MVP stage.
- **Secrets:** all via environment variables (see §9), never hard-coded, `.env*` git-ignored.
- **Data protection:** TLS in transit (Atlas `mongodb+srv`), GCS private buckets with signed URLs (not public), user-controlled account/data deletion endpoint (BRD §9.3).
- **Minors/privacy (A7):** DOB + parental-consent capture at onboarding for the mechanism only; explicitly flagged in-app and in this plan as pending legal review, not a compliance guarantee.

---

## 7. Validation & Error Handling

- **Single source of truth:** Zod schemas in `src/lib/validation/*.ts`, shared by React Hook Form (`zodResolver`) on the client and by route handlers/server actions on the server. No duplicated validation logic.
- **Error hierarchy** in `src/server/errors.ts`: `AppError` base, with `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ExternalServiceError` subclasses thrown by services.
- **Centralized mapping:** `withErrorHandling` wrapper catches thrown `AppError`s and maps to the right HTTP status + consistent JSON error shape; unexpected errors are logged (structured, via `pino`) and returned as a generic 500 without leaking internals.
- **Client-side:** React Query surfaces loading/error states for anything fetched via Route Handlers; App Router `error.tsx` boundaries per route segment catch unexpected render-time failures; toast notifications for user-facing errors.
- **External-service failures** (OpenAI, balldontlie, GCS) are wrapped as `ExternalServiceError` with a graceful fallback message — never a raw stack trace to the user.

---

## 8. Testing Strategy

Given the tight external timeline, tests are prioritized where they catch the most regressions per hour spent, not for exhaustive coverage:

- **Unit tests (Vitest):** services and repositories, using `mongodb-memory-server` for repository tests (real MongoDB semantics, no network dependency); Zod schemas; pure utils.
- **Integration tests (Vitest + mongodb-memory-server):** Route Handlers and Server Actions end-to-end against an in-memory Mongo instance and mocked external clients (OpenAI/balldontlie/GCS mocked at the client boundary).
- **Component tests (React Testing Library):** the highest-complexity interactive components — Active Workout screen, Shot Chart, Coach chat.
- **E2E smoke tests (Playwright):** the BRD §11.1 "connected loop" — onboard → Home feed → study a player → generate & complete a workout → record/upload a shot session (simulated analysis) → open Coach with session context → see Progress update. This is the single most important test suite since it directly maps to the league-submission success criterion.
- CI (GitHub Actions) recommended once a git repo exists: lint + typecheck + unit/integration on every push; Playwright smoke suite before any deploy.

---

## 9. Environment Variables (`.env.example`)

```
# App
NODE_ENV=
APP_BASE_URL=

# MongoDB
MONGODB_URI=
MONGODB_DB_NAME=hoopsync

# Auth.js
AUTH_SECRET=
AUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# OpenAI
OPENAI_API_KEY=

# balldontlie (NBA player data)
BALLDONTLIE_API_BASE_URL=https://api.balldontlie.io/v1
BALLDONTLIE_API_KEY=

# Google Cloud Storage
GCS_PROJECT_ID=
GCS_BUCKET_NAME=
GCS_SERVICE_ACCOUNT_KEY_JSON=

# Optional
SENTRY_DSN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Note on GCS credentials: on a serverless host there's no filesystem to point `GOOGLE_APPLICATION_CREDENTIALS` at reliably, so the service-account key is stored as a single JSON-string env var and parsed at client-init time — never as a checked-in key file.

---

## 10. Recommended Libraries

- **Core:** Next.js (App Router), React, TypeScript (strict)
- **DB:** `mongodb` (official driver) — no ODM, per A3
- **Auth:** `next-auth` (Auth.js v5) + `@auth/mongodb-adapter`
- **Validation:** `zod`
- **Forms:** `react-hook-form` + `@hookform/resolvers`
- **Client data:** `@tanstack/react-query`
- **UI:** Tailwind CSS + `shadcn/ui` primitives; `framer-motion` for feed/gesture interactions
- **Client state (small, local):** `zustand` where a form/timer needs shared local state — no Redux
- **LLM:** `openai` SDK
- **Storage:** `@google-cloud/storage`
- **Logging:** `pino`
- **Testing:** `vitest`, `@testing-library/react`, `mongodb-memory-server`, `playwright`
- **Tooling:** ESLint + Prettier, `tsx` (run TS scripts outside Next's runtime), Husky + lint-staged (optional pre-commit gate)

---

## 11. Project / Folder Structure

```
hoopsync/
  .claude/
    settings.json
  .env.example
  CLAUDE.md
  scripts/
    db/
      init.ts            # creates collections, validators, indexes — safe to re-run
      seed.ts             # idempotent sample data (upserts by natural keys)
      lib/connection.ts   # standalone script-only Mongo client
  src/
    app/
      (auth)/sign-in/
      onboarding/
      (app)/                # authenticated shell
        home/
        train/[workoutId]/
        players/[playerId]/
        analyze/shot-tracker/[sessionId]/
        analyze/game-footage/[analysisId]/
        coach/
        progress/
        goals/
      admin/                 # minimal content management
      api/
        profile/ nba-players/ workouts/ shot-sessions/ game-footage/
        coach/ goals/ feed/ confidence/ auth/[...nextauth]/
    proxy.ts                 # Next.js 16 route-protection convention (was middleware.ts)
    components/
      ui/  feed/  workout/  players/  shot-tracker/  coach/  progress/  goals/  onboarding/  layout/
    server/
      db/            # client.ts, collections.ts
      repositories/  # one per collection/domain
      services/      # business logic, AnalysisProvider implementations
      actions/        # 'use server' files
      auth/           # auth.config.ts
      external/       # balldontlieClient, openaiClient, gcsClient
      errors.ts
      http.ts
    lib/
      validation/     # zod schemas (shared client+server)
      constants.ts
      utils.ts
    types/
    hooks/
  tests/
    unit/ integration/ e2e/
```

**Enforced boundary:** every file under `src/server/**` starts with `import 'server-only'`.

---

## 12. Claude Code Workspace Setup

Kept intentionally minimal — no speculative agents/skills beyond what pays for itself immediately:

- **`CLAUDE.md`** (root): project summary, the layering rule (routes/actions → services → repositories → driver), the server/client boundary rule, how to run dev/test/db-init/seed, and a link back to the BRD's success criteria (§11) as the acceptance bar for the MVP loop.
- **`.claude/settings.json`**: allow-list the routine local commands this project will need repeatedly (`npm run dev`, `npm run test`, `npm run db:init`, `npm run db:seed`, `npm run lint`) to cut down on repeated permission prompts.
- No custom subagents or skills proposed up front — if a repetitive scaffolding task emerges once real feature work starts (e.g. "new API resource" boilerplate), it's cheap to add a skill for it then, with a real pattern to codify instead of a guessed one.

---

## 13. Implementation Phases

**Superseded by the re-sequenced P0/P1/P2 plan in `HoopSync_BRD_v1.1.md`'s companion reconciliation (see §16 below).** Summary, in dependency order:

0. **Foundation** *(done)* — Next.js/TS scaffold, Tailwind/shadcn, ESLint/Prettier, folder structure, MongoDB client + `db:init` script, Auth.js (Google + email) + proxy-based route protection, base layout/nav, `.env.example`, README.
1. **Docs & nav restructure (P0.1)** — fix this doc's drift (done in this revision), add BRD v1.0/v1.1, update CLAUDE.md, restructure bottom nav to Home/Train/Players/Analyze/Coach/Progress (Goals nests inside Progress).
2. **Onboarding → Profile (P0.2)** — progressive onboarding (Server Actions), `playerProfiles`.
3. **Home Feed (P0.3)** — seeded `feedItems`/`dailyQuotes`, rule-based personalization (focus areas + weakest zone + goals → tags), all feed actions wired to real mutations.
4. **NBA Player Mode (P0.4)** — balldontlie sync service, editorial content (Learn/Skills/Bio/Signature Moves), Signature Move → drill linkage.
5. **Train/Workouts (P0.5)** — rule-based workout generation service, Active Workout screen wired to Progress/streak/Goals.
6. **Analyze hub + Shooting Session (P0.6)** — Analyze standalone section, manual tap-to-log shot capture, shot chart + exact replay, zone breakdown, mechanical breakdown (simulated, labeled), recommended workout.
7. **Share to Coach + AI Coach (P0.7)** — OpenAI-backed chat, personality system prompts, full-context loading from `contextRefs`.
8. **Connected-state verification (P0.8)** — Playwright smoke suite walking the full founder loop.
8.5. **NBA Player Mode to full BRD 7.4 (P0.9.2)** — P0.4 shipped the slice; this completed it. Authored **archetype packs** (`src/lib/player-archetypes.ts`) give every player on the roster a Signature Move with a matching drill, resolved per-section against hand-authored content by `playerEditorialService` and labeled in the UI as a role profile rather than film study. Roster sync reworked: bulk upserts, 429/`Retry-After` backoff, `npm run db:sync-roster`, and an `ADMIN_EMAILS` allow-list that makes the admin-gated route reachable. Study clip with seeking call-outs; generated player cards with `playerImageUrl` as the licensed-provider swap point. Note `GET /players/active` requires balldontlie's ALL-STAR tier — the free tier cannot express a current roster.
8.6. **Shooting Analysis to full BRD 7.6 (P0.9.3)** — P0.6 shipped the Shooting Report; this completed the *analysis* behind it. The template bank covered four of §7.6's nine required parameters and was picked by a hash of `sessionId:zone` that never read the shot data, so a Paint weakness could be diagnosed as a late wrist load. Now: all nine parameters in `src/lib/shot-mechanics.ts`, selected per parameter and driven by real signals. **Left-vs-right is genuinely measured** — the mirrored `left_*`/`right_*` zones make the split real — and every finding carries a `basis` of `measured` or `simulated` that the UI badges per row rather than blanketing the page. Measured claims are gated at 5 attempts per side and a 20-point gap, citing `MIN_ATTEMPTS_FOR_CALLOUT`'s reasoning that `findBestAndWeakestZones`'s default of 1 is too loose for a standing claim about a player. Reference comparison ships as authored coaching standards (`src/lib/shot-reference-standards.ts`, keyed by parameter × shot type) with `referenceClipUrl` as the licensed-footage swap point — the `playerImageUrl` arrangement again, since BRD 6.4/7.14 forbid league footage before the licence. Shot type is captured as real optional player input at log time, which is what makes "for the same shot type" genuine rather than inferred. Per-shot feedback (`src/lib/shot-feedback.ts`) follows the same four-part structure off the same template bank, generated at finalize where session tallies exist. An OpenAI provider is scaffolded behind the existing interface and selected by `isOpenAiConfigured()`, with two code-enforced guards — numeric grounding, and a banned-phrase list implementing §7.6's "must not present uncertain computer-vision conclusions as medical or scientific fact". §7.6's two success criteria are now executable assertions, not prose: `tests/unit/shot-mechanics.test.ts`, `shot-feedback.test.ts`, and a drill-slug coverage test modelled on the archetype one — which also reaches the three shooting drills that were seeded but unreachable from Analyze.
9. **Game Film, Progress, Goals, Confidence/Mental (P1)** — remaining MVP functionality after the core loop is demoable. *Game Film shipped, and went past the original scope:* BRD 7.7's "identify relevant events" is met for real rather than deferred — see the revised AnalysisProvider and async-processing bullets in §5. Both entry points now appear on the Analyze hub, a completed review counts as activity in the feed (a Game-Film-only player previously read as having done nothing), and clips are stored under their own `game-footage/` prefix with accurate provenance rather than reusing the shooting-session labels. *Confidence/Mental Game also shipped:* BRD 7.10's two success criteria are both covered by tests — a "Nervous" check-in returns counted reps and timed breathing rather than a pep talk, and the post-game recovery plan is composed in code from the player's own last session, workouts-this-week, streak and drill volume. Nothing in it is generated, so it carries no "simulated" label and needs no API key; it links through to the session it cited and the workout that session produced, hands off to Coach with an opener naming the real figures, and appears on Progress. It is reached from a Home card — the nav stays at six.
10. **Polish (P2)** — content volume, visual pass on Analyze to match the reference screenshots, rate limiting.
11. **Hardening** — remaining tests, security pass, NFR check, COPPA-flow review flagged to founders.

Each phase ends in a demoable, testable increment — matches the request to test each major feature incrementally rather than big-bang at the end.

---

## 14. Risks, Assumptions & Open Questions

- **Timeline reality check:** today is Sept 9, 2026; the league window opens Sept 14. The full MVP feature set (§1) is substantial — recommend confirming whether Sept 14 is a hard internal deadline for *this* build or an aspirational reference, so phase prioritization (§13) can be adjusted (e.g., cut to Phases 1–4 for a Sept-14-ready demo, finish 5–8 after).
- **balldontlie.io reliability/coverage:** free tier may have rate limits or lag on jersey-number/roster-change accuracy — acceptable for MVP per BRD's own tolerance for placeholder/demo-grade content, but worth monitoring.
- **OpenAI cost exposure:** Coach chat + any generated text is metered; MVP needs the basic rate limiter from day one (§6), full cost-aware throttling is Phase 2 per BRD §10.
- **Simulated analysis quality bar:** ~~BRD §7.6/§7.7 require feedback to *read* as specific and non-generic even though it's simulated — the `SimulatedAnalysisProvider` will need real design effort (varied templates/logic), not a single canned string, to pass BRD's own success criteria.~~ **Resolved for §7.6 in P0.9.3** (§13 item 8.6): the parameter bank is signal-driven rather than canned, and both success criteria — "all follow observation → issue → correction → drill", "no message is generic" — are asserted across a matrix of sessions in `tests/unit/shot-mechanics.test.ts` and `tests/unit/shot-feedback.test.ts` against a banned-generic phrase list. §7.7's Game Film path went further still and now runs real vision analysis (§13 item 9).
- **Minors/COPPA (BRD §9.4, A7):** open legal question, not resolved by this plan — flagging again so it isn't silently dropped.
- **Native app expectation (A1):** confirm the founders are fine with "web app" satisfying BRD flow language that reads as mobile-app-shaped.
- **GCS vs. the rest of the stack:** confirm Vercel (A5) is actually the intended host — if hosting is instead GCP (Cloud Run/App Engine), some of the "serverless env var" GCS-credential guidance in §9 simplifies (a mounted service account becomes viable).

---

## 15. Verification (once implementation begins)

- After Foundation phase: `npm run db:init` then `npm run db:seed` against the provided `MONGODB_URI`, confirm collections/indexes exist and seed data is present; re-run both to confirm idempotency (no duplicates, no errors).
- After each feature phase: run that phase's unit/integration tests (`npm run test`), then manually exercise the feature in the browser (dev server) per the "start the dev server and use the feature" guidance — screenshot or describe the golden path and at least one edge case.
- Before calling the MVP "done": run the Playwright connected-loop suite end-to-end and manually walk BRD §11.1's exact reviewer scenario (onboard → Home → player study → workout → shot session → Coach → Progress) with zero dead buttons.

---

## 16. Founder Clarification Addendum (v1.1)

After Foundation shipped (and before any feature code was written), a co-founder reviewed the BRD again and sent detailed clarifications plus four "Shooting Report" reference screenshots. These sharpened several decisions this plan had left loose — most importantly, how shot detection actually works for MVP and that Analyze must be a standalone top-level section, not something reached through Coach.

**Full clarification doc:** `docs/HoopSync_BRD_v1.1.md`. Key resolutions (superseding the relevant parts of this document above, which have been amended in place where practical):

- Shot detection is **manual tap-to-log** (real data), not fabricated — §5 above, database design §4 above, and BRD v1.1 §5.
- Only the mechanical narrative (shot analysis "why") and Game Film analysis are simulated/heuristic, and both must be **explicitly labeled as such in the UI**.
- Analyze is a standalone nav section (`Home | Train | NBA Players | Analyze | Coach | Progress`) containing Shooting Session and Game Film as distinct features — never routed through Coach.
- Progress replaces Goals as the 6th nav item; Goals lives inside Progress.
- A fixed 9-zone taxonomy replaces the free-form zone string.
- Every founder-listed data relationship (Workout↔Progress, Shot↔Replay↔Analysis, Analysis↔Coach, NBA Player↔Drill↔Workout, Game Weakness↔Workout, Feed↔Actions) now has an explicit acceptance criterion — see BRD v1.1 §6-§8 and the reconciliation's Requirements Gap Matrix.

This addendum, not the original phase numbering in §13, is the current source of truth for build order. See §13's revised phase list above.

---

## 17. Achievements / XP (BRD §7.13)

BRD §7.13 is the only §7.x section with no Parameters, User Interaction or Success Criteria — its single functional requirement is a constraint: gamification must "never become more prominent than the app's actual development/coaching value." The scoping below fills that gap.

**Everything is derived; only the unlock date is stored.** XP and unlock state are pure functions of counters `userStats` already maintains (`src/lib/training-xp.ts`, `src/lib/achievements.ts`). The `achievements` collection stores *only* the date a criterion was first observed met — a missing row means "no date recorded", never "locked". This follows the same derived-not-incremented rule as `goalService`, and buys three things at once: a counter can't drift from the records, a player who trained before the feature shipped gets credit immediately, and there is no second write path to forget.

**"Level" is renamed "Tier."** `EducationLevel` and `CompetitiveLevel` already mean something specific here, so a gamification "Level 4" beside "high school level" would be ambiguous. The six tiers (Getting Started → Year-Round) are named for *training commitment*, not playing ability — a name like "Varsity" would assert competitive standing the app cannot measure, which is the line `skill-metrics.ts` already draws against synthesized skill ratings. The ladder is bounded at six on purpose; an endless one is the part that becomes a treadmill.

**XP formula** — `workouts × 50 + sessions × 30 + makes × 1 + longestStreak × 20`. Every term is monotonic, so XP never falls (`longestStreak`, not `currentStreak`, which drops after a rest day). Per-skill `drillsCompleted` is deliberately excluded: `skill-metrics.ts` credits a drill once *per skill tag*, so summing that map across skills would double-count multi-tag drills.

**Catalog** — 29 milestones in four families: volume (workouts/makes/sessions), consistency (streaks), reps by skill (one per `SkillCategory`, at 25 drills, framed as work put in and never as a rating), and the connected loop (first session analyzed, goal completed, film reviewed, Share With Coach).

**Threshold sharing with §7.15.** The workouts/streak/sessions families take their numbers from `MILESTONE_THRESHOLDS` in `src/lib/notification-types.ts`, so a player never sees a "10 workouts done" notification alongside a badge at a different number. Achievement-only extras (a 3-day streak, a first-workout badge) are allowed for moments worth recording but not worth interrupting anyone over. `tests/unit/achievements.test.ts` asserts every shared threshold still has a badge, so the two catalogs cannot silently drift.

The two features take deliberately opposite stances on retroactivity, and both are right: `thresholdsCrossed(prev, next)` is transition-based so nobody is interrupted about old work, while achievements are state-based so the *record* reflects everything real. A backfill flag keeps the two consistent — rows stamped by an account's first-ever evaluation are marked `backfilled` and excluded from the feed card and the unlock toast, because announcing a milestone passed last month would be a false claim about *when*.

**Surfaces, in order of prominence.** A third tab inside Progress; one quiet row in the Progress Overview (deliberately not a fourth `StatTile`, so the measured stats keep the largest type on screen); a secondary `toast` after a workout or session; and a generated `achievement_unlocked` feed card placed **last** in `GENERATED_KIND_ORDER`, drafted only when a genuine unlock happened within 3 days. Bottom nav is untouched and stays six items.

**Not built, deliberately:** leaderboards or any player-to-player comparison, streak-at-risk pressure (that is §7.15's job), confetti or a full-screen unlock, XP for opening the app or viewing content, and infinite levels.
