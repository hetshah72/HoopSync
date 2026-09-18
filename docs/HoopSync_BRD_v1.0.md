# HoopSync — Business Requirements Document

**AI-Powered Basketball Development Platform**

| Field | Detail |
|---|---|
| Version | Draft v1.0 |
| Status | Draft — for founder review |
| Date | September 7, 2026 |
| Prepared by | Het Shah, DataNova |
| Prepared for | Darshan Mehta, Priyansh Rath & Colton — HoopSync Founders |
| Source material | HoopSync kickoff call (Darshan Mehta, Priyansh Rath, Het Shah) and the companion "HoopSync — Product & Engineering Specification" document |

> **Historical baseline — do not edit.** This is a verbatim transcription of the BRD PDF provided at project kickoff. Clarifications and priority changes from later founder feedback live in `HoopSync_BRD_v1.1.md`; this file is preserved as-is for reference.

---

## 1. Document Purpose

This Business Requirements Document (BRD) translates the HoopSync product vision — captured in the founders' kickoff call and in the existing "HoopSync — Product & Engineering Specification" — into structured business requirements. It works through the product one page and feature at a time: what each feature is for, what parameters it captures or measures, what it must do, and how success will be judged.

This is the first of three planning stages agreed with the founders on the kickoff call: (1) this Business Requirements Document, (2) a Technical Architecture & Design document, and (3) development. This BRD is deliberately business- and functionality-focused; technical architecture, the data model, and technology-stack decisions are intentionally left to the companion engineering specification and the Technical Architecture phase that follows (see Section 15).

## 2. Business Objectives

1. Give youth and teen basketball players access to personalized, data-driven coaching at a fraction of the cost of a personal trainer.
2. Replace fragmented self-training — YouTube workouts, TikTok/Instagram drills, generic workout apps, in-person trainers — with one connected loop: identify weakness → learn → practice → record → analyze → receive feedback → adjust → improve.
3. Let a player study a specific NBA player's game and convert that study directly into a matching workout and drills.
4. Make shot- and game-footage analysis specific and actionable rather than generic ("keep practicing!").
5. Establish a subscription business priced against the real cost of running the AI/video pipeline, positioned as significantly better value than a $40–$50/hour personal trainer.
6. Secure a content-licensing agreement with a professional basketball league by submitting a working MVP within the league's evaluation.

## 3. Problem Statement

Basketball players who want structured development today have to assemble it themselves from YouTube workouts, TikTok/Instagram drills, in-person trainers, game film, and shooting statistics — sources that are not connected to one another and are not personalized to the player. A personal trainer can provide real one-on-one feedback but typically costs $40–$50 per hour.

HoopSync's founders — three high-school players themselves — framed the question HoopSync should answer for every user: "What specifically should I work on, how should I work on it, and is it actually getting better?"

HoopSync should function as an always-available virtual basketball trainer — it should feel like a coach a player can call on, not a static workout library.

## 4. Target Users

### 4.1 Target Users

**Primary:** Youth basketball players; middle/high-school players; AAU players; serious recreational players; players trying to make school/AAU teams; players trying to reach the next level. The founders' core reference demographic is their own peer group — roughly ages 13–18.

**Secondary:** Parents; coaches/trainers; potentially college players later.

## 5. Current State

- A low-fidelity prototype already exists (built by Darshan Mehta) that demonstrates the primary navigation — Home, Train, NBA Player Mode, Shot Tracker/Analyze, and Coach — with working buttons but placeholder data and no real video/AI processing yet.
- The prototype's visual design was explicitly called out on the kickoff call as looking generic ("AI-generated") and in need of a redesign; Priyansh Rath volunteered to lead this.
- Outside of HoopSync, a player's only structured options today are hiring a personal trainer (roughly $40–$50/hour) or self-assembling training from free online content, as described in Section 3.

## 6. Scope

### 6.1 In Scope — MVP

- Onboarding
- Home / personalized feed experience
- Train — real, generated workout flow
- NBA Player Mode — searchable player database, strengths/weaknesses, signature moves, skills/bio
- Shot Tracking — shot chart, make/miss detection, individual shot selection and exact replay, individual-shot and session analysis
- Game footage upload and basic analysis
- Share With Coach
- AI Coach, with personality settings
- Basic confidence/mental-game support
- Progress
- Goals
- Fully connected application state — no dead buttons, real data flow between modules

