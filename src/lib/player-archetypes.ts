/**
 * Player archetypes - how NBA Player Mode covers the whole league.
 *
 * BRD 7.4 requires that *every* player profile carry at least one Signature
 * Move write-up with a matching drill, across the full current roster. Hand
 * authoring ~570 players isn't a thing this product can do, and inventing
 * per-player claims about real, named athletes would be worse than useless
 * for a youth coaching app - so coverage comes from a small set of authored
 * archetype packs that a player is deterministically classified into by
 * position group and size.
 *
 * What this is: a *coaching profile* for a type of player - what that role
 * does well, the moves that define it, and how to practise them. What it is
 * emphatically not: a scouting report on the individual, or NBA statistics.
 * `skills` below is emphasis-by-role, not a rating of any person. The UI
 * must label archetype-sourced content as such (see
 * playerEditorialService's `provenance`), exactly like the simulated
 * mechanical-analysis disclosure in Analyze.
 *
 * Hand-authored `editorial` on a player document always wins over the
 * archetype pack - see resolvePlayerEditorial(). Adding authored content for
 * a marquee player is therefore purely additive; nothing here needs editing.
 *
 * Isomorphic by contract (src/lib/**): no mongo, no server imports. Moves
 * reference drills by `drillSlug`, and the service layer resolves those to
 * real drill ids.
 */
import type { NbaPlayerSkillRatings } from "@/types/db";

export const PLAYER_ARCHETYPE_KEYS = [
  "lead_guard",
  "combo_guard",
  "wing_scorer",
  "point_forward",
  "stretch_big",
  "interior_big",
  "all_around",
] as const;

export type PlayerArchetypeKey = (typeof PLAYER_ARCHETYPE_KEYS)[number];

/** A signature move as BRD 7.4 specifies it, minus the resolved drill id. */
export interface ArchetypeSignatureMove {
  id: string;
  name: string;
  whatItIs: string;
  whenUsed: string;
  whatMakesItEffective: string;
  keyMechanics: string[];
  commonMistakes: string[];
  /** Resolved to a real DrillDoc._id by playerEditorialService. */
  drillSlug: string;
}

export interface ArchetypeStudyCallout {
  atSeconds: number;
  label: string;
  text: string;
}

export interface PlayerArchetype {
  key: PlayerArchetypeKey;
  label: string;
  /** One line describing the role, shown next to the provenance badge. */
  summary: string;
  learn: {
    whatTheyDoWell: string;
    howTheyPlay: string;
    whatToWatchFor: string;
  };
  skills: NbaPlayerSkillRatings;
  strengths: string[];
  weaknesses: string[];
  signatureMoves: ArchetypeSignatureMove[];
  studyClipCallouts: ArchetypeStudyCallout[];
}

