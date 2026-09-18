import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ActiveWorkout,
  type ActiveWorkoutDrillView,
  type ActiveWorkoutView,
} from "@/components/train/active-workout";
import { MEDIA_SOURCE_LABELS } from "@/lib/media-provenance";

const actions = vi.hoisted(() => ({
  startWorkoutAction: vi.fn(async () => {}),
  toggleDrillCompletionAction: vi.fn(async () => {}),
  toggleDrillSkippedAction: vi.fn(async () => {}),
  recordDrillElapsedAction: vi.fn(async () => {}),
  completeWorkoutAction: vi.fn(async () => {}),
  askCoachAboutWorkoutAction: vi.fn(async () => ({ conversationId: "c1" })),
}));

vi.mock("@/server/actions/workoutActions", () => actions);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function drill(
  overrides: Partial<ActiveWorkoutDrillView> = {},
): ActiveWorkoutDrillView {
  return {
    drillId: `d${overrides.order ?? 1}`,
    order: overrides.order ?? 1,
    name: "Form Shooting",
    coachingCues: ["Elbow under the ball"],
    completed: false,
    skipped: false,
    elapsedSeconds: 0,
    ...overrides,
  };
}

function workout(overrides: Partial<ActiveWorkoutView> = {}): ActiveWorkoutView {
  return {
    id: "507f1f77bcf86cd799439011",
    label: "Focused on shooting",
    status: "in_progress",
    difficulty: "beginner",
    estimatedDurationMinutes: 20,
    drills: [drill()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ActiveWorkout - BRD 7.3 required elements", () => {
  it("shows the drill's written instruction, not just its name", () => {
    render(
      <ActiveWorkout
        workout={workout({
          drills: [drill({ description: "One-hand form shooting from 3-5 feet." })],
        })}
      />,
    );

    expect(
      screen.getByText("One-hand form shooting from 3-5 feet."),
    ).toBeInTheDocument();
  });

  it("renders a demo video and labels it as a placeholder", () => {
    const { container } = render(
      <ActiveWorkout
        workout={workout({ drills: [drill({ videoUrl: "/demo.mp4" })] })}
      />,
    );

    expect(container.querySelector("video")).toHaveAttribute("src", "/demo.mp4");
    // Presenting a stock clip as real drill footage would be exactly the kind
    // of fake content the project forbids. The wording now comes from the
    // shared disclosure descriptor (src/lib/media-provenance.ts) rather than
    // being hardcoded in the component, so it can no longer say "placeholder"
    // about footage that isn't - but it must still say it about footage that is.
    expect(screen.getByText(/not real footage of this/i)).toBeInTheDocument();
    // The clip is labelled from the shared source vocabulary, so a reworded
    // label moves this assertion with it rather than silently passing.
    expect(container.querySelector("video")).toHaveAttribute(
      "aria-label",
      expect.stringContaining(MEDIA_SOURCE_LABELS.placeholder),
    );
  });

  it("says so honestly when a drill has no clip, rather than showing nothing", () => {
    render(<ActiveWorkout workout={workout()} />);
    expect(screen.getByText(/no demo clip for this drill yet/i)).toBeInTheDocument();
  });

  it("shows coaching cues, sets/reps and difficulty", () => {
    render(
      <ActiveWorkout
        workout={workout({
          drills: [drill({ sets: 3, reps: 15, difficulty: "intermediate" })],
        })}
      />,
    );

    expect(screen.getByText("Elbow under the ball")).toBeInTheDocument();
    expect(screen.getByText("3 sets x 15 reps")).toBeInTheDocument();
    expect(screen.getByText("intermediate")).toBeInTheDocument();
  });

  it("offers a real timer with start and reset controls", () => {
    render(<ActiveWorkout workout={workout()} />);
    expect(screen.getByRole("button", { name: /start timer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset timer/i })).toBeInTheDocument();
  });

  it("counts down against the target for a time-prescribed drill", () => {
    render(
      <ActiveWorkout
        workout={workout({ drills: [drill({ durationSeconds: 45 })] })}
      />,
    );
    expect(screen.getByText("0:45")).toBeInTheDocument();
    expect(screen.getByText(/of 0:45 target/i)).toBeInTheDocument();
  });

  it("offers previous, next, skip and complete", () => {
    render(
      <ActiveWorkout
        workout={workout({
          drills: [drill({ order: 1 }), drill({ order: 2, drillId: "d2" })],
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^skip$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete workout/i }),
    ).toBeInTheDocument();
  });
});

describe("ActiveWorkout - progress and navigation", () => {
  it("bases the progress readout on work done, not on position", async () => {
    render(
      <ActiveWorkout
        workout={workout({
          drills: [
            drill({ order: 1, completed: true }),
            drill({ order: 2, drillId: "d2" }),
            drill({ order: 3, drillId: "d3" }),
            drill({ order: 4, drillId: "d4" }),
          ],
        })}
      />,
    );

    // Standing on the last drill used to read 100% even with nothing done.
    expect(screen.getByText("1 of 4 done")).toBeInTheDocument();
  });

  it("resumes at the first drill that is neither done nor skipped", () => {
    render(
      <ActiveWorkout
        workout={workout({
          drills: [
            drill({ order: 1, completed: true }),
            drill({ order: 2, drillId: "d2", skipped: true }),
            drill({ order: 3, drillId: "d3", name: "Third Drill" }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Drill 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Third Drill")).toBeInTheDocument();
  });

  it("lets the player complete the workout from any drill, not only the last", async () => {
    const user = userEvent.setup();
    render(
      <ActiveWorkout
        workout={workout({
          drills: [drill({ order: 1 }), drill({ order: 2, drillId: "d2" })],
        })}
      />,
    );

    expect(screen.getByText("Drill 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /complete workout/i }));

    expect(actions.completeWorkoutAction).toHaveBeenCalledWith(
      "507f1f77bcf86cd799439011",
    );
  });

  it("records a skip and advances", async () => {
    const user = userEvent.setup();
    render(
      <ActiveWorkout
        workout={workout({
          drills: [drill({ order: 1 }), drill({ order: 2, drillId: "d2" })],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^skip$/i }));

    expect(actions.toggleDrillSkippedAction).toHaveBeenCalledWith(
      "507f1f77bcf86cd799439011",
      1,
      true,
    );
  });

  it("rolls the toggle back when saving fails", async () => {
    actions.toggleDrillCompletionAction.mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    render(<ActiveWorkout workout={workout()} />);

    await user.click(screen.getByRole("button", { name: /mark complete/i }));

    // A failed write must not leave the screen claiming saved work.
    expect(
      await screen.findByRole("button", { name: /mark complete/i }),
    ).toBeInTheDocument();
  });
});

describe("ActiveWorkout - completed workouts are records", () => {
  it("disables every edit control and explains why", () => {
    render(
      <ActiveWorkout
        workout={workout({
          status: "completed",
          actualDurationSeconds: 930,
          drills: [drill({ completed: true })],
        })}
      />,
    );

    expect(screen.getByText(/can't be edited/i)).toBeInTheDocument();
    expect(screen.getByText(/15:30/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /marked complete/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^skip$/i })).toBeDisabled();
  });
});

describe("ActiveWorkout - pending state", () => {
  it("previews the plan with its difficulty and coverage note before starting", async () => {
    const user = userEvent.setup();
    render(
      <ActiveWorkout
        workout={workout({
          status: "pending",
          difficulty: "intermediate",
          coverageNote: "We don't have defense drills for your equipment yet.",
          drills: [drill({ sets: 3, reps: 15 })],
        })}
      />,
    );

    expect(screen.getByText("intermediate")).toBeInTheDocument();
    expect(
      screen.getByText(/don't have defense drills for your equipment yet/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start workout/i }));
    expect(actions.startWorkoutAction).toHaveBeenCalled();
  });

  it("lists each drill with its prescription", () => {
    render(
      <ActiveWorkout
        workout={workout({
          status: "pending",
          drills: [drill({ name: "Figure-8", sets: 3, durationSeconds: 45 })],
        })}
      />,
    );

    const list = screen.getByRole("list");
    expect(within(list).getByText("Figure-8")).toBeInTheDocument();
    expect(within(list).getByText("3 sets - 45s each")).toBeInTheDocument();
  });
});
