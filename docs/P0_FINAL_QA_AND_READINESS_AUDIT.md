# HoopSync — P0 Final QA, Feature Audit & Readiness Document

**Scope:** every phase P0.1–P0.8 of the approved implementation plan, as actually implemented in the codebase at commit `b77009f` on `master`, inspected directly (not from memory or prior chat summaries).

**Method:** the entire application source, all seed/init scripts, all test files, `.env.example`, and the (name/set-status only, never values) contents of `.env.local` were read directly. Ten independent passes covered Auth+Onboarding, Home Feed, NBA Players, Train, Analyze/Shooting Session, Coach, Progress/Goals/Confidence/Game-Film, the full environment-variable + external-service surface, the seed/init scripts, and the automated test suite. A sample of the highest-impact claims (the admin-role dead end, the destructive `db:seed` overwrite of `userStats`, the `MongoDB URI` module-load crash, the `isSimulated` labeling) was independently re-verified by directly reading the cited source lines; all matched. Every claim below cites a file (and usually a line range) — treat an unlinked claim as suspect and ask for the citation.

**What "verified" means in this document:** typecheck, lint, the full unit/integration suite, and the Playwright end-to-end suite were all run for real during this audit (see §8 for the actual output). Individual manual test cases in §3 were **not** all re-clicked through in a browser during this audit pass — each row's **Verification Status** column says exactly what backs it: `automated (e2e)`, `automated (integration)`, `automated (unit)`, `code-verified` (confirmed by direct source reading, not by running it), or `not yet executed — requires manual click-through`. Cases blocked on a missing credential (real OpenAI key, real Google OAuth, real balldontlie key, real GCS bucket) are marked `blocked — needs credential`, because no such credential exists in this environment.

---

## 0. Executive Summary

**The full founder-defined P0 loop works, end-to-end, with real data, today**, without any external credentials: sign up → onboarding → personalized Home feed → study an NBA player → generate/complete a workout → Progress updates → record a shooting session → tap-log real shots → exact replay → labeled-simulated mechanical breakdown → recommended workout → Progress updates again → Share With Coach (real context attached). This is proven by an automated, real-browser Playwright suite (`tests/e2e/founder-loop.spec.ts`) that passed 11/11 during this audit, plus 88/88 passing unit/integration tests.

**What is real:** persistence for every domain object (profiles, workouts, shot sessions, coach conversations, progress/streak) is genuinely written to and read from MongoDB. Shot make/miss/location is 100% real user input — there is no computer vision anywhere in this codebase. Workout generation is deterministic rule-based logic, not AI. The mechanical-breakdown narrative is clearly disclosed as simulated in the UI, exactly where BRD v1.1 requires it.

**What is not yet configured (credentials the owner must supply, not code that must be written):** `OPENAI_API_KEY` (no live Coach reply has ever been produced), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `EMAIL_SERVER_API_KEY` (the only working sign-in today is a dev-only bypass), `BALLDONTLIE_API_KEY` (the NBA roster is 2 hand-seeded players, not the full league), and the three `GCS_*` variables (video is stored on local disk, dev-only).

**What is a genuine code gap, not a credential gap:** nobody can ever hold the "admin" role, so the NBA roster sync can never be triggered even once a balldontlie key exists (§ Bugs, NBA-1). Re-running `npm run db:seed` silently overwrites the demo account's real accumulated progress (§ Bugs, Seed-1). The under-13 parental-consent toggle is displayed but not enforced (§ Bugs, Auth-1). One feed card and one seeded Coach message present fabricated numbers as if they were real analysis, with no "example" label (§ Bugs, Feed-1, Coach-1). Game Film, the Goals tab, and Confidence/Mental-Game check-ins are honestly-labeled placeholders with zero backing implementation — this is disclosed in-app, not hidden. *(Superseded: Game Film and Confidence/Mental Game have both since been built — see §2.8.)*

**Readiness verdict:** see §7. Short version — **ready for a local/dev demo today** (with the caveats in §0 told to whoever is driving); **not ready for MVP evaluation** until the credential gaps are filled and the 2–3 critical-before-demo content bugs are fixed; **not ready for production** until the admin-role gap, the destructive seed script, the COPPA consent enforcement, and the security items in §7 are addressed.

---

## 1. How This App Is Actually Built (for context)

Layering: `app/**` (routes) → `server/actions/**` or `app/api/**/route.ts` → `server/services/**` → `server/repositories/**` → `server/db/**`. MongoDB native driver (not an ORM). Auth.js v5 with JWT sessions. Next.js 16's `proxy.ts` (not `middleware.ts`) guards every route except `/sign-in` and `/api/auth/*`. All of this was confirmed by direct reading, not assumed from documentation.

Git state audited: branch `master`, commit `b77009f` ("P0.8: connected-state Playwright smoke suite"), working tree clean.

---

## 2. Feature Inventory

For every feature: what it does, the real user flow, where its data actually comes from, how it's persisted, its status, and its dependencies. Status vocabulary used throughout this document: **fully-real** (real logic + real persistence, works with zero external config) · **real-requires-config** (real logic, but needs an owner-supplied credential to function or to reach its intended data) · **seed-data** (real code path, but the content itself is developer-authored fixture data in the shared library) · **demo-data** (fixture data scoped to the one seeded demo account) · **simulated** (the specific field/text is generated by a template/heuristic, not measured) · **placeholder** (a labeled stand-in with no real content behind it yet) · **missing** (declared in the data model / planned in docs, but no working code path exists) · **future-phase** (explicitly out of P0 scope).

### 2.1 Foundation, Authentication & Route Protection

| Feature | Status | Persistence | Real user flow |
|---|---|---|---|
| Google OAuth sign-in | real-requires-config | mongodb (`users`/`accounts`, Auth.js adapter) | `/sign-in` → "Continue with Google" → Google consent → callback → `/home` or `/onboarding`. **`GOOGLE_CLIENT_ID`/`SECRET` are empty** — the button always renders but the flow cannot complete today. |
| Email magic-link sign-in (Resend) | real-requires-config | mongodb (`verificationTokens`/`users`) | "Continue with Email" → Auth.js emails a link → click it → signed in. **`EMAIL_SERVER_API_KEY` is empty** — no email is ever sent today. |
| Dev-only passwordless sign-in ("dev-credentials") | temporary-dev-only | mongodb (`users`, direct insert) | Type any email, no password → signed in, account created if new. **The only sign-in method that works in this environment right now.** Fully excluded from the providers array when `NODE_ENV==="production"` (`src/server/auth/auth.config.ts:39-73`). |
| Sign out | fully-real | none (cookie only) | Header "Sign out" → `/sign-in`; Back/`/home` don't restore the session. |
| Session strategy | fully-real | client-state-only (30-day signed JWT cookie) | `session: {strategy:"jwt"}` (`auth.config.ts:22`) — no DB session row is ever consulted; survives browser/server restarts; cannot be centrally revoked. |
| Route protection (signed out) | fully-real | none | Every path except `/sign-in`, `/api/auth/*` redirects (pages) or 401s (API) a signed-out visitor. `src/proxy.ts:4-32`. |
| Onboarding-incomplete redirect | fully-real | mongodb (`playerProfiles`) | Signed in + no completed profile → every app page bounces to `/onboarding`; complete profile → `/onboarding` bounces to `/home`. |
| Admin role / admin-gated actions | **missing** | mongodb (`users.role`, snapshotted into the session JWT) | No code path anywhere ever assigns `"admin"`. The one admin-gated action (NBA roster sync) is permanently unreachable. See Bug AUTH/NBA-1. |
| Seeded demo account | seed-data | mongodb | `demo.player@hoopsync.dev`, already-onboarded, with fabricated history across every module. |

**Ten onboarding fields are collected and never read again downstream** (height, weight, age, education level, graduation year, games/practices per week, all 3 team fields) — only `primaryGoal`, `focusAreas`, `position`, `competitiveLevel`, `equipment`, and `coachPersonality` actually influence anything (`src/app/(app)/home/page.tsx`, `src/server/services/{feedService,workoutGenerationService,coachPromptService}.ts`). There is **no profile/settings screen** — onboarding is one-shot; a player can never change any answer afterward (confirmed: no `/profile` or `/settings` route exists).

### 2.2 Onboarding Wizard (5–6 steps)

All fields are real, client-validated and server-re-validated with the same Zod schema (`src/lib/validation/onboarding.ts`), and written atomically in one upsert on "Finish" (`src/server/services/profileService.ts:31-65`) — nothing is saved before that, so an abandoned wizard leaves no trace. Every ChipGroup option is a plain button (not a native select/radio), which matters for anyone testing by hand. The 6th step ("One more thing," parental consent) appears only when the entered DOB computes to under 13 (`src/lib/age.ts`, `COPPA_AGE_THRESHOLD=13`); the server independently re-derives this from the submitted DOB rather than trusting the client (`profileService.ts:35-36`) — **but the confirmation toggle itself is not required** to finish (see Bug AUTH-1).

### 2.3 Home / Personalized Feed

| Feature | Status | Persistence | Notes |
|---|---|---|---|
| Welcome/profile summary card | fully-real | mongodb (read) | Real goal, focus-area badges, coach personality. |
| Daily quote card | seed-data | mongodb (`dailyQuotes`) | 14 hardcoded quotes, date-keyed; **silently disappears 14 days after the last `db:seed` run** (Bug Feed-5). |
| Personalization/ranking | real-requires-config | runtime-computed | Score = count of tag-overlap with `profile.focusAreas` only. No shot-session, workout, goal, streak, like, save, or share signal is ever read (`feedService.ts:36-45`, comment admits it). |
| The 8 feed cards | seed-data | mongodb (`feedItems`) | Identical for every user, forever; nothing in the app ever creates/edits a feed item. |
| **"For You" card** | **demo-data presented as real** | mongodb | Claims "your right-wing percentage trails your left wing" to every account including a brand-new one with zero sessions. No label. **See Bug Feed-1 — highest-severity honesty issue in this audit.** |
| Like / Save | fully-real | mongodb (`feedInteractions`) | Real toggle, survives reload. Save has **no destination screen** — a working write nobody can ever read back. |
| Share | real-requires-config | mongodb (upsert-once) | Needs `navigator.share`/`navigator.clipboard`; on an insecure origin (e.g. `http://<lan-ip>:3000`) it does **nothing visible** while still recording the share. |
| Ask Coach | real-requires-config | mongodb (`coachConversations`) | Real conversation + real context ref, but **creates a duplicate on every click** and drops the player into a completely empty chat (no greeting) — see Bug Feed-3. |
| Start Drill | fully-real (buggy) | mongodb (`workouts`) | Creates a duplicate workout on every click and dumps the player back on the Train **list**, not the workout — see Bug Feed-2. |
| Add to Workout | fully-real | mongodb (`$push`) | Appends to the newest pending workout (de-duplicated); duration estimate goes stale — see Bug Train-4. |
| Related | placeholder (client-only) | none | Non-clickable plain-text titles; the only feed control that touches no server code at all. |
| Drill Demo card video | missing | n/a | Body text promises a clip; no video element exists anywhere in the component; the referenced media asset 404s. |
| Feed → Player profile link | missing | n/a | Two cards store a real `relatedPlayerId`; nothing renders a link to it. |

