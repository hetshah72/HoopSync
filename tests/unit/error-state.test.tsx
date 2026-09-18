import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TriangleAlert } from "lucide-react";

import { ErrorState } from "@/components/layout/error-state";
import { RouteError } from "@/components/layout/route-error";

// `Link` needs router context the jsdom setup doesn't provide; the href is the
// only thing these tests care about.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("ErrorState", () => {
  it("renders the title as a top-level heading by default", () => {
    render(
      <ErrorState
        icon={TriangleAlert}
        title="We couldn't find that"
        description="It isn't there any more."
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "We couldn't find that" }),
    ).toBeInTheDocument();
    expect(screen.getByText("It isn't there any more.")).toBeInTheDocument();
  });

  it("drops to an h2 when it sits inside a page that already has an h1", () => {
    render(
      <ErrorState
        icon={TriangleAlert}
        title="Nested"
        description="x"
        headingLevel={2}
      />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Nested",
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows the reference only when there is a digest to show", () => {
    const { rerender } = render(
      <ErrorState icon={TriangleAlert} title="t" description="d" />,
    );
    expect(screen.queryByText(/^Reference:/)).toBeNull();

    rerender(
      <ErrorState
        icon={TriangleAlert}
        title="t"
        description="d"
        digest="abc123"
      />,
    );
    expect(screen.getByText(/Reference:/)).toHaveTextContent("abc123");
  });

  it("keeps the icon out of the accessibility tree", () => {
    const { container } = render(
      <ErrorState icon={TriangleAlert} title="t" description="d" />,
    );
    // The headline carries the meaning, so the tile is decorative.
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("RouteError", () => {
  const error = Object.assign(new Error("boom"), { digest: "deadbeef" });

  it("calls retry, not reset, when the player asks to try again", async () => {
    const retry = vi.fn();
    render(<RouteError error={error} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("always offers a navigational way out as well as the retry", () => {
    // If the cause is permanent, "Try again" re-renders the same error - the
    // player must not be stuck on the screen.
    render(
      <RouteError
        error={error}
        retry={vi.fn()}
        back={{ href: "/train", label: "Go to Train" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Go to Train" })).toHaveAttribute(
      "href",
      "/train",
    );
  });

  it("surfaces the digest so a report can be matched to the server log", () => {
    render(<RouteError error={error} retry={vi.fn()} />);
    expect(screen.getByText(/Reference:/)).toHaveTextContent("deadbeef");
  });
});
