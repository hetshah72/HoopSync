import { CheckCircle2, CircleSlash } from "lucide-react";
import { getAiStatus } from "@/server/services/adminService";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Admin - AI" };

/**
 * AI management (BRD 6.2).
 *
 * The point of this screen is answerability. The player-facing honesty rules -
 * simulated analysis is labelled, archetype content describes a role rather
 * than a person, generated copy is disclosed - are only enforceable if someone
 * can see what is actually running. "Is the Coach answering from a model or
 * from templates right now?" was previously only answerable by reading the
 * environment on the server.
 *
 * No key, or any part of one, is rendered here - only whether one is present.
 */
export default async function AdminAiPage() {
  const status = await getAiStatus();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="AI"
        description="What each AI-shaped surface is actually doing right now."
      />

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={
                status.openAiConfigured
                  ? "inline-flex items-center gap-1.5 text-sm font-medium text-success-soft-foreground"
                  : "inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground"
              }
            >
              {status.openAiConfigured ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <CircleSlash className="size-4" />
              )}
              {status.openAiConfigured
                ? "OpenAI key configured"
                : "No OpenAI key configured"}
            </span>

            <Badge variant="outline">chat: {status.chatModel}</Badge>
            <Badge variant="outline">vision: {status.visionModel}</Badge>
            <Badge variant="outline">
              coach limit: {status.coachRateLimit.maxMessages} /{" "}
              {status.coachRateLimit.windowMinutes}m
            </Badge>
          </div>

          {!status.openAiConfigured && (
            <p className="mt-3 text-xs text-muted-foreground">
              Nothing is broken without a key - every surface below has a real
              deterministic fallback, which is why the app works offline and in
              tests. The fallbacks are narrower, not absent.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto">
          <h2 className="font-heading text-sm font-semibold tracking-tight">
            Surfaces
          </h2>

          <table className="mt-3 w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left">
                <th className="pb-2 font-medium text-muted-foreground">
                  Surface
                </th>
                <th className="pb-2 font-medium text-muted-foreground">
                  Running now
                </th>
                <th className="pb-2 font-medium text-muted-foreground">
                  Disclosure
                </th>
              </tr>
            </thead>
            <tbody>
              {status.surfaces.map((surface) => (
                <tr
                  key={surface.surface}
                  className="border-b border-border/40 last:border-0 align-top"
                >
                  <td className="py-2.5 pr-3 font-medium">{surface.surface}</td>
                  <td className="py-2.5 pr-3">
                    <span className="block">
                      {surface.configured ? surface.live : surface.fallback}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {surface.configured
                        ? `Falls back to: ${surface.fallback.toLowerCase()}`
                        : `With a key: ${surface.live.toLowerCase()}`}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {surface.mustBeLabelled ? (
                      <Badge variant="warning">Labelled in the UI</Badge>
                    ) : (
                      <Badge variant="outline">No label needed</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 text-xs text-muted-foreground">
            &quot;Labelled in the UI&quot; means the output is generated rather
            than measured, and the player-facing screen says so. Shot make/miss
            and location are never in this category - those come from the
            player&apos;s own taps and are real data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