export const PLAYER_ARCHETYPES: Record<PlayerArchetypeKey, PlayerArchetype> = {
  lead_guard: {
    key: "lead_guard",
    label: "Lead Guard",
    summary:
      "The primary ball-handler - runs the offense out of ball-screens and controls tempo.",
    learn: {
      whatTheyDoWell:
        "Manipulates ball-screen coverages with pace rather than raw speed, and consistently gets the defense into rotation before making a decision.",
      howTheyPlay:
        "Plays off two feet out of the pick-and-roll, changing speeds to force the big to commit, then reads the help side rather than pre-deciding the pass.",
      whatToWatchFor:
        "Watch the shoulders and the first two steps after the screen, not the pass. The advantage is created before the ball ever moves.",
    },
    skills: {
      shooting: 78,
      finishing: 70,
      ballHandling: 92,
      playmaking: 90,
      defense: 62,
      athleticism: 74,
    },
    strengths: [
      "Ball-screen decision-making against multiple coverages",
      "Change-of-pace handle that creates separation without needing a step advantage",
      "Live-dribble passing to both the roller and the weak side",
    ],
    weaknesses: [
      "Smaller frame is a target for switch hunting on defense",
      "High usage means turnovers rise sharply against ball pressure",
    ],
    signatureMoves: [
      {
        id: "lead-guard-snake-dribble",
        name: "Snake Dribble Out Of The Screen",
        whatItIs:
          "Rejecting the downhill path after using a ball-screen and dribbling back across the big's body, pinning them on your hip.",
        whenUsed:
          "Against drop coverage, when the big sits back and the guard fights over the top - the gap between the two defenders is the whole point.",
        whatMakesItEffective:
          "It turns a two-on-two into a temporary two-on-one: the screener's defender has to choose between the ball and the roller while the original defender is still trailing.",
        keyMechanics: [
          "Get shoulder-to-shoulder with the screen before changing direction",
          "Snake back across on a low, wide crossover - not a loop",
          "Keep your eyes level with the big's chest to read the drop",
        ],
        commonMistakes: [
          "Turning the corner too early, which lets the big meet you at the rim",
          "Picking up the dribble before the roller has actually sealed",
        ],
        drillSlug: "snake-the-screen",
      },
      {
        id: "lead-guard-pocket-pass",
        name: "Pocket Pass Off Two Feet",
        whatItIs:
          "A short, low, one-handed pass delivered into the roller's hands from a gathered two-foot stop inside the ball-screen.",
        whenUsed:
          "When the big steps up to the level of the screen and the roll man has a step on their recovery.",
        whatMakesItEffective:
          "Throwing off two feet keeps both the pass and the shot live, so the defense can't commit to either until the ball is already gone.",
        keyMechanics: [
          "Gather to a two-foot stop so the shot stays a threat",
          "Pass from the hip, under the reaching hand, not over the top",
          "Lead the roller to the rim-side hand",
        ],
        commonMistakes: [
          "Telegraphing with a two-hand chest pass wind-up",
          "Throwing it behind the roller so they have to catch flat-footed",
        ],
        drillSlug: "short-roll-decision",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 2,
        label: "Set up the screen",
        text: "Watch the pace before the screen arrives - slow feet here, not fast ones. The change of speed is what moves the big.",
      },
      {
        atSeconds: 6,
        label: "Read the big",
        text: "Eyes go to the screener's defender. Drop coverage means snake; a hard hedge means reject or pocket-pass.",
      },
      {
        atSeconds: 11,
        label: "Two-foot gather",
        text: "Gathering off two feet keeps the pass and the pull-up live at the same moment. That's the whole advantage.",
      },
    ],
  },

  combo_guard: {
    key: "combo_guard",
    label: "Scoring Guard",
    summary:
      "A guard who scores off movement and off the catch as much as off the dribble.",
    learn: {
      whatTheyDoWell:
        "Gets a clean shot off faster than the closeout can arrive, because the feet are already set before the ball gets there.",
      howTheyPlay:
        "Never stands still - curls off screens, relocates along the arc, and sprints into space so the catch arrives on balance and square.",
      whatToWatchFor:
        "Watch the two steps before the catch, not the release. That footwork is where the shot is actually created.",
    },
    skills: {
      shooting: 90,
      finishing: 72,
      ballHandling: 82,
      playmaking: 70,
      defense: 64,
      athleticism: 76,
    },
    strengths: [
      "Off-ball footwork that turns a contested catch into an open one",
      "Quick, repeatable release that holds up against a hard closeout",
      "Relocation instincts that punish a defense in rotation",
    ],
    weaknesses: [
      "Scoring volume can dip sharply when the off-ball movement is taken away",
      "Size can be attacked in the post after a switch",
    ],
    signatureMoves: [
      {
        id: "combo-guard-relocation-three",
        name: "Relocation Catch-And-Shoot",
        whatItIs:
          "Drifting or sprinting to a new spot along the arc while a teammate draws help, arriving with feet set for a rhythm three.",
        whenUsed:
          "Any time the ball is driven and your defender's head turns to the paint - the moment their eyes leave you is the cue.",
        whatMakesItEffective:
          "The defender has to recover to a spot you already left, so the closeout is always late and out of control.",
        keyMechanics: [
          "Move the instant the defender's head turns, not when the pass is thrown",
          "Hop into the catch so both feet land together, already square",
          "Hands up and ready before the ball leaves the passer",
        ],
        commonMistakes: [
          "Drifting too far and turning an open three into a heave",
          "Catching flat-footed and needing a dip to gather",
        ],
        drillSlug: "relocation-catch-and-shoot",
      },
      {
        id: "combo-guard-one-dribble-pullup",
        name: "One-Dribble Pull-Up",
        whatItIs:
          "A single hard dribble off the catch that resets into a balanced rhythm jump shot without breaking stride.",
        whenUsed:
          "When a defender closes out under control - not tight enough to drive past, but close enough to contest a standing shot.",
        whatMakesItEffective:
          "One dribble changes the distance just enough to create a release window, without giving up the shot to attempt a full drive.",
        keyMechanics: [
          "Attack the dribble low and on a straight line, not a loop",
          "Two-foot jump stop before rising into the shot",
          "Identical release point to a standing catch-and-shoot",
        ],
        commonMistakes: [
          "Taking the dribble too far, turning a quick reset into a full drive",
          "Rising off one foot instead of a balanced two-foot base",
        ],
        drillSlug: "one-dribble-pull-up",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 3,
        label: "Feet before the ball",
        text: "The feet are already set before the pass arrives. That's why the release looks so fast - the work happened earlier.",
      },
      {
        atSeconds: 8,
        label: "Relocate on the drive",
        text: "As soon as the defender's head turns to the ball, the spot changes. The closeout is beaten before it starts.",
      },
      {
        atSeconds: 13,
        label: "Same release every time",
        text: "Off the catch or off one dribble, the release point doesn't move. Repeatability is the skill.",
      },
    ],
  },

  wing_scorer: {
    key: "wing_scorer",
    label: "Three-Level Wing",
    summary:
      "Scores at the rim, from mid-range, and from three - and guards the other team's best perimeter player.",
    learn: {
      whatTheyDoWell:
        "Creates a good shot from anywhere on the floor off one or two dribbles, and defends multiple positions on the other end.",
      howTheyPlay:
        "Reads closeouts patiently instead of forcing a drive, using hesitations and step-backs to find just enough separation.",
      whatToWatchFor:
        "Watch the eyes and shoulders before the second dribble - the drive is sold before the ball ever snaps back.",
    },
    skills: {
      shooting: 84,
      finishing: 80,
      ballHandling: 78,
      playmaking: 68,
      defense: 84,
      athleticism: 84,
    },
    strengths: [
      "Shot creation off one or two dribbles from all three levels",
      "Length and footwork that translate into multi-position defense",
      "Comfortable taking and making difficult shots late in the clock",
    ],
    weaknesses: [
      "Efficiency swings with shot difficulty when the offense stalls",
      "Ball security can slip against sustained full-court pressure",
    ],
    signatureMoves: [
      {
        id: "wing-hesitation-pullup",
        name: "Hesitation Into Pull-Up",
        whatItIs:
          "A change-of-pace hesitation that freezes the defender's momentum, followed by a snap back into a balanced pull-up jumper.",
        whenUsed:
          "Against a defender who is off-balance or over-committing to stop the drive, especially on the wing or at the top of the key.",
        whatMakesItEffective:
          "The hesitation sells the drive so convincingly that the defender's weight shifts backward, creating a clean look before they can recover.",
        keyMechanics: [
          "Sell the first dribble like a real drive - eyes and shoulders toward the rim",
          "Snap back to a squared, two-foot jump stop",
          "Keep the release point identical to a standard catch-and-shoot",
        ],
        commonMistakes: [
          "Rising too early, before the defender has actually committed",
          "Drifting sideways on the snap-back instead of staying square",
        ],
        drillSlug: "hesitation-pull-up-signature",
      },
      {
        id: "wing-step-back",
        name: "Step-Back Into Separation",
        whatItIs:
          "Driving a defender onto their back foot, then pushing off it to create backward separation into a jump shot.",
        whenUsed:
          "When a defender has successfully cut off the drive and is riding your hip - the step-back attacks their recovery, not their position.",
        whatMakesItEffective:
          "It converts the defender's own forward momentum into space, and it works even when the drive is stopped.",
        keyMechanics: [
          "Push off the inside foot hard enough to actually move backward",
          "Land on a balanced two-foot base, shoulders square",
          "Keep the ball high on the gather so it can't be dug out",
        ],
        commonMistakes: [
          "Fading sideways instead of straight back, which kills accuracy",
          "Stepping back so far the shot leaves comfortable range",
        ],
        drillSlug: "step-back-separation",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 2,
        label: "Sell the drive",
        text: "Eyes and shoulders go to the rim first. The defender has to believe the drive for the hesitation to work.",
      },
      {
        atSeconds: 7,
        label: "Snap back square",
        text: "The snap-back lands on two feet, square to the rim - not drifting sideways. Balance is what keeps the percentage up.",
      },
      {
        atSeconds: 12,
        label: "Same pocket",
        text: "The ball comes to the same shot pocket as a catch-and-shoot. Nothing about the release changes.",
      },
    ],
  },

  point_forward: {
    key: "point_forward",
    label: "Point Forward",
    summary:
      "A big wing who initiates offense - attacks downhill and passes over the top of the defense.",
    learn: {
      whatTheyDoWell:
        "Uses size to see over the defense and attack mismatches downhill, scoring or creating from the same action.",
      howTheyPlay:
        "Hunts smaller defenders in transition and on switches, then plays from the elbow and the short roll where the size advantage is largest.",
      whatToWatchFor:
        "Watch the head and eyes on the drive - the pass is read over the defense, which is why help arrives too late.",
    },
    skills: {
      shooting: 74,
      finishing: 86,
      ballHandling: 78,
      playmaking: 84,
      defense: 78,
      athleticism: 86,
    },
    strengths: [
      "Downhill driving force that collapses a defense and creates for others",
      "Passing vision from above the defense rather than through it",
      "Mismatch hunting in transition and after switches",
    ],
    weaknesses: [
      "Perimeter shooting is the swing skill - defenses sag when it isn't falling",
      "High usage on the ball can slow the offense against a set defense",
    ],
    signatureMoves: [
      {
        id: "point-forward-downhill-attack",
        name: "Pace-Change Downhill Attack",
        whatItIs:
          "A deliberate slow-to-fast attack that walks a defender backward before exploding into the gap on a straight line.",
        whenUsed:
          "After a switch or in semi-transition, against a smaller or slower-footed defender with space to build up speed.",
        whatMakesItEffective:
          "The slow build removes the defender's ability to take a charge or slide, and the straight-line burst gets the shoulder past their hip.",
        keyMechanics: [
          "Walk the defender back at half speed before accelerating",
          "Attack the front foot, not the middle of the body",
          "Get shoulder past hip before gathering",
        ],
        commonMistakes: [
          "Accelerating too early and driving into set help",
          "Drifting sideways instead of attacking on a straight line",
        ],
        drillSlug: "pace-change-downhill-attack",
      },
      {
        id: "point-forward-euro-step",
        name: "Euro-Step Through Help",
        whatItIs:
          "A two-step lateral change of direction after the gather, stepping around the help defender rather than through them.",
        whenUsed:
          "When a help defender steps into the drive and a straight-line finish would be a charge or a block.",
        whatMakesItEffective:
          "It moves the finish to a different angle after the defender has already committed their feet, so the contest never arrives.",
        keyMechanics: [
          "Gather early enough that both steps are legal and unhurried",
          "First step at the defender, second step away from them",
          "Finish with the outside hand, away from the shot-blocker",
        ],
        commonMistakes: [
          "Starting the euro-step before reading which way help commits",
          "Taking a long first step that kills the second one's balance",
        ],
        drillSlug: "euro-step-finishing",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 3,
        label: "Walk them back",
        text: "Slow first. The defender has to be moving backward before the burst - that's what takes away the slide.",
      },
      {
        atSeconds: 8,
        label: "Attack the front foot",
        text: "The drive goes at the defender's front foot, not their chest. That angle is what gets shoulder past hip.",
      },
      {
        atSeconds: 12,
        label: "Read the help late",
        text: "The eyes stay up through the gather, so the finish can change angle after the help has already committed.",
      },
    ],
  },

  stretch_big: {
    key: "stretch_big",
    label: "Stretch Big",
    summary:
      "A big who spaces the floor - pops to the arc and punishes a defense that sags into the paint.",
    learn: {
      whatTheyDoWell:
        "Forces a rim-protector to leave the paint by shooting well enough from the perimeter that ignoring them isn't an option.",
      howTheyPlay:
        "Sets a real screen, then pops rather than rolls, reading whether the big steps up before deciding to shoot or attack the closeout.",
      whatToWatchFor:
        "Watch the screen itself. A hard, legal screen is what forces the switch or the drop that creates the pop.",
    },
    skills: {
      shooting: 80,
      finishing: 76,
      ballHandling: 58,
      playmaking: 62,
      defense: 72,
      athleticism: 68,
    },
    strengths: [
      "Floor spacing that pulls a rim protector out of the paint",
      "Screening angles that create the advantage in the first place",
      "Attacking a hard closeout with one dribble into a short pull-up",
    ],
    weaknesses: [
      "Can be targeted defending in space after a switch onto a guard",
      "Offensive value drops sharply on nights the perimeter shot isn't falling",
    ],
    signatureMoves: [
      {
        id: "stretch-big-pick-and-pop",
        name: "Pick-And-Pop Trail Three",
        whatItIs:
          "Setting a genuine ball-screen, then stepping back behind the arc into a catch-and-shoot rather than rolling to the rim.",
        whenUsed:
          "Against drop coverage, or any time your defender sinks into the paint to protect the rim after the screen.",
        whatMakesItEffective:
          "The defense has to choose between the ball-handler's downhill path and an open shooter; there's no coverage that takes both away.",
        keyMechanics: [
          "Set the screen with real contact - a fake screen gets no reaction",
          "Open up to the ball as you step back, not away from it",
          "Feet set and hands ready before the pass is thrown",
        ],
        commonMistakes: [
          "Slipping the screen early, so the defense never has to commit",
          "Popping too flat, which shortens the passing angle",
        ],
        drillSlug: "pick-and-pop-trail-three",
      },
      {
        id: "stretch-big-short-roll",
        name: "Short-Roll Decision",
        whatItIs:
          "Catching in the space between the arc and the rim after the screen, then reading the low help before shooting, driving, or passing.",
        whenUsed:
          "When the defense traps or hedges hard on the ball-handler, leaving you in a four-on-three behind the play.",
        whatMakesItEffective:
          "Catching in the middle of the floor with an advantage forces the last defender to commit, and every option stays open.",
        keyMechanics: [
          "Catch on two feet facing the rim, not turned sideways",
          "Eyes to the low man immediately on the catch",
          "One dribble maximum before deciding",
        ],
        commonMistakes: [
          "Catching and holding, which lets the defense recover",
          "Pre-deciding the pass before reading who actually helps",
        ],
        drillSlug: "short-roll-decision",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 2,
        label: "Real screen first",
        text: "Watch the contact on the screen. Without it the defense never reacts, and there's no pop to be had.",
      },
      {
        atSeconds: 7,
        label: "Open to the ball",
        text: "The step-back opens toward the passer, so the catch is already square and the feet are already set.",
      },
      {
        atSeconds: 12,
        label: "Attack the closeout",
        text: "If the closeout is hard, one dribble into a short pull-up. The pop and the drive are the same read.",
      },
    ],
  },

  interior_big: {
    key: "interior_big",
    label: "Interior Big",
    summary:
      "Rim-running, rim-protecting big - finishes above the rim and anchors the defense.",
    learn: {
      whatTheyDoWell:
        "Creates pressure at the rim on both ends: a vertical lob threat on offense, and a deterrent that changes shots on defense.",
      howTheyPlay:
        "Sprints the floor rather than jogging, seals early on the roll, and protects the rim with verticality rather than reaching.",
      whatToWatchFor:
        "Watch the hands and the timing of the jump, not the block. Great rim protection is mostly position taken before the shot goes up.",
    },
    skills: {
      shooting: 48,
      finishing: 90,
      ballHandling: 50,
      playmaking: 56,
      defense: 88,
      athleticism: 86,
    },
    strengths: [
      "Vertical finishing that turns an advantage into a high-percentage shot",
      "Rim protection through position and verticality, not gambling",
      "Screening and sealing that create space for everyone else",
    ],
    weaknesses: [
      "Limited perimeter shooting lets a defense pack the paint",
      "Can be pulled out of position defending ball-screens in space",
    ],
    signatureMoves: [
      {
        id: "interior-big-rim-run",
        name: "Rim Run And Seal",
        whatItIs:
          "Sprinting the floor ahead of the defense in transition, then sealing the trailing big under the rim for a lay-in or lob.",
        whenUsed:
          "Every live-ball rebound and made basket - the advantage is created by effort before the defense is set.",
        whatMakesItEffective:
          "A big who beats their matchup down the floor forces the defense to either give up a rim shot or send early help and open the perimeter.",
        keyMechanics: [
          "Sprint the middle of the floor, not the sideline",
          "Seal with a wide base and a target hand high",
          "Finish off two feet through contact",
        ],
        commonMistakes: [
          "Jogging back into the play and arriving after the defense",
          "Sealing too late, after the defender has already fronted",
        ],
        drillSlug: "rim-run-seal-finish",
      },
      {
        id: "interior-big-verticality",
        name: "Vertical Contest At The Rim",
        whatItIs:
          "Meeting a driver at the rim with hands straight up and a vertical jump, contesting without reaching across their body.",
        whenUsed:
          "Any time a driver gets into the paint with a step on their defender and the shot is going up at the rim.",
        whatMakesItEffective:
          "A straight-up contest changes the shot without fouling, so the defense gets the stop *and* the possession.",
        keyMechanics: [
          "Beat the driver to the spot before jumping - position first",
          "Hands straight up, elbows in, no swipe",
          "Jump vertically, not into the shooter",
        ],
        commonMistakes: [
          "Reaching across the body, which turns a stop into free throws",
          "Leaving the feet early on a shot fake",
        ],
        drillSlug: "drop-coverage-verticality",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 3,
        label: "Beat them down the floor",
        text: "The advantage is pure effort - sprinting the middle of the floor before the defense can match up.",
      },
      {
        atSeconds: 8,
        label: "Seal early",
        text: "The seal happens before the pass, with a wide base and a high target hand. Late seals get fronted.",
      },
      {
        atSeconds: 12,
        label: "Straight up",
        text: "On defense: position first, then hands straight up. No swipe means a changed shot instead of two free throws.",
      },
    ],
  },

  all_around: {
    key: "all_around",
    label: "All-Around Player",
    summary:
      "A balanced coaching profile for a player whose listed position or size isn't known yet.",
    learn: {
      whatTheyDoWell:
        "Contributes across the board rather than through one dominant skill - the profile most young players should actually build first.",
      howTheyPlay:
        "Plays within the offense, makes the simple read, and takes the shot the defense gives rather than hunting a specific one.",
      whatToWatchFor:
        "Watch the decisions made without the ball: spacing, cutting, and closing out. Those habits travel to every level.",
    },
    skills: {
      shooting: 72,
      finishing: 72,
      ballHandling: 72,
      playmaking: 72,
      defense: 72,
      athleticism: 72,
    },
    strengths: [
      "Balanced skill set with no single glaring weakness to attack",
      "Sound decision-making inside a team offense",
      "Habits that transfer as the physical profile develops",
    ],
    weaknesses: [
      "No elite, defining skill that forces a defense to adjust",
      "Can disappear in a possession that needs shot creation",
    ],
    signatureMoves: [
      {
        id: "all-around-one-dribble-pullup",
        name: "One-Dribble Pull-Up",
        whatItIs:
          "A single hard dribble off the catch into a balanced rhythm jump shot - the most transferable shot-creation move in basketball.",
        whenUsed:
          "Whenever a closeout takes away the standing shot but isn't aggressive enough to drive past.",
        whatMakesItEffective:
          "It works at every level and every position, and it needs no physical advantage - only balance and repetition.",
        keyMechanics: [
          "Attack the dribble low and on a straight line",
          "Two-foot jump stop before you rise",
          "Same release point as your catch-and-shoot",
        ],
        commonMistakes: [
          "Taking the dribble too far and drifting into help",
          "Rising off one foot instead of a balanced base",
        ],
        drillSlug: "one-dribble-pull-up",
      },
      {
        id: "all-around-closeout-attack",
        name: "Attack The Closeout",
        whatItIs:
          "Reading the defender's momentum on a closeout and choosing between the shot, a straight-line drive, or one dribble into a pull-up.",
        whenUsed:
          "Every catch on the perimeter with a defender recovering - the single most common decision in the game.",
        whatMakesItEffective:
          "Making the right read beats making a hard play: a defender flying at you has already given up either the shot or the drive.",
        keyMechanics: [
          "Catch ready - feet set, hands up, before deciding",
          "Drive at the defender's high shoulder if they close out short",
          "Shoot immediately if they close out long and under control",
        ],
        commonMistakes: [
          "Deciding before the catch instead of reading the closeout",
          "Driving into the defender's chest rather than past their shoulder",
        ],
        drillSlug: "closeout-and-contest",
      },
    ],
    studyClipCallouts: [
      {
        atSeconds: 3,
        label: "Catch ready",
        text: "Feet set and hands up before the ball arrives. Every option stays open from here.",
      },
      {
        atSeconds: 8,
        label: "Read the closeout",
        text: "Long and under control means shoot. Short and out of control means drive past the high shoulder.",
      },
      {
        atSeconds: 12,
        label: "One dribble, balanced",
        text: "If neither is there, one dribble into a two-foot gather. Balance beats difficulty.",
      },
    ],
  },
};

