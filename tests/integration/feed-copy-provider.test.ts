import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rewriter's guardrail is the structural answer to the audit's
 * highest-severity finding - a feed card stating a fabricated weakness with
 * no label (P0_FINAL_QA §2.3, Bug Feed-1). These tests pin the rule that
 * makes a repeat impossible: a rewrite may reword, but any number it
 * introduces that nobody measured causes the whole rewrite to be dropped in
 * favour of the deterministic copy.
 */

// The provider pulls in the Coach prompt module for its tone fragments,
// which transitively imports the db client - and that throws at module load
// without a URI. Nothing here ever connects.
process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017";

const isOpenAiConfigured = vi.fn();
const createChatCompletion = vi.fn();

vi.mock("@/server/external/openaiClient", () => ({
  isOpenAiConfigured: () => isOpenAiConfigured(),
  createChatCompletion: (...args: unknown[]) => createChatCompletion(...args),
}));

const request = {
  key: "weakness_callout",
  purpose: "Name the zone costing this player the most.",
  facts: ["Left Wing 3: 2/9 (22.2%) across your last 3 session(s)"],
  fallback: {
    title: "Left Wing 3 is costing you the most right now",
    body: "Across your last 3 sessions you're 2 of 9 from Left Wing 3 (22.2%).",
  },
};

const context = { personality: "balanced" as const, profileSummary: "plays Guard" };

function respondWith(cards: unknown) {
  createChatCompletion.mockResolvedValueOnce(JSON.stringify({ cards }));
}

beforeEach(() => {
  vi.clearAllMocks();
  isOpenAiConfigured.mockReturnValue(true);
});

describe("feed copy provider: template mode", () => {
  it("returns the template copy untouched and never calls OpenAI when unconfigured", async () => {
    isOpenAiConfigured.mockReturnValue(false);
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );

    const { provider, copySource } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(copySource).toBe("template");
    expect(result.get("weakness_callout")).toEqual(request.fallback);
    expect(createChatCompletion).not.toHaveBeenCalled();
  });
});

describe("feed copy provider: AI mode", () => {
  it("accepts a rewrite that only restates the measured numbers", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    respondWith([
      {
        key: "weakness_callout",
        title: "Your Left Wing 3 needs the reps",
        body: "You're 2 of 9 from Left Wing 3 over your last 3 sessions - that's 22.2%.",
      },
    ]);

    const { provider, copySource } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(copySource).toBe("ai");
    expect(result.get("weakness_callout")?.title).toBe(
      "Your Left Wing 3 needs the reps",
    );
  });

  it("rejects a rewrite that invents a number nobody measured", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    respondWith([
      {
        key: "weakness_callout",
        title: "Left Wing 3 is dragging you down",
        // 41% was never computed from anything.
        body: "You're shooting 41% from Left Wing 3, well below your average.",
      },
    ]);

    const { provider } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(result.get("weakness_callout")).toEqual(request.fallback);
  });

  it("falls back to template copy when OpenAI fails", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    createChatCompletion.mockRejectedValueOnce(new Error("network"));

    const { provider } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(result.get("weakness_callout")).toEqual(request.fallback);
  });

  it("falls back when the reply isn't valid JSON", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    createChatCompletion.mockResolvedValueOnce("Sure! Here are your cards:");

    const { provider } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(result.get("weakness_callout")).toEqual(request.fallback);
  });

  it("ignores cards for keys it was never asked about", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    respondWith([
      { key: "made_up_kind", title: "Anything", body: "Anything at all." },
    ]);

    const { provider } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(result.size).toBe(1);
    expect(result.get("weakness_callout")).toEqual(request.fallback);
  });

  it("rejects an over-long rewrite rather than letting a card overflow", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    respondWith([
      {
        key: "weakness_callout",
        title: "A".repeat(200),
        body: "You're 2 of 9 from Left Wing 3.",
      },
    ]);

    const { provider } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(result.get("weakness_callout")).toEqual(request.fallback);
  });

  it("always returns an entry for every request, even an empty reply", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    respondWith([]);

    const { provider } = getFeedCopyProvider();
    const result = await provider.write([request], context);

    expect(result.get("weakness_callout")).toEqual(request.fallback);
  });

  it("asks for JSON, caps tokens, and bounds the wait", async () => {
    const { getFeedCopyProvider } = await import(
      "@/server/services/feedCopyProvider"
    );
    respondWith([]);

    const { provider } = getFeedCopyProvider();
    await provider.write([request], context);

    const options = createChatCompletion.mock.calls[0][1];
    expect(options.json).toBe(true);
    expect(options.maxTokens).toBeGreaterThan(500);
    expect(options.timeoutMs).toBeGreaterThan(0);
  });
});
