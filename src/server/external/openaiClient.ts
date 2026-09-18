import "server-only";
import OpenAI from "openai";
import { ExternalServiceError } from "@/server/errors";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

let client: OpenAI | undefined;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError(
      "AI Coach isn't configured yet - OPENAI_API_KEY is missing.",
    );
  }
  client ??= new OpenAI({ apiKey });
  return client;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * Constrain the reply to a single JSON object. The daily feed generator
   * writes several cards in one call and has to parse them back apart; free
   * text wrapped in prose or a markdown fence would make that guesswork.
   */
  json?: boolean;
  /**
   * Abandon the request after this long. The feed generates lazily during a
   * Home page render, so an unbounded wait would hold the page open - it
   * would rather fall back to its own deterministic copy than stall.
   */
  timeoutMs?: number;
}

export async function createChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<string> {
  const openai = getClient();
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  let completion;
  try {
    completion = await openai.chat.completions.create(
      {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 500,
        ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
      },
      options.timeoutMs ? { timeout: options.timeoutMs } : undefined,
    );
  } catch (err) {
    throw new ExternalServiceError(
      "Coach couldn't reach OpenAI right now.",
      err instanceof Error ? err.message : err,
    );
  }

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new ExternalServiceError("OpenAI returned an empty response.");
  }
  return content;
}

export interface VisionImage {
  /** Bare base64 JPEG payload - no `data:` prefix. */
  base64: string;
  /** Shown to the model so it can cite the moment a frame came from. */
  label: string;
}

/**
 * One vision call over a set of stills.
 *
 * Separate from `createChatCompletion` because the shape genuinely differs:
 * a multi-part user message carrying images, a vision-capable model, a much
 * larger token ceiling, and a longer timeout - a dozen frames take far longer
 * than a chat turn. `detail: "low"` is deliberate: it caps each image at a
 * fixed, cheap token cost, which is what keeps a twelve-frame analysis at
 * roughly a cent rather than scaling with the player's camera resolution.
 */
export async function createVisionCompletion(
  systemPrompt: string,
  userPrompt: string,
  images: VisionImage[],
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const openai = getClient();
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o";

  let completion;
  try {
    completion = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text" as const, text: userPrompt },
              ...images.flatMap((image) => [
                { type: "text" as const, text: image.label },
                {
                  type: "image_url" as const,
                  image_url: {
                    url: `data:image/jpeg;base64,${image.base64}`,
                    detail: "low" as const,
                  },
                },
              ]),
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: options.maxTokens ?? 1500,
        response_format: { type: "json_object" as const },
      },
      { timeout: options.timeoutMs ?? 120_000 },
    );
  } catch (err) {
    throw new ExternalServiceError(
      "Couldn't reach the analysis model.",
      err instanceof Error ? err.message : err,
    );
  }

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new ExternalServiceError("The analysis model returned an empty response.");
  }
  return content;
}