/**
 * balldontlie reports positions inconsistently - abbreviations ("G", "F-C")
 * from the live roster sync, full names ("Point Guard") from our own
 * editorial seed. Both have to classify identically, so normalize to a
 * position group first.
 */
export type PositionGroup = "guard" | "wing" | "big" | "unknown";

export function normalizePositionGroup(position?: string | null): PositionGroup {
  const raw = (position ?? "").trim().toLowerCase();
  if (!raw) return "unknown";

  // Full-name forms first - "point guard" contains "g" as a word but the
  // abbreviation matcher below would misread multi-word strings.
  if (raw.includes("guard") && raw.includes("forward")) return "wing";
  if (raw.includes("guard")) return "guard";
  if (raw.includes("center")) return "big";
  if (raw.includes("forward")) {
    return raw.includes("power") ? "big" : "wing";
  }

  // Abbreviation forms: "G", "F", "C", "G-F", "F-G", "F-C", "C-F", "PG", "SG".
  const letters = new Set(raw.replace(/[^gfc]/g, "").split(""));
  const hasGuard = letters.has("g");
  const hasForward = letters.has("f");
  const hasCenter = letters.has("c");

  if (hasCenter) return "big";
  if (hasGuard && hasForward) return "wing";
  if (hasGuard) return "guard";
  if (hasForward) return "wing";
  return "unknown";
}

