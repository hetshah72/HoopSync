# HoopSync

AI-powered basketball development platform (Next.js App Router + TypeScript + MongoDB). See `docs/implementation-plan.md` for the full architecture plan.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `.env.local`:
   - `MONGODB_URI` / `MONGODB_DB_NAME` - your hosted MongoDB connection string. The DB user should be scoped to `readWrite` on this database only.
   - `AUTH_SECRET` - generate with `npx auth secret`.
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI for local dev.
   - `EMAIL_SERVER_API_KEY` / `EMAIL_FROM` - a [Resend](https://resend.com) API key, for email magic-link sign-in.
   - `OPENAI_API_KEY` - powers the AI Coach chat and generated feedback text.
   - `BALLDONTLIE_API_KEY` - optional for the free tier; needed for higher rate limits.
   - `GCS_PROJECT_ID` / `GCS_BUCKET_NAME` / `GCS_SERVICE_ACCOUNT_KEY_JSON` - Google Cloud Storage bucket + service-account key (as a single-line JSON string, not a file path) for video uploads.

3. **Initialize the database** (creates collections, validators, and indexes - safe to re-run)

   ```bash
   npm run db:init
   ```

4. **Seed development data** (idempotent - safe to re-run)

   ```bash
   npm run db:seed
   ```

   This seeds shared content (drills, feed items, daily quotes) and one demo player with a populated profile, workouts, a shot session, goals, and a Coach conversation. Sign in with the **Email** option using `demo.player@hoopsync.dev` to view it (requires `EMAIL_SERVER_API_KEY` to actually receive the magic link), or set `SEED_DEMO_USER_EMAIL` in `.env.local` to your own address before seeding. NBA player data isn't seeded here - it's synced from balldontlie.io by a service added in a later build phase.

5. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (unit + integration) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run format` | Prettier, writes in place |
| `npm run db:init` | Create/update collections, validators, indexes |
| `npm run db:seed` | Idempotent dev/test sample data |

## Project structure

See `CLAUDE.md` for the layering rule (routes/actions -> services -> repositories -> db client) and `docs/implementation-plan.md` for the full architecture, database design, and phased build plan.