### 6.2 In Scope — Full Vision / Phase 2

- Advanced AI shooting-mechanics analysis
- Advanced game-film analysis
- Achievements / XP gamification
- Notifications
- Live/real-time coaching feedback via Coach, including a call-style interaction
- Expanded drill library (target: roughly 1,000 drills)
- Admin dashboard for player, content, user, and AI management
- Payments (weekly / monthly / yearly billing)

### 6.3 Out of Scope (for now)

- Any use of professional-league footage ahead of a signed license
- Full production billing/payment processing
- A full admin dashboard beyond what MVP content management needs
- Live/real-time video coaching (explicitly Phase 2)

### 6.4 Key Constraint — Content Licensing & Timeline

The founders are pursuing a content license from a professional basketball league; footage rights are not yet secured. The league requires a working MVP submitted between September 14 and October 16 before it will evaluate the team for a license. Per explicit founder guidance, this BRD and the resulting MVP must not depend on licensed league footage — the product must be demonstrable end-to-end using original, generated, public-domain, properly licensed, or clearly labeled placeholder content (see Section 7.14). If the license is granted, licensed footage replaces placeholders without requiring a redesign of the features themselves.

## 7. Business Requirements by Feature / Page

Each feature below follows the same structure: priority, business objective, the parameters it captures or displays, what the system must functionally do, how the user interacts with it, and how success is judged. Priority MVP items are the ones required for the September 14 Launchpad submission; Phase 2 items are part of the full product vision but are not required for that submission.

### 7.1 Onboarding

**Priority:** MVP

**Business Objective:** Capture enough information about each player up front — without it feeling like a survey — so that every other feature (workouts, feed, Coach) can be personalized from day one.

**Parameters Captured / Displayed**
- Account: sign in with Google (Apple / email as alternatives), name
- Physical: age, height, weight
- School: education level (middle school / high school / college), expected graduation year
- Basketball background: position, competitive level (professional / college / high school / middle school), currently on a team (yes/no), team name and level, role on the team (e.g. primary option vs. limited role)
- Goals: primary goal (e.g. become a better player, train more effectively)
- Focus areas: skills to improve (e.g. shooting, defense, ball-handling)
- Training habits: games played per week, practice frequency
- Equipment available (e.g. hoop, ball, cones)
- Coach personality preference (Encouraging / Balanced / Direct / Elite Trainer)

**Functional Requirements**
- Collect the above through a short, progressive question flow rather than one long questionnaire
- Use the responses to generate an initial personalized recommendation / starting plan
- Persist profile data so it can be edited later and is available to every other module

**User Interactions**
- Continue with Google
- Step through progressive questions
- Land on Home with a personalized starting plan

**Success Criteria**
- A new player can complete onboarding without abandoning it partway through
- Onboarding data visibly drives at least one Home-screen recommendation immediately afterward

### 7.2 Home / Personalized Feed

**Priority:** MVP

**Business Objective:** Give the player one place to open the app and immediately know what to do today, using a TikTok/Instagram-style content feed rather than a static dashboard — without becoming a social network.

**Parameters Captured / Displayed**
- Daily quote (rotates every day)
- Today's recommended workout
- "Player to learn from" suggestion
- Personalized weakness call-outs
- Progress-update summaries

**Functional Requirements**
- Generate a new "today's recommended workout" each day based on profile, goals, and recent activity
- Surface a rotating mix of: training tips, short lessons, drill demonstrations, player breakdowns, AI recommendations, confidence tips, "try this today" prompts, and player-study content
- Recompute recommendations as new shot, game, or workout data comes in

**User Interactions**
- Swipe/scroll through feed content
- Save
- Like
- Ask Coach (directly from a feed item)
- Start a drill directly from a feed item
- Add an item to a workout
- Share
- View related content

**Success Criteria**
- Feed content changes daily and reflects the player's actual recent activity, not generic filler
- Feed feels "fun and addictive… but not cluttered or overwhelming," per the founders' own framing