### 2.4 NBA Player Mode

| Feature | Status | Persistence | Notes |
|---|---|---|---|
| Player browse/search | seed-data | mongodb (`nbaPlayers`) | **Exactly 2 players exist today: Paul George, Stephen Curry.** Search is a case-insensitive substring on name; a no-match search renders a blank page with no message (Bug NBA-4). |
| Learn / Skills / Bio tabs | seed-data | mongodb (`editorial` sub-doc) | Hand-written prose + 6 hardcoded skill numbers (0-99) for the 2 seeded players — **editorial opinion, not real NBA statistics**; balldontlie has no stats endpoint in this codebase at all. |
| Placeholder 50/100 ratings for synced players | placeholder | mongodb | Any roster-synced player (once the sync ever runs) gets all-six-skills-= 50, rendered as ordinary rating bars with no "unrated" indication. |
| Signature Move → Drill → Workout ("Start Matching Workout") | fully-real | mongodb (`workouts`) | Real single-drill workout, real navigation. |
| "Generate Workout Modeled After \<Player\>" | fully-real (degenerate for synced players) | mongodb (`workouts`) | Same deterministic engine as Train. For the 2 seeded players, targets their real top-2 skills; for any roster-synced player (all-50 ratings) the "top 2" is arbitrary tie-break order, not meaningful — see Bug NBA-3. |
| Full-roster sync (balldontlie.io) | real-requires-config, **and structurally unreachable** | mongodb (`nbaPlayers`) | API-only (no UI button anywhere), admin-role-gated, and **no account can ever hold the admin role** (Bug NBA-1/AUTH-1-shared). `BALLDONTLIE_API_KEY` is also empty. Response shape has never been verified against a live key (code's own comment admits this). |
| Player study clip | placeholder | mongodb (1 asset row) | One italic sentence disclosing it's placeholder footage; no video element renders at all. |
| Player imagery | **missing** | n/a | Every avatar is initials-in-a-grey-circle. `playerImageUrl` is declared in the type and repository but written/read nowhere in the app; balldontlie isn't even asked for an image field. |

### 2.5 Train / Workouts

| Feature | Status | Persistence | Notes |
|---|---|---|---|
| Workout list (`/train`) | fully-real | mongodb (`workouts`) | Per-user, newest first, no delete/archive control ever. |
| "Generate Workout" (skill picker) | fully-real | mongodb | **Purely deterministic rules — no AI/LLM anywhere in this path** (confirmed no model import in `workoutGenerationService.ts`): hard equipment filter → skill-tag overlap score → sort → always take the first 4 (score-0 drills pad the workout when fewer than 4 match — Bug Train-1). |
| 14-drill shared library | seed-data | mongodb (`drills`) | Coverage: shooting 3, ball-handling 3, footwork 3, finishing 2, defense 2, playmaking 2, athletic 2. Equipment vocabulary actually used: only ball/hoop/cones — 4 of the 7 onboarding equipment options are never required by any drill. |
| Drill demo video | missing | n/a | `videoUrl` field is plumbed end-to-end and rendered nowhere; no drill has a value. |
| Start Workout / drill-by-drill flow | fully-real | mongodb (status/startedAt) | |
| Per-drill completion toggle | fully-real | mongodb | Optimistic with toast-on-failure rollback. |
| Drill navigation + progress bar | fully-real | client-state-only | The bar reflects **position**, not completion — resets on reload. |
| Drill timer | placeholder | none (runtime only) | Resets to 0:00 on every Next/Previous/reload; never sent to the server; the "~N min" shown to the player is always `drills × 6`, never real elapsed time. |
| Complete Workout (+ Progress/streak side effect) | fully-real (destructive to per-drill history) | mongodb (`workouts` + `userStats`) | **Force-marks every drill complete**, even ones deliberately skipped — the real per-drill record is destroyed at completion (Bug Train-2). Difficulty label is derived from competitive level but **never restricts which drills get chosen** — a middle-schooler can receive an "advanced" drill inside a workout stamped "beginner" (Bug Train-3). |
| Streak algorithm | fully-real | mongodb (`userStats`) | Deterministic calendar-day arithmetic; verified same-day no-double-count, next-day increment, gap reset. Server-local-timezone day boundaries. |
| 5 distinct workout-creation entry points | fully-real, **inconsistent with each other** | mongodb | Train-generate (navigates in), Feed Start-Drill (navigates to list), Feed Add-to-Workout (no navigation), Player Signature-Move (hardcodes 15 min), Player "Modeled After" (real engine), Shot-Session recommendation (real engine, can be silently absent). |

### 2.6 Analyze Hub + Shooting Session (the centerpiece — audited most exhaustively)

| Feature | Status | Persistence | Notes |
|---|---|---|---|
| Analyze hub (2 entry points + history) | fully-real | mongodb (`shotSessions`, read) | |
| Video upload | real-requires-config | cloud-storage (GCS, configured) / local-filesystem-dev-only (unconfigured, non-production) | 100MB limit, MIME-type check trusts the browser header (Bug Analyze-11). All 3 `GCS_*` vars are empty → dev writes to `public/uploads/videos/`. |
| **Tap-to-log shot entry (make/miss/location)** | **fully-real — this is the one make/miss/location signal the founders cared most about, and it is 100% real, no computer vision, no fabrication** | mongodb (`$push` per shot) | xPct/yPct captured from the actual tap; video's real `currentTime` captured at tap moment; make/miss is exactly what the player pressed. |
| Zone classification | fully-real | mongodb | Deterministic geometric bands (`src/lib/shot-zones.ts:29-49`) — computed client-side for display, then sent to and only enum-validated (not recomputed) by the server. |
| Session finalize + report math | fully-real | mongodb | Attempts/makes/FG%/zone breakdown/best-weakest are all genuinely computed from the logged shots. **No minimum-attempt threshold and an arbitrary tie-break** — one lucky 1-for-1 shot can outrank a real 9-for-10 zone as "STRENGTH" (Bug Analyze-7). |
| Shot chart + all/made/missed filters | fully-real | mongodb (read) | |
| **Exact shot replay** | fully-real | mongodb | `replayStartSeconds = max(0, tap_time − 3)`; different markers genuinely seek to different positions **if the player was actually scrubbing/playing the video while tapping** — shots tapped at the same paused instant share a timestamp. `replayEndSeconds` is computed, stored, tested — **and never read by any UI**, so replay never actually stops at the end of the window (Bug Analyze-6). |
| Per-shot feedback line in the replay dialog | **simulated, with no label** | mongodb | Exactly 2 canned sentences (one per make/miss), zone name interpolated — **presented with zero "simulated" disclosure**, unlike the Mechanical Breakdown card. **This is the single clearest violation of the project's own "label all simulated content" rule** (Bug Analyze-1, high severity). |
| Mechanical breakdown ("why did you miss") | **mixed — see precise breakdown below** | mongodb, `isSimulated: true` type-level marker | See callout below. |
| Recommended workout | fully-real | mongodb | Same engine as Train/Players. Can legitimately be absent (equipment mismatch) — try/catch swallows the failure by design. |
| Share With Coach | real-requires-config | mongodb (`coachConversations`) | Real title with real numbers, real context ref. Reply quality needs `OPENAI_API_KEY`. |
| **Game Film** | **placeholder** | none | A static card. No upload, no analysis, no results, no repository/service/provider file exists anywhere. |
| Seeded demo shot session | seed-data, **internally inconsistent** | mongodb | All 5 zones compute to exactly 50%, yet the fixture hardcodes a "STRENGTH"/"NEEDS WORK" pair and a narrative describing a gap that isn't there (Bug Analyze-2); its video URL 404s (Bug Analyze-3). **Do not demo from the seeded session — upload a fresh clip instead.** |

> **Mechanical Breakdown — precisely what is real vs. simulated (read this before any founder/investor conversation):**
> **Real/measured:** the target zone, and the make/attempt counts + FG% quoted in the first sentence (from the player's own logged shots).
> **Heuristic (not statistical):** the "weakest zone" is simply the lowest-FG% zone — no minimum sample size, arbitrary tie-break.
> **Simulated:** the entire mechanical claim (e.g. "Elbow drifting outward," "Late wrist load") is one of exactly 4 hard-coded templates, selected **deterministically** (a hash of `sessionId:zone`, not random) so a reload always shows the same text — not derived from any video frame; no pose-estimation library exists in this codebase. The in-UI disclosure, verbatim: *"Simulated mechanical analysis. In production, a pose-estimation model derives these observations frame-by-frame from your uploaded video."*

### 2.7 AI Coach

| Feature | Status | Persistence | Notes |
|---|---|---|---|
| Conversation list, New Conversation | fully-real | mongodb (`coachConversations`) | |
| Send message → LLM reply | **real-requires-config — no live reply has ever been produced in this environment** | mongodb (`coachMessages`) | One blocking OpenAI Chat Completions call per message; `OPENAI_API_KEY` is empty. |
| System-prompt context assembly | fully-real | none (assembled fresh per send) | Real profile facts, real progress stats (workouts/streaks only — **not** `totalShotSessions`), real active goals, and the real full document behind any shared context ref (shot session / feed item). Nothing is fabricated into the prompt. |
| 4 personalities | fully-real (prompt text verified distinct; model output unverified) | mongodb (`conversation.personality`) | Encouraging/Balanced/Direct/Elite Trainer inject genuinely different instructions (unit-tested distinct). Whether the **model's actual reply** differs cannot be checked without a key. |
| Share With Coach / Ask Coach hand-offs | fully-real | mongodb | Real title, real context ref, real numbers. |
| **Graceful degradation with no key** | fully-real | mongodb (user message only) | The player's message is always saved first; failure surfaces as the exact string *"AI Coach isn't configured yet - OPENAI_API_KEY is missing."* — HTTP 200, no crash, no fabricated reply. Vanishes on reload with no way to tell it happened (Bug Coach-3). |
| Rate limit (20 msgs / 10 min / user) | **temporary-dev-only** | runtime (in-process Map, not persisted) | Resets on every server restart/hot-reload; the codebase's own comment notes each serverless invocation gets its own module scope — **this limit would not hold at all on a serverless production deploy** until swapped for the already-scaffolded (unused) Upstash Redis vars. |
| Conversation ownership | fully-real | mongodb | Cross-user access = indistinguishable 404. |
| Seeded "Welcome conversation" | **demo-data presented as a real AI reply** | mongodb | Hand-written "assistant" message claims "12/20 (60%)" while the seeded session actually computes to 10/20 (50%), and the conversation has **zero context refs attached** despite claiming to "see" the session (Bug Coach-1). |

### 2.8 Progress, Goals, Confidence, Game Film (what exists vs. what's declared)

| Feature | Status | Notes |
|---|---|---|
| Progress Overview (workouts, streak, longest streak) | fully-real | Only reflects Train activity — completing a shooting session never touches these numbers. |
| Progress empty state | fully-real | Honest placeholder for a user with zero completions. |
| Progress → Goals tab | **placeholder, always** | Even for the demo account, which has 2 real `GoalDoc`s in MongoDB — the tab never queries them. |
| Goals (data model) | **missing (read-only, Coach-context only)** | `goalRepository.ts`'s own comment: *"Full Goals CRUD/UI is a later phase."* No create/update/delete path exists anywhere. `autoTrackedMetricKey` is declared and seeded but read by zero application code — nothing auto-tracks anything. |
| Confidence/Mental Game check-ins | fully-real (BRD 7.10 met) | Built since this audit. `/confidence`, reached from a Home card (the nav stays at six). Pre-game check-in writes one `confidenceCheckins` row per player per day with the routine snapshotted onto it; the post-game recovery plan is composed in code from the player's real last session, workouts-this-week, streak and drill volume — so it needs no "simulated" label and works with no `OPENAI_API_KEY`. Links through to the cited session and the workout that session generated, hands off to Coach with an opener naming the real figures, and surfaces on Progress. Covered by `tests/unit/confidence.test.ts`, `tests/integration/confidence-service.test.ts` and `tests/e2e/confidence.spec.ts`. |
| Game Footage Analysis | **missing** | Same pattern — schema provisioned, zero implementation; `/analyze/game-film` is an honestly-labeled static page. |
| `totalShotSessions` counter | **missing (dead field)** | Declared on `UserStatsDoc`, never incremented by real code, never displayed in the UI. |

---

## 3. Manual QA Test Plan

Legend for **Verification Status**: `automated (e2e)` = covered by `tests/e2e/founder-loop.spec.ts`, which passed 11/11 during this audit · `automated (integration)` / `automated (unit)` = covered by the Vitest suite, which passed 88/88 during this audit · `code-verified` = confirmed correct by directly reading the cited source, not by executing it · `not yet executed` = a real manual click-through is still needed · `blocked — needs credential` = cannot be executed at all until the named credential is supplied.

### 3.1 Authentication (AUTH)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| AUTH-01 | Protected page while signed out | Private window | Visit `/home`, `/train`, `/players`, `/analyze`, `/coach`, `/progress`, `/onboarding` | Every one redirects to `/sign-in?callbackUrl=<path>` | code-verified |
| AUTH-02 | Protected API while signed out | Private window | `fetch('/api/coach/conversations')` | HTTP 401, JSON `{"error":{"code":"UNAUTHORIZED",...}}` (no HTML redirect) | code-verified |
| AUTH-03 | Dev sign-in creates a new account | Never-used email | Dev sign-in field → submit | Lands on `/onboarding`, "Step 1 of 5"; a new `users` doc exists | automated (e2e) |
| AUTH-04 | Sign in as an already-onboarded user | Existing complete profile | Dev sign-in with that email | Straight to `/home` with saved goal/badges/personality | code-verified |
| AUTH-05 | `callbackUrl` round-trip | Signed out | Visit `/progress` → sign in | Lands on `/progress`, not `/home` | code-verified |
| AUTH-06 | Sign out | Signed in | "Sign out" → Back → `/home` | Both end on `/sign-in` | code-verified |
| AUTH-07 | Session persists across restarts | Signed in | Close/reopen browser; restart server | Still signed in (30-day JWT) | code-verified |
| AUTH-08 | Google sign-in with no credentials (current state) | `GOOGLE_CLIENT_ID/SECRET` empty | "Continue with Google" | Fails on a generic Auth.js error page, not a HoopSync message | not yet executed |
| AUTH-09 | Email sign-in with no key (current state) | `EMAIL_SERVER_API_KEY` empty | "Continue with Email" | No email sent; generic Auth.js error page | not yet executed |
| AUTH-10 | **Dev sign-in must be absent in production** | A real production build (`NODE_ENV=production`) | Load `/sign-in`; also try POSTing the dev-credentials callback directly | Dev block entirely absent from the page **and** the endpoint rejects the request — **the single most important pre-launch security check in this document** | not yet executed |
| AUTH-11 | Visiting `/sign-in` while already signed in | Signed in | Load `/sign-in` | Currently shows the form again instead of redirecting to `/home` (rough edge, not a security issue) | code-verified |
| AUTH-12 | Admin-only NBA sync is unreachable | Signed in, any account | `POST /api/nba-players/sync` | 403 FORBIDDEN for every account, always (see Bug NBA-1) | code-verified |

### 3.2 Onboarding (ONB)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| ONB-01 | Full happy path (adult DOB) | Fresh account | Complete all 5 steps (DOB 2008-01-01, etc.) → Finish | 5 steps only, no consent step; lands on `/home` with real answers shown | automated (e2e) |
| ONB-02 | Required-field validation | Step "The basics," empty | Click Continue with fields missing | Blocked; "Please check this field." under each bad field (same generic text every time) | automated (unit, schema only) |
| ONB-03 | Conditional team fields | Step "background" | Toggle "Currently on a team?" Yes/No | 3 team fields appear only on Yes; all 3 optional even when Yes | automated (integration, persistence only) |
| ONB-04 | Under-13 DOB adds the consent step | Fresh account | Enter a DOB making the player 12 | Caption flips to "Step 1 of 6"; "One more thing" step appears after personality | automated (integration, server flag only) |
| ONB-05 | **KNOWN DEFECT — consent is not enforced** | Continue from ONB-04 | Leave the consent toggle untouched → Finish | Profile saves anyway, full app access granted, `parentalConsentGiven:false` persisted silently | code-verified (see Bug AUTH-1) |
| ONB-06 | Adult DOB never shows consent | Fresh account | Enter a 17-year-old DOB | Stays "Step X of 5" throughout | automated (e2e) |
| ONB-07 | Numeric range validation | Steps 1 & 4 | Enter out-of-range height/weight/grad-year/games-per-week | Blocked with the same generic message; note a grad year in the past is rejected (a player who already graduated can't enter it) | not yet executed |
| ONB-08 | No way to re-open/edit onboarding | Completed account | Visit `/onboarding`; search the whole app for an edit entry point | Redirects straight to `/home`; no profile/settings screen exists anywhere | code-verified |
| ONB-09 | Onboarding answers really drive Train | Onboard with only "Jump rope" + "Shooting" | Generate a workout | Shooting pre-selected; equipment hard-filters to rope-only drills or an honest "no drills match" error | automated (integration + e2e) |
| ONB-10 | Coach personality changes tone | Two accounts, different personalities | Send the identical message to Coach on each | **Blocked without a real OpenAI key** — with no key both accounts get the identical "not configured" message | blocked — needs credential |
| ONB-11 | Back navigation preserves answers | Mid-wizard | Fill Steps 1–2, go Back twice, forward again | Nothing lost either direction | not yet executed |
| ONB-12 | Abandoning onboarding saves nothing | Fresh account | Fill Steps 1–3, close tab, sign in again | Wizard restarts empty at Step 1 | code-verified |
| ONB-13 | DOB edge case at the 13th-birthday boundary | Fresh account | Enter DOB exactly 13 years ago; ±1 day | **Known timezone bug**: DOB parsed as UTC, aged in local time — can be off by one day for testers west of UTC, silently skipping the consent step near the boundary | code-verified (see Bug AUTH-2) |
| ONB-14 | Onboarding requires a session | Signed out | Visit `/onboarding` | Redirect to `/sign-in?callbackUrl=/onboarding`; server-side save also independently guarded | code-verified |

### 3.3 Home / Personalized Feed (FEED)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| FEED-01 | Welcome card reflects onboarding | Just-onboarded account | Read the first card | Goal/focus badge/personality match exactly what was chosen | automated (e2e) |
| FEED-02 | Personalization ranking | Two accounts, different single focus areas | Compare card order on `/home` | Shooting-focused account sees shooting-tagged cards on top; a defense-focused account sees no reordering at all (no seeded card carries "defense") | automated (integration, ranking logic only) |
| FEED-03 | Like persists | Signed in | Tap heart, reload, tap again, reload | Red-filled state survives reload both ways | automated (integration, service only) |
| FEED-04 | Save has no destination | Signed in | Save 2 cards, reload, then search the whole app for a saved-items screen | Persists correctly; **no such screen exists anywhere** | not yet executed |
| FEED-05 | Share on a desktop/secure origin | Desktop browser | Tap Share twice on the same card | "Copied to clipboard." toast; text has **no URL**; only one share row recorded even after 2 taps | not yet executed |
| FEED-06 | Ask Coach | `OPENAI_API_KEY` empty (current state) | Tap Ask Coach on the same card 3 times | Each tap → a **new, empty** conversation (no greeting); 3 duplicate conversations end up in the list | code-verified |
| FEED-07 | Start Drill duplicates | Note current Train workout count | Tap Start Drill on the same card 3 times, returning to Home each time | 3 duplicate pending workouts; drops you on the Train **list**, not the workout | code-verified (see Bug Feed-2) |
| FEED-08 | Add to Workout & the stale duration | A 4-drill pending workout exists (~24 min) | Add a drill from Home twice | 1st adds (duration stays "~24 min", never recalculated); 2nd is a no-op with the *same* success toast (misleading) | code-verified |
| FEED-09 | Related is decorative | Signed in | Tap "Related," then tap a listed title | Reveals plain-text titles; **tapping a title does nothing** | code-verified |
| FEED-10 | **"For You" honesty check** | Brand-new account, zero shot sessions | Read the "For You" card | States a specific (fabricated) right-wing weakness with **no example/simulated label** — must be fixed/relabeled before any demo | code-verified (see Bug Feed-1) |
| FEED-11 | Quote card's 14-day expiry | Seeded ≥15 days ago | Revisit `/home` | Quote card **vanishes entirely**, no fallback, no error | code-verified |
| FEED-12 | Drill Demo video absence | Signed in | Find the "Drill Demo" card | No video/thumbnail anywhere; text-only | code-verified |
| FEED-13 | Feed → Player link absence | Signed in | Tap the Stephen Curry / Paul George feed cards | Nothing is clickable through to the player profile | code-verified |
| FEED-14 | Feed never grows | Two accounts | Compare card counts; look for pagination | Both see the identical 8 cards; no load-more/refresh exists | not yet executed |

### 3.4 NBA Player Mode (NBA)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| NBA-01 | Roster size reality check | Seeded DB | Open Players tab, count cards | **Exactly 2**: Paul George, Stephen Curry, both "Pending sync" | not yet executed |
| NBA-02 | Search | NBA-01 | Search "curry"; search "zzzz" | Match found; no-match search shows a **blank page with no message** | code-verified (see Bug NBA-4) |
| NBA-03 | Learn/Skills/Bio tab content | NBA-01 | Open Stephen Curry, all 3 tabs | Real prose + 6 hardcoded skill numbers; Bio shows literal "Pending roster sync" as team, em-dash for height | not yet executed |
| NBA-04 | Player imagery | NBA-01 | Look at every avatar | Plain grey initials circle everywhere — no photo/illustration exists | not yet executed |
| NBA-05 | Signature Move → Workout | Equipment includes Ball+Hoop | Curry → Learn tab → "Start Matching Workout" | Real 1-drill workout, real navigation | automated (e2e + integration) |
| NBA-06 | "Generate Workout Modeled After" target-skill selection | Equipment Ball+Hoop | Curry vs. George, compare drills | Distinct, skill-appropriate drills for the 2 seeded players | automated (integration, synthetic player only) |
| NBA-07 | Generate-workout error handling, no equipment | Second account, zero equipment | Tap Generate on Curry | Either a nonsense 2-drill plyo/rope workout under a "shooter" label, or an opaque generic error — the real, actionable server message never reaches the UI | code-verified (see Bug NBA-5) |
| NBA-08 | Roster sync — no key | Signed in, `BALLDONTLIE_API_KEY` empty | `POST /api/nba-players/sync` | 403 (role check fires first — the missing-key error is never even reached) | code-verified |
| NBA-09 | Roster sync — signed out | Private window | Same POST | 401 JSON | code-verified |
| NBA-10 | Is there any UI to trigger sync? | Signed in | Search the whole app | None — API-only, mentioned only in empty-state copy | code-verified |
| NBA-11 | Feed → Player hand-off | Seeded DB | Tap the Curry/George feed cards | Nothing clickable through | code-verified |
| NBA-12 | Editorial coverage census | NBA-01 | Open both players; search for any 3rd (post-sync) player | 2 of 2 have full content; any synced player shows the "content not authored yet" banner + all-50 skill bars | not yet executed |

### 3.5 Train / Workouts (TRN)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| TRN-01 | Generate Workout happy path | Onboarded, Ball+Hoop | Select "Shooting" → Generate | "Focused on shooting", 4 drills, ~24 min | automated (e2e + integration) |
| TRN-02 | Equipment hard filter | Account A (full kit) vs. B (none) | Both generate "Ball-handling" | A gets real ball-handling drills; B gets only the 2 no-equipment drills under a **mismatched label** | automated (integration, equipment-filter portion only) |
| TRN-03 | Padding to 4 drills always | Select "Playmaking" (2 real drills exist) | Generate | 2 relevant + 2 irrelevant drills, all under "Focused on playmaking" | not yet executed |
| TRN-04 | Start Workout persists | A pending workout | Start it, reload | Drill-flow view survives reload (real `in_progress` write) | automated (integration + e2e) |
| TRN-05 | Per-drill toggle persists | Started workout | Mark drill 1 complete, reload | "Marked complete" survives reload | automated (integration, service only) |
| TRN-06 | Navigation/progress bar is positional | Started 4-drill workout | Tap Next 3×, Previous 1× | Bar reflects **position**, not completion | not yet executed |
| TRN-07 | Timer is not persisted | Started workout | Let it run, Next, Previous, reload, re-open a completed workout | Resets to 0:00 every single time; "~N min" never reflects real elapsed time | not yet executed |
| TRN-08 | Complete Workout updates Progress | Fresh account | Start → Complete a workout | Toast, redirect to `/train`; Progress shows 1/1/1 | automated (e2e + integration) |
| TRN-09 | Completion force-marks skipped drills | 4-drill workout, only drill 1 marked | Complete from the last drill | **All 4** now read "Marked complete," including 3 never actually done | code-verified (see Bug Train-2) |
| TRN-10 | Streak same-day de-dup | Already completed 1 workout today | Complete a 2nd today | Workouts +1, streak unchanged | automated (unit) |
| TRN-11 | Entry: Signature Move | Seeded editorial content | Curry signature move → Start Matching Workout | 1 drill, hardcoded "~15 min" (not derived from the drill) | automated (e2e) |
| TRN-12 | Entry: "Modeled After" on a synced (unauthored) player | A roster-synced player | Generate Workout Modeled After | Succeeds, but "top skills" are arbitrary (flat-50 tie-break), not real | not yet executed |
| TRN-13 | Entry: Feed Start Drill | Seeded feed | Tap 3× from Home | Dropped on Train **list**; 3 duplicate workouts | not yet executed |
| TRN-14 | Entry: Feed Add to Workout + stale estimate | A 4-drill/24-min pending workout | Add a drill twice | 5 drills persist; duration display **never updates** from "~24 min" | not yet executed |
| TRN-15 | Entry: Shot-session recommendation | A completed shooting session | Read + start the Recommended Workout | Real workout; label names the weak zone but drills are generic shooting drills | automated (e2e + integration) |
| TRN-16 | Drill demo video absence | Any started workout | Step through every drill | No video anywhere | not yet executed |
| TRN-17 | Difficulty label vs. real drill suitability | Middle-school competitive level | Generate "Playmaking" | Can receive an **"advanced"**-tagged drill inside a workout stamped "beginner" | code-verified (see Bug Train-3) |
| TRN-18 | Re-opening a completed workout | An already-completed workout | Toggle drill 1's completion, reload | Toggle is still live on a "completed" workout and the un-mark **persists**, contradicting the "completed" status | code-verified |
| TRN-19 | No way to remove a workout | 5 duplicate feed-created workouts | Look for delete/archive | None exists anywhere; the list grows forever | not yet executed |

### 3.6 Analyze Hub (ANL) and Shooting Session (SHT)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| ANL-01 | Hub entry points | Onboarded | Open `/analyze` | Two buttons, correctly labeled; 6-tab bottom nav confirmed | automated (e2e) |
| ANL-02 | Empty state | Brand-new account | Open `/analyze` | Honest "No shooting sessions yet..." copy | not yet executed |
| ANL-03 | Game Film is a placeholder | Any account | Tap "Game Film" | Static card, no upload control anywhere — expected, not a bug | not yet executed |
| SHT-01 | Upload happy path | A short mp4 | Upload → Start Logging | Video plays; instructional copy shown | automated (e2e) |
| SHT-02 | Upload — oversize (100MB) | A >100MB file | Upload | Exact toast: *"That video is too large - keep clips under 100MB for now."*; whole file uploads before rejection (no client-side check) | not yet executed |
| SHT-03 | Upload — non-video | A `.pdf`/`.txt` | Force-select via "All files," upload | Exact toast: *"Please upload a video file."*; **a renamed non-video file would pass** | not yet executed |
| SHT-04 | Tap-to-log zone classification | Uploaded session | Tap the middle-top of the court | Card reads "Paint" + the exact video timestamp | automated (e2e + unit) |
| SHT-05 | Make/miss is genuinely user input | Logging mode | Tap+confirm 1 make, 2 misses | Correct colored markers; counter reads "1/3 logged" | automated (e2e) |
| SHT-06 | Remove a mis-logged shot | ≥2 shots logged | Tap a marker, confirm removal, reload | Gone permanently (server delete, not just hidden) | automated (integration, service only) |
| SHT-07 | Finish blocked at zero shots | Fresh session | Look at the Finish button | Disabled | automated (integration) |
| SHT-08 | Report math — totals | A known shot mix | Finish, read the 4 tiles | Exact arithmetic match | automated (e2e + integration) |
| SHT-09 | Report math — zone breakdown | ≥2 zones at different %s | Read By Zone / STRENGTH / NEEDS WORK | Correct, **but no minimum-attempt guard** — a 1-for-1 zone can beat a 9-for-10 zone | automated (unit + integration, arithmetic only — the guard's absence is code-verified) |
| SHT-10 | **Exact replay — distinct timestamps** | Shots logged at clearly different points | Tap early marker, note position; tap late marker | Genuinely different seek positions **if the video was actually being scrubbed while tapping** — shots tapped at one paused instant share a timestamp | automated (e2e — dialog only; integration — timestamp math) |
| SHT-11 | Mechanical breakdown — labeled & deterministic | Finished session, ≥2 zones | Read the disclaimer, reload, re-read | Exact disclaimer text present; identical wording after reload (hash-deterministic, not random) | automated (e2e + integration) |
| SHT-12 | **Replay feedback line — unlabeled (defect)** | ≥2 misses in different zones | Read the feedback sentence on 2 different misses | Same canned sentence apart from zone name; **no simulated/generated label anywhere** | code-verified (see Bug Analyze-1) |
| SHT-13 | Recommended workout | Equipment set, finished session | Read + start it | Real workout; label names the weak zone | automated (e2e + integration) |
| SHT-14 | Recommended workout legitimately absent | No equipment on profile | Finish a session | Card absent, everything else on the report still works | automated (integration) |
| SHT-15 | Share With Coach — real numbers | A finished session | Share With Coach | Title carries this exact session's real numbers | automated (e2e + integration) |
| SHT-16 | In-progress counter defect | 3 shots logged, not finished | Return to `/analyze` | Card shows **"0/0 logged so far"** despite 3 real shots existing (display-only bug; data is safe) | code-verified |
| SHT-17 | Single-zone session (defect) | 2 shots, same zone | Finish, read STRENGTH/NEEDS WORK | Same zone shown as **both** at once, narrative claims a gap that doesn't exist | code-verified |
| SHT-18 | Seeded demo session integrity (defect) | Seeded demo account | Open the pre-existing session | Numbers are internally contradictory (all zones 50% yet a "gap" is narrated); video 404s — **do not demo from this session** | code-verified |

### 3.7 AI Coach (CCH)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| CCH-01 | Conversation list, empty state | Brand-new account | Open `/coach` | Honest empty-state copy | not yet executed |
| CCH-02 | New Conversation | Onboarded | Tap New Conversation | New conversation, personality defaults to the onboarding choice | automated (integration, service only) |
| CCH-03 | Graceful no-key degradation (CURRENT STATE) | `OPENAI_API_KEY` empty | Send a message | Own message saved; exact honest fallback text shown; **vanishes on reload with no trace it happened** | automated (e2e + integration) |
| CCH-04 | Share With Coach from a report | A completed session | Share With Coach | Title carries real numbers; badge attached | automated (e2e + integration) |
| CCH-05 | Ask Coach from Feed | Seeded feed | Tap Ask Coach | Real title + context badge | automated (integration, service only) |
| CCH-06 | Personality switch persists | Any conversation | Switch to Elite Trainer, reload | Persists across reload | automated (integration) |
| CCH-07 | Ownership enforcement | 2 accounts | Account B loads Account A's conversation URL | Standard 404, indistinguishable from a nonexistent id | automated (integration) |
| CCH-08 | Rate limit (20/10min) | Same server session | Send 21 messages | 21st blocked with a countdown toast; resets on server restart | automated (integration + unit) |
| CCH-09 | **Live reply cites real numbers** | Real `OPENAI_API_KEY` | Ask about a shared session | Blocked entirely without a real key — never observed in this environment | blocked — needs credential |
| CCH-10 | **4 personalities produce different replies** | Real `OPENAI_API_KEY` | Same message, 4 personalities | Blocked entirely without a real key — only the **prompt text**, not model output, has ever been verified distinct | blocked — needs credential |
| CCH-11 | Message length guards | Any conversation | Empty/whitespace/>4000 chars | Send disabled for empty; server rejects >4000 chars | not yet executed |
| CCH-12 | **Seeded conversation honesty check** | Seeded demo account | Open "Welcome conversation" | Cites 12/20 (60%) while the real seeded session is 10/20 (50%), with **zero context actually attached** — expected to fail as an honesty check | code-verified (see Bug Coach-1) |

### 3.8 Progress (PRG) and Deferred Features (DEF)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| PRG-01 | Empty state | Brand-new account | Open Progress | Honest placeholder, no zeroed tiles | not yet executed |
| PRG-02 | Stats update after completion | Baseline known | Complete a workout | Tiles +1, streak logic applies | automated (integration + e2e) |
| PRG-03 | Same-day de-dup | 1 workout done today | Complete a 2nd today | Workouts +1, streak unchanged | automated (unit) |
| PRG-04 | Gap reset | Streak >1, 2+ day gap | Complete today | Current streak → 1, longest preserved | automated (unit) |
| PRG-05 | Recent list caps at 5 | >5 completions | Complete a 6th | List still shows ≤5, no pagination | not yet executed |
| DEF-01 | Goals tab is always a placeholder | Seeded demo user (has 2 real goals) | Open Progress → Goals | **Neither real goal is ever rendered** | not yet executed |
| DEF-02 | Game Film is a placeholder | Any account | Open Analyze → Game Film | Honest static card, nothing else | not yet executed |
| DEF-03 | ~~Confidence check-in doesn't exist~~ **Resolved** | Any account | Home → "Game today?" → pick a feeling; then build a recovery plan | A specific routine renders immediately; the plan cites the player's real session numbers and links to that session, its workout, and Coach | automated (e2e) |
| DEF-04 | **Re-seeding overwrites real demo progress** | Demo account with real post-seed activity | Note current stats → run `npm run db:seed` again | Stats **silently reset** to the fixed seed values (3/6/1/1) | not yet executed (mechanism code-verified — see Bug Seed-1) |

### 3.9 Environment / External Services (ENV) and Tooling (TST)

| ID | Feature | Preconditions | Steps | Expected Result | Verification Status |
|---|---|---|---|---|---|
| ENV-01 | Coach with no OpenAI key | Current state | Send any message | Message saves; honest fallback shown; no crash | automated (e2e) |
| ENV-02 | Roster sync with no balldontlie key | Admin role (unobtainable today) | POST the sync route | 502 with a clear message | code-verified |
| ENV-03 | Video storage with no GCS | Dev environment | Upload a session | Silently uses local disk; works end-to-end | automated (e2e) |
| ENV-04 | Google/Email sign-in with no credentials | Production build simulated | Try both buttons | Both render regardless of config; fail at click-time with a **generic** Auth.js error (no HoopSync message) | not yet executed |
| ENV-05 | `MONGODB_URI` missing | Unset the var | Load any route | **Entire app fails** — module-eval-time crash, not scoped to DB-touching pages | code-verified |
| TST-01 | Roster-sync auth gating | 2 accounts | Call the sync route as non-admin, then signed-out | 403, then 401 | code-verified (route itself has zero test coverage — see Bug Test-1) |
| TST-02 | Upload validation branches | Various bad files | Empty / non-video / oversized | Each shows its own specific message | not yet executed |
| TST-03 | COPPA consent step, real UI | New account | Enter an under-13 DOB, walk to Finish | Step appears; **currently does not block Finish** (duplicate of ONB-05) | not yet executed |
| TST-04 | Onboarding per-field inline errors | Wizard | Leave required fields blank | Inline error renders, step doesn't advance | not yet executed |
| TST-05 | **Real OpenAI round-trip** | Real key | Ask about a shared session | Blocked without a real key | blocked — needs credential |
| TST-06 | **Real balldontlie round-trip** | Real key + admin role (unobtainable) | Trigger sync | Blocked — no automated or manual test has ever run against the live API | blocked — needs credential |
| TST-07 | **Real GCS round-trip** | Real GCS credentials | Upload + replay | Blocked — `gcsClient.ts` is imported by zero test files | blocked — needs credential |
| TST-08 | Game Film / Goals placeholders read honestly | Any account | Visit both | Clear "not yet" state, not a blank/broken page | not yet executed |
| TST-09 | **Real Google OAuth / magic-link sign-in** | Real credentials | Complete both real flows | Should land on `/onboarding` or `/home` exactly like dev sign-in | blocked — needs credential |
| TST-10 | Real day-boundary streak increment in the UI | 1 completion today | Wait/simulate a day, complete again | Streak → 2 in the real UI (only proven in isolation today) | not yet executed |
| TST-11 | Mobile-viewport walkthrough | Phone or 390×844 viewport | Repeat the founder loop | No mobile/WebKit coverage exists in Playwright at all today | not yet executed |

---

## 4. Configuration, Temporary Implementations & Future Replacements

| Item | Current Implementation | Why Temporary/Incomplete | What the Owner Must Provide | Future Action | Priority |
|---|---|---|---|---|---|
| Dev-only passwordless sign-in | Email-only Credentials provider, excluded from `production` builds | Lets anyone test without OAuth/email setup | Confirm every deployed env truly runs `NODE_ENV=production` | Verify AUTH-10 before any external demo | **critical-before-production** |
| Google OAuth credentials | Fully wired, credentials empty | Missing config only | A Google Cloud OAuth client (id+secret) with the right redirect URI | Set the 2 vars, re-test AUTH-08 | critical-before-demo |
| Resend email credentials | Fully wired, credentials empty | Missing config only | A Resend API key + verified sending domain + real `EMAIL_FROM` | Set the vars, re-test AUTH-09 | critical-before-demo |
| Parental consent is recorded but not enforced | Self-attested toggle, correctly server-derived, never required | Built as a marker of the requirement, not a working gate | A policy decision: block under-13 signup, or fund a real verifiable-consent flow (reviewed for COPPA) | Make the toggle a hard requirement short-term | **critical-before-mvp** |
| No profile/settings screen | Data layer supports overwrite; no UI exists | Onboarding was built one-shot | A decision on where profile editing lives | Add an edit screen reusing the existing wizard + upsert path | recommended |
| Nobody can hold the admin role | Sync route gates on a role nothing ever assigns; dev sign-in ignores the DB value entirely | Role model built ahead of any way to administer it | Which email(s) should be admin | A promotion script or env allow-list, plus wiring the dev provider to read the real role | **critical-before-mvp** |
| MongoDB points at a local, credential-free DB | Working for dev | Not production-appropriate | A hosted MongoDB (Atlas) connection string, readWrite-scoped | Set `MONGODB_URI`, run `db:init` (safe, non-destructive) | required-before-production |
| `AUTH_SECRET`/`AUTH_URL` are local dev values | Set locally | Must not be reused | A freshly generated secret; the real public URL | Set both in the hosting env | required-before-production |
| Seeded demo account | Full synthetic history | Demo scaffolding, not real activity | Nothing — just don't run `db:seed` against prod | Never point `db:seed` at production | recommended |
| Sign-in shows no error text | Page ignores Auth.js's `?error=` param | Not built for the first screen | Nothing — implementation gap | Render a friendly message per error code | recommended |
| No sign-in rate limiting | The rate limiter exists but is wired only into Coach | Out of MVP scope | A decision on Upstash vs. host-level protection | Throttle magic-link requests before public launch | required-before-production |
| "For You" feed card fabricates analytics | Static seed text shown to every account, no label | Placeholder for a future real ranking feature | A decision: delete, relabel, or compute for real | Add an `isSimulated`-style label, or generate from real `weakestZone` | **critical-before-demo** |
| Daily quotes expire after 14 days | Date-stamped rows, exact-match lookup | Quick demo shortcut | A larger quote pool + rotation logic | Rotate by day-of-year modulo pool size, or add a fallback | required-before-production |
| Placeholder drill-demo video asset | One 404ing GCS URL referenced everywhere | No real footage produced/licensed | Real, licensed drill/study clips + a real GCS bucket | Upload real assets, wire a player component (none exists yet) | required-before-production |
| Saved feed items have no destination screen | Real write, no read UI | Built ahead of the screen | A decision: Saved tab, or drop the button | Add a saved-items view or remove the button | recommended |
| Feed ranking ignores all real activity | Tag-overlap-only scoring | Built before Shot Sessions/Goals existed | Confirm what "personalized" must mean for the demo | Wire in `weakestZone` + active goal types | future-phase |
| The 12–14-drill library is developer-placeholder content | Hardcoded in the seed script | Not the owner's real curriculum; too small to avoid off-topic padding | The real drill curriculum (≥5–6 per skill/difficulty) | Move authoring out of the seed script | **critical-before-mvp** |
| Drill demo videos | Field plumbed everywhere, rendered nowhere, no content | Both content and player component missing | Hosted demo clips per drill | Add a video element + populate `videoUrl` | recommended |
| Flat duration estimates (6 min/drill, 15 min single-drill) | Placeholder heuristic | Not derived from real sets/reps/seconds | Realistic per-drill time data | Compute from real drill fields; recompute on append | recommended |
| BALLDONTLIE_API_KEY | Fully wired client, key empty | Missing config, response shape never verified live | A balldontlie.io API key | Set it, then verify the response shape before trusting a full sync | required-before-production |
| No in-app UI to trigger the roster sync | API-only | Admin dashboard is explicit Phase 2 | A product decision on whether one is needed before Phase 2 | Build a minimal trigger UI, or accept API-only for now | recommended |
| Player editorial content limited to 2 players | Hardcoded array | Content-authoring pipeline doesn't exist yet | A content plan/budget for the rest of the roster | Build an authoring workflow beyond editing the seed script | required-before-production |
| Placeholder 50/100 skill ratings for synced players | Hardcoded fallback | Placeholder until a human rates the player | Authored ratings, or approval to hide/label the tab | Gate the tab behind `hasEditorialContent` | required-before-production |
| Player imagery doesn't exist | Field declared, never written/read | Licensing not resolved | A licensed image provider/CDN | Populate `playerImageUrl` during sync, swap the Avatar component | recommended |
| GCS credentials for video storage | Fully wired, empty | Not provisioned yet | GCS project + bucket + service-account JSON | Set the 3 vars, re-test one upload end-to-end | required-before-production |
| Dev-only local video storage fallback | Real, unauthenticated static files | Placeholder for zero-cloud-cost dev testing | Nothing technical — a retention policy decision | Delete/disable once GCS is live; confirm no staging env runs in dev mode | required-before-production |
| GCS signed URL expires in 7 days, stored permanently | Never re-signed | Shortcut to avoid an authenticated media-proxy | Nothing — implementation gap | Store the object path, mint fresh signed URLs per request | required-before-production |
| Simulated mechanical breakdown | 4 hard-coded templates, deterministic hash selection | Real CV/pose-estimation is explicit Phase 2 | A Phase-2 CV vendor/budget decision; sign-off on current disclosure wording | Implement a real provider behind the existing interface | future-phase |
| Per-shot replay feedback line has no label | 2 canned sentences | Written alongside the labeled provider but never got its own disclosure | A decision: delete it, or label it like Mechanical Breakdown | Add the same disclosure treatment | **critical-before-demo** |
| Seeded demo shot session is self-contradictory + 404s | Fixed fixture | Dev convenience data | Nothing — but don't demo from it | Recompute the fixture from its own shots, or drop it and demo from a live upload | **critical-before-demo** |
| Game Film | Static placeholder; schema provisioned, zero implementation | Explicit later build phase | Confirmation of whether it's in the current milestone | Build the simulated provider + upload/results flow, matching the Shooting Session pattern | **critical-before-mvp** |
| No upload rate limit/quota/duration cap | Buffers up to 100MB in server memory, no throttle | MVP shortcut | A view on acceptable cost/abuse risk | Move to direct-to-GCS signed uploads + per-user throttling | required-before-production |
| `OPENAI_API_KEY` | Fully wired, degrades gracefully, empty | Missing config only | An OpenAI key with billing enabled | Set it, then re-verify CCH-09/CCH-10 | **critical-before-demo** |
| Seeded "Welcome" Coach conversation | Hand-written, numbers don't match the real seeded session | Demo fixture, not AI output | A decision: drop it or correct+label it | Remove or fix before any demo using the seeded account | **critical-before-demo** |
| In-memory Coach rate limiter | Process-local Map, resets on restart, won't hold on serverless | Explicitly a Phase-2 Upstash swap per the code's own comment | Upstash Redis URL/token (already in `.env.example`, unused) | Swap the backing store behind the existing call site | required-before-production |
| Goals feature — no CRUD/UI | Read-only, Coach-context only | Explicit later phase | A product decision on the Goals UX | Build create/update/delete + a real tab + an auto-tracking hook | future-phase |
| ~~Confidence/Mental Game — entirely unbuilt~~ | **Resolved** — repository/service/actions/UI all shipped | Was out of scope for P0.2–P0.8; built in P1 | None | Done. Note the recovery plan is *not* a "labeled-simulated generator" as this row once proposed: it is composed in code from the player's own stored records, so there is nothing simulated to label. | resolved |
| Game Footage Analysis — entirely unbuilt | Schema only | Same as above | Same as above | Implement provider + upload/results flow | future-phase |
| `totalShotSessions` never incremented | Field carried forward unchanged | Partially-wired counter, the write hook was never added | Decide if it should ship | Add a `recordShotSessionCompletion`-style hook | recommended |
| `npm run db:seed` overwrites real `userStats` on every run | Unconditional `$set`, unlike every other seeder in the file | Breaks the script's own "idempotent, safe to re-run" claim for this one collection | Nothing — internal script fix | Change to `$setOnInsert` / skip-if-exists | recommended |
| NBA player study clip | Text-only disclosure, no video | Licensing not secured | Licensed study footage + a real video player component | Build the player; source the footage | required-before-production |

---

## 5. Environment Variables Audit

*No values are reproduced anywhere in this document — only names and whether each is currently set or empty in this environment's `.env.local`.*

| Variable | Required? | Currently in `.env.local` | Production Requirement | Used By | If Missing |
|---|---|---|---|---|---|
| `MONGODB_URI` | **Yes, always** | SET | Real hosted MongoDB, readWrite-scoped user | `src/server/db/client.ts` (module-eval time!), all repositories, `scripts/db/*` | **Crashes the entire app at module load** — not just DB-touching pages, because `proxy.ts` transitively imports this module on almost every request. |
| `MONGODB_DB_NAME` | No | SET | Recommended explicit | same | Silently defaults to `"hoopsync"`. |
| `AUTH_SECRET` | Yes | SET | Required, must be a **new** value for production | Auth.js internals (not read by app code directly) | `MissingSecret` — every authenticated request fails. |
| `AUTH_URL` | Conditional | SET | Set to the real public HTTPS origin | Auth.js internals | Falls back to inferring from request headers; can break OAuth callbacks behind a proxy. |
| `GOOGLE_CLIENT_ID` | Conditional | **EMPTY** | Required if Google sign-in is offered | `src/server/auth/auth.config.ts:25` | No throw — button always renders; fails at click-time with a generic error page (no `isConfigured()` guard exists for this provider). |
| `GOOGLE_CLIENT_SECRET` | Conditional | **EMPTY** | Same | same | Same. |
| `EMAIL_SERVER_API_KEY` | Conditional | **EMPTY** | Required if email sign-in is offered | `auth.config.ts:32` | Same pattern — generic error page, no HoopSync message. |
| `EMAIL_FROM` | Conditional | SET (placeholder value) | A real, domain-verified sender | `auth.config.ts:33` | Falls back to Auth.js's own default sender, which the email provider will reject for an unverified domain. |
| `OPENAI_API_KEY` | Conditional (required for Coach to be functional) | **EMPTY** | Required, billing enabled | `src/server/external/openaiClient.ts` | The **one integration with fully graceful degradation**: throws a clear internal error, caught by `coachService`, user's message still saves, honest inline message shown — no crash, no fabricated reply. |
| `OPENAI_MODEL` | No | SET | Optional | `openaiClient.ts:29` | Falls back to `"gpt-4o-mini"`. |
| `BALLDONTLIE_API_BASE_URL` | No | SET (default) | Optional | `balldontlieClient.ts` | Falls back to the real public API URL. |
| `BALLDONTLIE_API_KEY` | Conditional (required for the roster sync only) | **EMPTY** | Required for the sync to ever succeed | `balldontlieClient.ts:41` | Clear 502 `EXTERNAL_SERVICE_ERROR`; rest of the app unaffected. **Also gated by the unreachable admin role — see Bug NBA-1.** |
| `GCS_PROJECT_ID` | No | **EMPTY** | Optional | `gcsClient.ts:35` | Passed through as `undefined`; no error. |
| `GCS_BUCKET_NAME` | Conditional (required in production) | **EMPTY** | Required | `gcsClient.ts`, `videoStorageService.ts` | Dev: silent local-disk fallback. **Production: throws instead of falling back.** |
| `GCS_SERVICE_ACCOUNT_KEY_JSON` | Conditional (required in production) | **EMPTY** | Required, single-line JSON string | same | Same as above; if present-but-invalid JSON, a distinct clear error. |
| `SEED_DEMO_USER_EMAIL` | No | Not present | N/A — dev/test only | `scripts/db/seed.ts:44-45` | Falls back to the placeholder `demo.player@hoopsync.dev`. **Not documented in `.env.example`** (a real, if minor, documentation gap). |
| `NODE_ENV` | Conditional (platform-managed) | SET (`development`) | **Must be `"production"`** in every real deployment | `auth.config.ts`, `db/client.ts`, `videoStorageService.ts`, `sign-in/page.tsx` | If ever left non-`"production"` in a real deployment: the passwordless dev sign-in becomes reachable to anyone on the internet — **the single highest-impact configuration risk in this entire app.** |
| `APP_BASE_URL` | No | SET | Test-tooling only | `playwright.config.ts` only — not read by the running app at all, despite being filed under "App" in `.env.example` | Falls back to `http://localhost:3000`. |
| `CI` | No | Not set | Platform-managed | `playwright.config.ts` | Falls back to local-dev defaults (no retries, reuse dev server). |
| `SENTRY_DSN` | No | **EMPTY** | Not yet consumed by any code | *(no file reads this — no `@sentry/*` package installed at all)* | Nothing — error monitoring is simply unimplemented. |
| `UPSTASH_REDIS_REST_URL` | No | **EMPTY** | Not yet consumed by any code | *(zero references anywhere in `src/`/`scripts/`)* | Nothing — the durable rate limiter this would back does not exist yet. |
| `UPSTASH_REDIS_REST_TOKEN` | No | **EMPTY** | Same | Same | Same. |

**Two documentation defects worth fixing regardless of feature work:** (1) `SEED_DEMO_USER_EMAIL` is read by code but absent from `.env.example`. (2) `SENTRY_DSN`/`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are listed in `.env.example` implying they're wired up, but zero code reads any of them today — providing real values right now would have no effect at all.

---

## 6. Real vs. Seed vs. Simulated Matrix

| Feature | Real | Seed/Demo | Simulated | Requires Config | Future Scope |
|---|:---:|:---:|:---:|:---:|:---:|
| Authentication (Google/Email) | ✔ | | | ✔ | |
| Authentication (dev-only) | | | ✔ (dev-only bypass) | | |
| Onboarding persistence | ✔ | | | | |
| Parental consent (recorded) | ✔ (flag) | | | | *(enforcement missing)* |
| Home feed personalization logic | ✔ | | | | |
| Home feed content (8 cards) | | ✔ | | | |
| "For You" card | | ✔ | *(presented as real)* | | |
| Feed Like/Save/Share/Ask Coach/Start Drill/Add to Workout | ✔ | | | | |
| Feed "Related" | ✔ (client toggle) | | | | |
| NBA roster (2 players) | | ✔ | | | |
| NBA full roster (500+) | | | | ✔ (blocked further by admin-role bug) | |
| NBA skill ratings | | ✔ (editorial opinion) | | | |
| NBA player imagery | | | | | ✔ (missing) |
| Workout generation engine | ✔ (deterministic rules) | | | | |
| Drill library content | | ✔ | | | |
| Drill demo video | | | | | ✔ (missing) |
| Workout execution/completion | ✔ | | | | |
| Progress stats/streak | ✔ | | | | |
| Video upload/storage | ✔ | | | ✔ (GCS) | |
| Shot logging (make/miss/location) | **✔ — fully real, no CV** | | | | |
| Zone classification | ✔ | | | | |
| Report math (attempts/FG%/zones) | ✔ | | | | |
| Best/weakest zone selection | ✔ (real data, weak tie-break) | | | | |
| Exact shot replay (seek position) | ✔ | | | | |
| Per-shot replay feedback text | | | **✔ (unlabeled)** | | |
| Mechanical breakdown narrative | | | **✔ (labeled)** | | |
| Recommended workout (from session) | ✔ | | | | |
| Share With Coach hand-off | ✔ | | | | |
| Game Film | | | | | ✔ (missing) |
| AI Coach replies | | | | ✔ (OpenAI key) | |
| Coach system-prompt context | ✔ | | | | |
| Coach personality prompts | ✔ | | | | |
| Seeded demo Coach conversation | | ✔ | *(presented as real)* | | |
| Coach rate limiting | ✔ (works, not durable) | | | | ✔ (Upstash swap) |
| Goals | | ✔ (data only) | | | ✔ (missing CRUD/UI) |
| Confidence/Mental Game | ✔ | | | | |

---

## 7. Production Readiness Audit

### Critical before ANY demo (fix or disclose to whoever is driving)
1. The seeded demo shot session is internally contradictory and its video 404s — **demo from a live upload, not the seeded session** (Bug Analyze-2/3).
2. The seeded "Welcome conversation" cites numbers that don't match the seeded session and claims context that isn't attached — **do not open it during a demo, or fix it first** (Bug Coach-1).
3. The "For You" feed card presents a fabricated weakness to every account, including brand-new ones, with no label (Bug Feed-1).
4. The per-shot replay feedback sentence is unlabeled generated text (Bug Analyze-1).
5. `OPENAI_API_KEY` is unset — Coach cannot produce a single live reply. Set it before any stakeholder walkthrough that includes Coach.
6. The 12–14-drill library is small enough to visibly pad workouts with off-topic drills (Bug Train-1) — acceptable to disclose for a demo, not for MVP evaluation.

### Critical before MVP evaluation
7. Nobody can ever hold the admin role — the NBA roster sync (a headline BRD feature: "full current roster") is structurally unreachable even with a balldontlie key (Bug NBA-1).
8. Parental consent for under-13 accounts is displayed but not enforced (Bug Auth-1) — a real compliance exposure for a youth product, not just a UX gap.
9. Game Film is one of the two advertised Analyze entry points and is a complete dead end (static placeholder, zero backing code).
10. The real drill/player-editorial content libraries are far too small for a genuine evaluation (12–14 drills, 2 players).

### Required before production
11. Real credentials for Google OAuth, Resend email, balldontlie, and GCS — until then there is **no working real sign-in method at all** in a production build (the dev bypass is correctly excluded there).
12. `npm run db:seed`'s destructive overwrite of the demo account's `userStats` (Bug Seed-1) — low severity today, but confirms the script isn't safe to run against any environment holding real user data; formalize "never run `db:seed` against production" as policy, not just convention.
13. The in-memory Coach rate limiter does not survive a restart and will not hold at all on a serverless deployment (no per-instance shared state) — swap to the already-scaffolded Upstash Redis before opening Coach to real users.
14. GCS signed URLs expire in 7 days and are never re-signed — all shooting-session video and replay silently breaks a week after upload in production as currently built.
15. Sign-in failures are invisible (the page never reads Auth.js's `?error=` param) — a real user account-linking conflict looks like the button did nothing.
16. No rate limiting exists on sign-in or video upload; the upload route buffers up to 100MB in server memory with no per-user quota.
17. Uploaded athlete video (much of it minors) is served from unauthenticated URLs in both storage modes today.

### Recommended improvements (not blocking, worth doing)
18. Ten onboarding fields are collected and never used anywhere — either wire them in or drop them from the wizard.
19. No profile/settings screen exists — a player can never change any onboarding answer.
20. Several UX inconsistencies across the 5 different workout-creation entry points (navigation targets, duration estimates, hardcoded durations).
21. Workout completion destroys the honest per-drill completion record (force-marks everything true).
22. `totalShotSessions` is a dead counter; Progress never reflects shooting-session activity at all.
23. Daily quotes silently vanish after 14 days with no rotation/fallback.

### Explicitly Phase 2 / future scope (already correctly deferred, not a gap in this audit)
24. Goals CRUD/UI, Confidence/Mental-Game check-ins, Game Footage Analysis, real pose-estimation mechanical analysis, a durable/shared rate limiter, error monitoring (Sentry), an admin content-authoring UI, expanded NBA player imagery.

---

## 8. Verification Run Log (this audit)

All of the following were executed for real during this audit, against commit `b77009f` on `master`, clean working tree:

- **`npm run typecheck`** — clean, 0 errors.
- **`npm run lint`** — clean, 0 errors (1 pre-existing, unrelated warning in `onboarding-wizard.tsx` about a React Compiler memoization skip).
- **`npm run test`** (Vitest, 17 files) — **88/88 passed** on a clean run. (One run mid-audit showed 7 files failing with `mongod.stop()` errors from `mongodb-memory-server` instances timing out under concurrent load from this audit's own background work — an environment/resource-contention artifact, not a code regression; confirmed by an immediate clean re-run passing 88/88.)
- **`npx playwright test`** (`tests/e2e/founder-loop.spec.ts`, 11 serial tests against a real dev server + real local MongoDB) — **11/11 passed (3.6 minutes)** on the run backing this document, walking the entire founder loop with real, freshly-created account data. Getting that clean run took 3 attempts: the first two failed on `Error: Timed out waiting 120000ms from config.webServer` — Playwright's own health-check giving up before the dev server's first cold Turbopack compile of `/` finished (independently measured at 81s for a bare request during this same audit, consistent with the machine being under heavy load right after the 10-agent audit workflow completed). This is an environment-timing characteristic, not an application defect — confirmed by bumping only `playwright.config.ts`'s `webServer.timeout` (120s → 5 minutes, a test-infrastructure config value, not application code) and getting an immediate clean pass.

No application code was changed during this audit. The one file touched was `playwright.config.ts`'s `webServer.timeout`, for the reason above.

---

## 9. All Bugs Found, Consolidated by Severity

**High**
- The per-shot replay feedback sentence is unlabeled simulated text (`src/components/analyze/shot-replay-dialog.tsx`).
- The seeded demo shot session's hardcoded best/weakest/narrative contradicts its own shot data; every zone is actually 50% (`scripts/db/seed.ts`).
- The seeded demo session's video URL 404s (`scripts/db/seed.ts`).
- The "For You" feed card presents fabricated analytics as real, to every account (`scripts/db/seed.ts`).
- The under-13 parental-consent toggle is displayed but not enforced — Finish succeeds regardless (`src/lib/validation/onboarding.ts`).
- The NBA roster sync is unreachable by any account, ever — nobody can hold the admin role, and the dev sign-in ignores the DB's role field entirely (`src/app/api/nba-players/sync/route.ts`, `src/server/auth/auth.config.ts`).

**Medium**
- Workout generation always pads to 4 drills with off-topic drills once real matches run out (`workoutGenerationService.ts`).
- Completing a workout force-marks every drill complete, destroying the real per-drill record (`workoutService.ts`).
- Workout difficulty is cosmetic — never restricts which drills a young/beginner player can receive (`workoutGenerationService.ts`).
- A player with no equipment saved gets a silently off-topic workout under an on-topic title (`workoutGenerationService.ts`).
- "Start Drill" duplicates a workout on every click and mislabels its own action (`feed-card.tsx`).
- "Ask Coach" creates unlimited empty duplicate conversations (`coachService.ts`).
- Share does nothing visible on an insecure origin while still recording the share (`feed-card.tsx`).
- The daily quote card silently disappears 14 days after seeding (`scripts/db/seed.ts`).
- A search with no NBA-player matches renders a blank page with no message (`players/page.tsx`).
- "Generate Workout Modeled After" degenerates to an arbitrary result for any roster-synced (unauthored) player (`nbaPlayerService.ts`).
- A search with no matches / both player-action buttons swallow the real, actionable server error and show a generic one (`generate-player-workout-button.tsx`, `signature-move-card.tsx`).
- The roster sync issues 1,100+ serialized DB round-trips per full sync with no batching/resume — likely to time out on a serverless host.
- Best/weakest zone selection has no minimum-attempt threshold and an arbitrary tie-break, so one lucky/unlucky shot can crown a zone (`shot-zones.ts`).
- The Analyze hub always shows "0/0 logged so far" for an in-progress session (`analyze/page.tsx`).
- GCS signed URLs expire in 7 days and are never re-signed — replay silently breaks a week after upload in production.
- Every AI failure is swallowed with zero server-side logging — an outage vs. a bad key vs. a quota limit are indistinguishable to the operator (`coachService.ts`).
- A failed Coach reply returns HTTP 200, and the explanation disappears on reload with no trace (`coach-chat.tsx`).
- `npm run db:seed` silently resets the demo account's real accumulated `userStats`/workouts/goals every time it's re-run (`scripts/db/seed.ts`).
- The seeded demo Coach conversation cites numbers that contradict the real seeded session and claims context that isn't attached (`scripts/db/seed.ts`).

**Low**
- Clearing team-onboarding fields writes `null` into fields typed as optional-absent strings (BSON `undefined`→`null` serialization).
- The proxy's public-path check is prefix-based, not exact — latent, no current exploit.
- Appending a drill to a workout never recalculates its shown duration estimate.
- A completed workout still exposes a live per-drill toggle that can desync it from "completed."
- `completeWorkout` accepts a workout that was never started.
- `active-workout.tsx` would crash on a zero-drill workout (not reachable via any current UI path, but not validated at the schema level either).
- The helpful "no drills match your equipment" message is a thrown string that production's error redaction will hide from the user.
- The rate-limiter's window map is never pruned (unbounded, slow growth).
- Two Coach-repository write helpers don't scope by `userId` at the query level (no live exploit today; ownership is enforced one layer up).
- `replayEndSeconds` is computed, stored, and tested, but never read by any UI — replay never stops at the end of its window.
- `logShotAction`'s returned counters are always 0 during logging (dead/misleading return value; current caller ignores it).
- Shot removal is optimistic with no rollback on a failed server call.
- Upload extension inference doesn't cover several real video MIME types, defaulting them to `.mp4`.
- `totalShotSessions` is declared and read but never incremented by any real code path.
- `nba-player-service.test.ts` hand-reimplements the real height-parsing helper instead of testing the real export.

---

*Document generated as a full, evidence-based audit of the codebase at commit `b77009f`. Every claim above traces to a specific file (and in almost all cases a line range) inspected directly during this pass — ask for the citation on any item before acting on it if it isn't already visible in the source tables above.*

---

## Addendum: NBA Player Mode findings resolved in P0.9.2

*Appended after the fact. The audit above is a point-in-time record of commit `b77009f` and has deliberately not been rewritten — this section records which of its NBA Player Mode findings are no longer true, so the tables above are not read as current.*

Resolved in `e2ce92f` (P0.9.2), verified by 357 unit/integration tests and 31 Playwright tests against real MongoDB:

| Audit finding | Status | How |
|---|---|---|
| **NBA-1** (High) — nobody can hold `admin`, roster sync unreachable | Fixed | `ADMIN_EMAILS` allow-list resolved in the `jwt` callback (`auth.config.ts`), plus `npm run db:sync-roster`, which needs no account at all. |
| **NBA-3** (Medium) — "Modeled After" degenerates to an arbitrary tie-break for synced players | Fixed | Skills now resolve through the archetype pack, and `derivePlayerTendencies` reads only *authored* signals; a genuinely unknown player raises a clear error instead of inventing a focus. |
| **NBA-4** (Medium) — no-match search renders a blank page | Fixed | Explicit no-results state naming the active filters, with a "Clear filters" action. |
| **NBA-5** (Medium) — player action buttons swallow the real server error | Fixed | Both buttons surface `err.message`. |
| Roster is 2 hand-seeded players | Fixed (needs a key) | `db:sync-roster` pulls the full active roster; every unauthored player is backed by an authored archetype pack, so BRD 7.4's "every profile has a signature move + drill" holds league-wide. |
| Sync issues 1,100+ serialized round-trips, likely to time out | Fixed | Batched `bulkWrite` (`bulkUpsertSyncedPlayers`). |
| Player imagery missing; `playerImageUrl` never written or read | Fixed | Generated deterministic player cards; `playerImageUrl` is rendered when present and remains the licensed-provider swap point. No scraped imagery. |
| Study clip is text-only, no video element | Fixed | `StudyClipPlayer` with timestamped call-outs that seek the video; footage disclosure driven by the media asset's own `source`. |
| Placeholder 50/100 skill ratings shown as real | Fixed | Archetype-resolved ratings, explicitly labeled as a role profile rather than the player's statistics. |
| Feed → player profile link missing (FEED-13) | Fixed | Feed cards carrying `relatedPlayerId` now link through. |
| `nba-player-service.test.ts` reimplements height parsing instead of testing the real export | Fixed | `tests/unit/nba-roster.test.ts` tests the real `parseHeightToInches`. |

**Corrected by evidence since the audit:** the audit's env table says `BALLDONTLIE_API_KEY` is "required for the sync to ever succeed," which is true but incomplete. `GET /players/active` is an **ALL-STAR tier** endpoint ($9.99/mo); a free-tier key returns 401. The free tier offers only `GET /players`, which returns every player in league history with no "active" flag and cannot express a current roster. Verified against the live API.

**Still open from the audit's NBA scope:** no in-app UI triggers the sync (CLI + API only — the admin dashboard remains Phase 2 per BRD 6.2), and hand-authored editorial content still covers only two players. Archetype packs make that a content-depth question rather than a coverage gap.

**Not yet verified anywhere:** the roster sync has never run against the live balldontlie API, because no ALL-STAR key has been available. The response *shape* was confirmed against the live free-tier `GET /players` and matches the client's interface exactly, including `weight` as a string and nullable `draft_*` fields — but bulk behaviour at ~570 players remains untested.

---

## Addendum: Goals findings resolved

*Appended after the fact, for the same reason as the NBA addendum above: the
audit is a point-in-time record of commit `b77009f` and has not been rewritten.
This section records which of its Goals findings are no longer true.*

The audit's Goals verdict — "placeholder, always", "the tab never queries them",
"`autoTrackedMetricKey` is declared and seeded but read by zero application
code — nothing auto-tracks anything" (§2.8 rows, DEF-01, and the §"future-phase"
table) — was already stale when written against `e2ce92f`, which shipped the
full slice: catalog, repository, service, Server Actions, Zod schema and a real
Goals tab inside Progress.

| Audit finding | Status | How |
|---|---|---|
| **DEF-01** — Goals tab is always a placeholder; neither seeded goal renders | Fixed | `GoalsTab` renders real `GoalDoc`s loaded by `progress/page.tsx`. |
| Goals data model — "read-only, Coach-context only", no create/update/delete | Fixed | Create / archive / reopen / delete via `goalActions.ts`; `createGoalSchema` validates against the catalog's per-type bounds. |
| `autoTrackedMetricKey` read by zero code — "nothing auto-tracks anything" | Fixed | `recalculateGoalsForUser` resolves it from real records at all three activity choke points (workout completion, session finalize, game-film analysis). |
| Seeded goals show raw metric keys as units ("33 / 38 percent") | Fixed | The catalog is the display authority for units, and the seed now reads its units from it rather than retyping them. |

Fixed in this pass, beyond what the audit found:

- **A weekly goal could only ever be achieved once.** "Train 4x per week" latched
  to `completed` on first reaching target and was then excluded from
  recalculation permanently, and its persisted value went stale whenever the
  rolling window slid. Weekly goals now never latch, and `listGoalsForUser`
  re-resolves them on read (without writing, since that path is a GET).
- **Counting goals opened already finished.** Progress was seeded from lifetime
  totals, so a player with 25 workouts setting "complete 20 workouts before
  tryouts" got a goal that was complete on creation. Those goal types now record
  a `baselineValue` and count from when the goal was set. Absent baseline reads
  as 0, so existing documents keep their previous behaviour.
- **Game data never reached goals.** `gameFootageService` was the one activity
  path that never recalculated. It now does, and there is a goal type backed by
  a count of films the player really uploaded and reviewed.
- **Goal completion was silent.** `recalculateGoalsForUser` returned the newly
  completed goals and both callers discarded them; they are now surfaced.

**Deliberately not done:** no goal metric reads the *content* of a game film
analysis. That content is generated, and BRD 7.12's "wherever possible" does not
extend to driving a progress bar the player reads as a measured fact about their
game. The honest game-data signal is the count of reviews, which is a real
action the player took.
