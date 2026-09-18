# HoopSync — BRD Clarification v1.1

**Status:** Founder-approved clarification of MVP scope, layered on top of `HoopSync_BRD_v1.0.md` (unedited historical baseline). This document does not replace v1.0 — it sharpens ambiguous areas and records decisions made after v1.0 was written.

**Source:** Co-founder review of the full BRD, plus four "Shooting Report" reference screenshots, reconciled against the actual codebase in `docs/implementation-plan.md` §-referenced sections. See that document's "Founder Clarification Addendum" for the full technical reconciliation.

---

## 1. Clarified MVP Scope

No features were added beyond BRD v1.0 §6.1. This document clarifies priority, structure, and data relationships within that same scope:

- Onboarding
- Home / personalized Feed
- Train / generated workouts
- NBA Player Mode
- **Analyze** (standalone top-level section — see §4 below), containing:
  - Shooting Session
  - Game Film
- Share to Coach
- AI Coach + personality
- Basic confidence/mental support
- Progress (with Goals nested inside it)
- Fully connected app state

## 2. Final MVP Product Loop

This is the exact sequence the MVP must demonstrate end-to-end, with zero dead buttons:

```
Onboard
  → Personalized Home
  → Study Player → Learn Skill
  → Generated Workout → Complete Workout → Progress Updates
  → Shoot → Analyze → Tap Shot → Exact Replay → Feedback
  → Share to Coach → Coach understands the session
  → Adjust Training → Train again → Progress updates
  → Feed gets smarter
```

## 3. MVP vs. Phase 2 (re-confirmed, unchanged from v1.0 §6.2/§6.3)

Phase 2 remains: advanced shooting mechanics (real pose-estimation), advanced game-film analysis (real event/object detection), XP/achievements, notifications, live/real-time Coach, expanded drill library (~1,000 drills), full admin dashboard, payments, live video coaching, Apple Sign-In.

## 4. Analyze Is a Standalone Section

**This is the single most important structural clarification.** Shooting Session analysis and Game Film analysis are their own major section — not a feature reachable only through Coach.

Navigation: **Home | Train | NBA Players | Analyze | Coach | Progress**

Inside Analyze: two entry points — Shooting Session, Game Film. The player records/uploads there; results appear directly inside Analyze. Coach is reached only afterward, optionally, via "Share With Coach."

## 5. Shot Detection: How MVP Actually Works

Real basketball computer-vision shot detection is out of scope for the Sept 14 timeline. Rather than fabricating shot data (the original plan's approach), MVP uses **manual tap-to-log**: the player records or uploads a shooting clip, then logs each attempt — court zone tap + make/miss — during or after recording. Every resulting `Shot` record is therefore real: real zone, real make/miss, real video timestamp.

Only the *mechanical narrative* (why a shot pattern looks the way it does) is generated/simulated, and it is **explicitly labeled as such in the UI** — e.g. "Simulated mechanical analysis. In production a pose-estimation model derives these observations frame-by-frame from your uploaded video," matching the disclosure pattern already present in the founder's own reference screenshots. Advanced real biomechanical analysis remains Phase 2.

Game Film analysis follows the same pattern: no real event-detection CV for MVP; strengths/weaknesses/recommendations are generated, informed by the player's real profile data, and clearly labeled as demo/heuristic analysis. Advanced real game-film analysis remains Phase 2.

## 6. Shooting Report Requirements

The Shooting Report (Analyze → Shooting Session results) must include, in this order:

1. Session summary: attempts, makes, misses, FG% — all computed from real shot records.
2. Interactive shot chart with All/Made/Missed filters — every marker is a real, tappable `Shot`.
3. Tap-to-replay: tapping a shot marker seeks the associated video to that shot's exact timestamp and shows shot-specific feedback. Never a generic clip, never the start of the full video.
4. By-zone breakdown across a fixed 9-zone taxonomy: Top of Key 3, Right Wing 3, Right Mid, Right Corner 3, Left Wing 3, Left Mid, Free-Throw Mid, Paint, Left Corner 3 — each showing makes/attempts and FG%.
5. Strength and Needs Work call-outs, derived from actual zone performance (not randomly selected).
6. Mechanical Breakdown: observation → makes-vs-misses pattern → potential issue → correction → recommended drill, scoped to the weakest zone, clearly labeled as simulated/demo analysis.
7. Recommended Workout: a real, startable `Workout` built from the session's weakest zone.
8. Share With Coach: hands the full session context (not a one-line summary) to a Coach conversation.

### Acceptance test (the 17-point Shooting Report test)

1. User completes/uploads a shooting session.
2. Session is processed (manual tap-to-log, not simulated detection).
3. Real shot records are created.
4. Attempts, makes, misses, and FG% are calculated from those records.
5. Shot markers appear on the court.
6. Made/Missed filters work.
7. Tapping a shot selects the correct Shot ID.
8. The correct associated video opens.
9. Video seeks to the exact shot timestamp.
10. Shot-specific feedback appears.
11. Zone breakdown is calculated from shot data.
12. Strength and weakness are derived from actual data.
13. A relevant workout is recommended.
14. Starting that workout enters the Train flow.
15. Completing the workout updates Progress.
16. Share With Coach passes actual session context.
17. Coach demonstrates awareness of the shared session.

## 7. Connected-State Requirements

Every one of these relationships must be real and traversable in the UI, not just modeled in the database:

- Workout → Progress
- Shot Session → Shooting Stats
- Shot → Exact Replay → Analysis
- Analysis → Share to Coach → Coach gets context
- NBA Player Study → Drill/Workout
- Game Weakness → Recommended Workout
- Feed Content → Save/Add to Workout/Ask Coach

## 8. No-Dead-Button Rule

No button in the core MVP loop (§2) may be a fake interaction, a placeholder, or disconnected from real data. This applies to every feed action, every Analyze interaction, every Coach hand-off, and every workout/goal/progress update.

## 9. What Changed From v1.0 (for traceability)

- Shot detection: v1.0 assumed some form of AI shot detection without specifying it; the original engineering plan filled that gap with full simulation. **v1.1 resolves this as manual tap-to-log (real data) + a labeled simulated mechanical narrative layer.**
- Analyze: v1.0 implied Shot Tracker and Game Footage Analysis as features but didn't state they must be a standalone top-level nav section separate from Coach. **v1.1 makes this explicit.**
- Progress/Goals navigation: not specified in v1.0. **v1.1 clarifies Progress is a top-level nav item; Goals lives within Progress rather than as its own tab.**
- Zone taxonomy: not specified in v1.0. **v1.1 fixes a 9-zone taxonomy** per the founder's reference screenshots.
- Everything else in this document is a clarification/priority statement, not a scope change.