### 7.3 Train / Workouts

**Priority:** MVP

**Business Objective:** Turn a player's stated or inferred weakness into an actual, guided practice session that is generated for them — not copied from a generic library.

**Parameters Captured / Displayed**
- Skill category: shooting, ball-handling, finishing, defense, footwork, playmaking, athletic development
- Player-inspired input, e.g. "I want to play more like Paul George"
- Workout metadata: drills, difficulty, duration

**Functional Requirements**
- Generate a workout based on the relevant skills/tendencies of a selected NBA player, rather than serving a random pre-built workout
- Active Workout screen must show: current drill, video/instruction, coaching cues, timer, sets/reps, progress, previous drill, next/skip, and a complete button
- On completion, update Progress, training history, streak, and the relevant skill metrics

**User Interactions**
- Select a skill, or a player to model a workout after
- Step through drills in Active Workout
- Mark the workout complete

**Success Criteria**
- Completing a workout is reflected in Progress and streak with no manual re-entry
- The founders' target library of roughly 1,000 drills is tracked as ongoing content work, not a blocker to MVP launch

### 7.4 NBA Player Mode

**Priority:** MVP — called out by the founders as a major HoopSync differentiator

**Business Objective:** Let a player study a specific professional player's game and convert that study directly into workouts and drills — the feature the founders expect to be most popular with their teen audience.

**Player Database & Profile**

**Parameters**
- Player record: name, team, position, jersey number, skills, strengths, weaknesses, signature moves, associated film/content
- Profile tab — Learn: what the player does well, how they play, what to watch for, film, drills based on their game
- Profile tab — Skills: e.g. shooting, finishing, ball-handling, playmaking, defense, athleticism
- Profile tab — Bio: position, team, height, career information, other relevant metadata

**Signature Moves**

**Parameters**
- Move name (e.g. "Paul George–style hesitation into pull-up")
- What the move is
- When the player uses it
- What makes it effective
- Key mechanics
- Common mistakes
- A drill to practice it

**Functional Requirements**
- Support search and browse across the full current league roster — must not be a hardcoded or limited player list
- Source player data from a reliable, centrally-updatable data source/API rather than manual maintenance
- Every player profile must include at least one Signature Move write-up with a matching drill
- Selecting a player to "learn from" should generate a themed workout (see 7.3) and a short study clip with call-outs of what to watch for
- Player imagery: the MVP/prototype may use visually representative player cards; production must use properly licensed player imagery (or a licensed image/data provider) and must not be built around scraped images — images should be swappable via a field such as playerImageUrl

**User Interactions**
- Search/browse players
- Open a player profile and switch between Learn / Skills / Bio
- Watch a study clip with guided call-outs
- Jump from a player's Signature Move directly into a matching drill/workout

**Success Criteria**
- Player data (name, team, position, number) is correct and stays correct as rosters change, without manual re-entry
- A player can go from "I want to shoot like Steph Curry" to a specific drill in a few taps

### 7.5 Shot Tracker

**Priority:** MVP — core differentiator

**Business Objective:** Turn a recorded shooting session into a shot-by-shot chart and analysis, so a player can see exactly where they are strong and weak. The founders were explicit that this needs to be "significantly more than a shot chart."

**Shot Chart**

**Parameters**
- Every shot taken in a session, plotted by location
- Make vs. miss
- Session and date
- Overall shooting percentage
- Filters: All / Made / Missed

**Individual Shot Replay**

**Parameters**
- Exact shot location
- Make/miss
- Shot timestamp
- Replay of that specific shot
- Shot-specific technical feedback (e.g. "Miss — Right Wing. Your release appears slightly late and your shooting wrist isn't fully loaded before extension.")
- Ask Coach about that shot, or add a correction drill to a workout, directly from the shot

**Session Analysis**

**Parameters**
- Attempts, makes, misses, FG%
- Makes/misses broken down by zone
- Best zone and weakest zone
- Trend call-outs (e.g. "Left Mid: 72%, Right Wing: 33%") with a plain-language explanation of what that means

**Functional Requirements**
- Player records themselves shooting from within the app
- System processes the footage: detects individual shots, classifies make/miss, and maps shot location
- Results roll up into a Shot Chart and a Session Analysis (below)