/** Height cut-offs, in inches, between archetypes inside a position group. */
const COMBO_GUARD_MIN_HEIGHT = 76; // 6'4" and up
const POINT_FORWARD_MIN_HEIGHT = 80; // 6'8" and up
const INTERIOR_BIG_MIN_HEIGHT = 83; // 6'11" and up

/**
 * Deterministic - the same player always lands in the same archetype, and
 * the result is recomputed on every roster sync so a height/position
 * correction upstream flows straight through.
 */
export function classifyArchetype(input: {
  position?: string | null;
  heightInches?: number | null;
}): PlayerArchetypeKey {
  const group = normalizePositionGroup(input.position);
  const height = input.heightInches ?? undefined;

  switch (group) {
    case "guard":
      return height !== undefined && height >= COMBO_GUARD_MIN_HEIGHT
        ? "combo_guard"
        : "lead_guard";
    case "wing":
      return height !== undefined && height >= POINT_FORWARD_MIN_HEIGHT
        ? "point_forward"
        : "wing_scorer";
    case "big":
      return height !== undefined && height >= INTERIOR_BIG_MIN_HEIGHT
        ? "interior_big"
        : "stretch_big";
    case "unknown":
    default:
      return "all_around";
  }
}

export function archetypeFor(key?: PlayerArchetypeKey | null): PlayerArchetype {
  return PLAYER_ARCHETYPES[key ?? "all_around"] ?? PLAYER_ARCHETYPES.all_around;
}

/** Every drill slug the archetype packs depend on - asserted by the seed tests. */
export function archetypeDrillSlugs(): string[] {
  const slugs = new Set<string>();
  for (const archetype of Object.values(PLAYER_ARCHETYPES)) {
    for (const move of archetype.signatureMoves) {
      slugs.add(move.drillSlug);
    }
  }
  return [...slugs].sort();
}