**Success Criteria**
- Every shot on the chart is tappable and opens a real replay and analysis — not a placeholder
- Session analysis correctly identifies at least a best zone and a weakest zone from real shot data

### 7.6 AI Shooting Analysis

**Priority:** MVP basic; advanced mechanical analysis is Phase 2

**Business Objective:** Give specific, coach-quality feedback on shooting form by comparing the player's own footage against reference footage — one of the two technical parameters raised directly on the kickoff call, alongside dribbling.

**Parameters Captured / Displayed**
- Shooting hand/wrist position and wrist loading
- Elbow position/alignment
- Release timing
- Shooting pocket
- Lower-body alignment and balance
- Jump consistency
- Follow-through and arc
- Landing position
- Side-to-side (left vs. right) differences

**Functional Requirements**
- Compare the player's clip against reference (e.g. professional) footage for the same shot type
- Follow an observation → likely issue → correction → drill structure in every piece of feedback
- Feedback must be specific (e.g. "On your right-side attempts, your shooting wrist appears less loaded before release than on your left-side attempts. Focus on getting the ball into the shooting pocket earlier.") — never generic ("Keep practicing!")
- Must not present uncertain computer-vision conclusions as medical or scientific fact

**Success Criteria**
- A sample of feedback messages all follow the observation → issue → correction → drill pattern
- No feedback message reviewed is generic or non-actionable

### 7.7 Game Footage Analysis

**Priority:** MVP basic upload/analysis; advanced analysis is Phase 2

**Business Objective:** Let a player upload footage of an actual game — not just a shooting drill — and get feedback on decision-making and play, not just shot mechanics. This was raised directly in the kickoff call as a core capability.

**Parameters Captured / Displayed**
- Shot selection
- Decision-making
- Turnovers
- Defensive positioning
- Off-ball movement
- Spacing
- Drives
- Passing
- Shot creation

**Functional Requirements**
- Process an uploaded game video and identify relevant events
- Summarize strengths, weaknesses, and opportunities for improvement (e.g. "You created good separation going left, but you rarely attacked closeouts from the right side.")
- Turn each identified weakness into a recommended, buildable workout (e.g. a right-side closeout workout)

**Success Criteria**
- Uploading a game clip reliably returns strengths, weaknesses, and recommendations — not just a processing confirmation

### 7.8 Share With Coach

**Priority:** MVP

**Business Objective:** Let a player hand off any analysis (a shot session or game footage) into a Coach conversation with full context already attached. This was flagged on the call as previously broken in the prototype and something that must work correctly.

**Functional Requirements**
- Share With Coach opens the AI Coach with the specific session's data pre-loaded (e.g. "You just completed a shooting session with 77 attempts and 40 makes.")
- Coach must never start from zero when handed a session this way

**Success Criteria**
- Every Share With Coach action results in Coach referencing the specific session, not a generic greeting

### 7.9 AI Coach ("Coach")

**Priority:** MVP basic chat coaching; Phase 2 for live/real-time coaching

**Business Objective:** Be the single conversational layer that ties every other module together — "a coach that can really help with every aspect of the game," per the founders — without making every other module redundant.

**Parameters Captured / Displayed**
- Coach personality setting: Encouraging / Balanced / Direct / Elite Trainer (default: Balanced)

**Functional Requirements**
- Answer basketball questions; discuss and adjust workouts; explain skills
- Provide confidence/mental-game support (see 7.10)
- Review previous sessions and reference shot data and game analysis when relevant
- Recommend what to work on next; help players prepare for games and review performance
- Discuss player-study content
- Changing the personality setting must actually change Coach's responses, not just relabel them
- Phase 2: live dribbling/shooting feedback and more advanced real-time coaching
- Phase 2: let the player call Coach and talk instead of typing

**User Interactions**
- Message Coach
- (Phase 2) Call Coach

**Success Criteria**
- Switching personality settings produces a noticeably different tone/response in a side-by-side comparison
- Coach can correctly reference what just happened in a session after a Share With Coach hand-off

### 7.10 Confidence / Mental Game

**Priority:** MVP basic

**Business Objective:** Recognize that basketball development is not purely physical, and give players a lightweight way to manage nerves and confidence before and after games.

**Functional Requirements**
- Before the Game: ask "How are you feeling?" with options such as Confident / Nervous / Overthinking / Not ready, then provide a short, basketball-specific routine matched to the answer
- After a poor game: Coach analyzes the player's actual data, identifies positives and areas to improve, and creates a recovery plan; can recommend reviewing the last session
- Avoid generic motivational quotes — every response must be actionable

**Success Criteria**
- A "Nervous" pre-game check-in returns a specific routine, not a generic pep talk
- A post-poor-game flow references real data from that game or session

### 7.11 Progress

**Priority:** MVP

**Business Objective:** Give players one place to see that their training is actually working.

**Parameters Captured / Displayed**
- Workouts completed
- Training streak
- Skill development
- Shooting statistics
- Session history
- Goals and their status
- Improvements and remaining weaknesses

**Functional Requirements**
- Progress data must be driven by real completed workouts and shot sessions — not static or manually entered

**Success Criteria**
- Completing a workout or shot session visibly updates Progress within the same session, with no refresh or manual step

### 7.12 Goals

**Priority:** MVP for goal-setting; Phase 2 for advanced tracking

**Business Objective:** Let a player set a concrete target (e.g. improve 3PT%, make 500 shots, train 4x/week, improve weak hand, improve finishing, prepare for tryouts) and see it move automatically.

**Functional Requirements**
- Support the example goal types above at minimum
- Update goal progress automatically from workout, shot, and game data wherever possible, rather than requiring manual check-ins

**Success Criteria**
- At least one goal type updates automatically from real activity, without the player manually marking progress

### 7.13 Achievements / XP

**Priority:** Phase 2

**Business Objective:** Add a light gamification layer (XP, levels, streaks, badges, milestones, skill achievements) to reinforce consistent training.

**Functional Requirements**
- Design gamification so it never becomes more prominent than the app's actual development/coaching value — explicit founder guidance

### 7.14 Feed / Content System & Licensing

**Priority:** MVP for the content pipeline itself; footage rights are an ongoing dependency

**Business Objective:** Supply the short-form content that Feed and NBA Player Mode need, without building the business around footage HoopSync does not have the rights to.

**Functional Requirements**
- Content should be short-form and engaging — a TikTok/Instagram consumption model applied to basketball development
- Eligible content sources: HoopSync-created content, coaches/trainers, user-generated content, properly licensed basketball footage, college/high-school/overseas footage where rights exist, and original demonstrations
- For the MVP/demo specifically, use only: original footage, generated demonstrations, properly licensed footage, public-domain/appropriately licensed footage, or clearly labeled placeholders
- Do not build the product around illegally scraped NBA footage, and do not let NBA footage licensing block demonstrating the product for the Launchpad submission
- Production content must have cleared rights before use

**Success Criteria**
- Every piece of content shipped in the MVP has a traceable, legitimate source
- No league-owned footage is used before the pending license is in place

### 7.15 Notifications

**Priority:** Phase 2

**Business Objective:** Bring players back into the app with timely, relevant nudges.

**Functional Requirements**
- Workout reminders
- Streak reminders
- Goal updates
- Coach recommendations
- New content alerts
- Progress milestones

## 8. Key User Flows

### 8.1 Onboarding

1. Download/open app
2. Create account
3. Enter basketball profile
4. Select goals
5. Select areas to improve
6. Select training preferences
7. Set Coach personality
8. Receive personalized starting plan
9. Enter Home

### 8.2 Player Study → Workout

1. Open NBA Player Mode
2. Search for a player
3. Open the player profile
4. Select a skill
5. See strengths/weaknesses
6. View a signature move
7. Watch educational content
8. Select a drill
9. Start the workout
10. Complete the workout
11. Progress updates

### 8.3 Shot Tracking

1. Open Analyze
2. Select Shot Tracker
3. Record a session
4. Process footage
5. Detect shots
6. Display the chart
7. Filter makes/misses
8. Tap an individual shot
9. Play the exact replay
10. Display the analysis
11. Ask Coach or add a fix to a workout

### 8.4 Game Analysis

1. Upload game footage
2. Processing begins
3. AI identifies plays
4. Analysis is generated
5. Strengths are displayed
6. Weaknesses are displayed
7. Recommendations are displayed
8. Build a workout
9. Share with Coach

## 9. Non-Functional Requirements

### 9.1 Performance

- Fast navigation throughout the app
- Loading states during AI/video processing
- The app must never freeze while processing video
- Upload progress indicators
- Graceful failure handling

### 9.2 Scalability

As a business requirement, the platform must be able to grow from an initial group of users to a much larger one without a rebuild — including large video uploads, an AI processing queue, and a growing player/content database. The specific architecture to achieve this belongs to the companion Technical Architecture document.

### 9.3 Security

- Secure authentication
- Encrypted user data
- Secure video storage
- User-controlled deletion
- Access control

### 9.4 Privacy & Compliance

Privacy is especially important because the target audience includes minors (roughly ages 13–18). The platform must not expose private videos, personal information, or private training data without authorization.

**Open item:** confirm whether parental-consent requirements (e.g. COPPA-style obligations in the U.S.) apply given the age of target users, and design the sign-up/consent flow accordingly. Tracked in Section 12.

## 10. Business Model & Monetization

- Comparator: in-person basketball training commonly runs $40–$50 per hour.
- Proposed model: a monthly subscription (an early reference figure discussed on the call was roughly $30/month) positioned as materially better value than hourly personal training.
- Pricing must ultimately be set against the real cost of running the AI — compute cost per chat inquiry and per video processed. Final pricing is a Phase 2 exercise and is not fixed by this BRD.
- Payment cadence should eventually support weekly, monthly, and yearly billing.

## 11. Success Criteria

### 11.1 MVP / Launchpad Submission

- The MVP is submitted to the league between September 14 and October 16, as scheduled.
- A reviewer can go through the full connected loop — onboard, view a personalized Home feed, study an NBA player, complete a generated workout, record and review a shooting session with a working shot-by-shot replay, get an AI Coach response with real session context, and see Progress update — without hitting a dead or non-functional button.
- No feature in the MVP depends on unlicensed professional-league footage.

### 11.2 Product Quality Bar

- Every primary navigation button works; there are no dead buttons or fake interactions presented as functional.
- Shared application state persists across modules — e.g. a completed workout updates Progress, a shot session updates shooting statistics, Coach receives context from shared sessions, and saved content appears in Saved.
- Player information is sourced from one centralized player database, not hardcoded per screen.

### 11.3 Long-Term Business Success

- Players choose HoopSync's subscription over — or alongside — traditional personal training, validating the value proposition in Sections 2 and 10.
- The professional league grants a content-licensing agreement following MVP review.
- Retention signals (streaks, repeat workouts, Coach usage) show the connected loop is actually being used, not just individual features in isolation.

## 12. Assumptions, Dependencies & Risks

| Item | Description | Why It Matters |
|---|---|---|
| League licensing outcome | Not yet secured. | MVP must work fully without it; it determines whether Feed/NBA Player Mode can use real professional footage post-launch. |
| Database technology | The kickoff call referenced MongoDB; the companion engineering spec recommends PostgreSQL. | Needs to be resolved in the Technical Architecture phase before development starts. |
| AI/computer-vision technology | Not yet selected for shot and game analysis. | Directly affects the accuracy of Sections 7.6/7.7 and the processing cost in Section 10. |
| Player-data provider/API | Not yet selected. | NBA Player Mode (Section 7.4) depends on a reliable, centrally-updatable source. |
| Final subscription pricing | Only a comparison point ($30/mo vs. $40–$50/hr) exists today. | Needed before Payments (Phase 2) can be built. |
| Minors' data privacy/consent requirements | Not yet reviewed. | Target users are largely under 18; may require parental-consent flows (Section 9.4). |
| Branding/visual design system | The current prototype UI needs a redesign. | Priyansh Rath to lead; affects the presentation layer of every feature. |
| Non-NBA content licensing | Rights for college/HS/overseas footage not yet confirmed per source. | Needed for the content pipeline in Section 7.14 beyond originals/placeholders. |
