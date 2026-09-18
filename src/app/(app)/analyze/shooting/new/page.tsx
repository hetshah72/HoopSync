import { PageHeader } from "@/components/layout/page-header";
import { SessionRecorder } from "@/components/analyze/session-recorder";
import { VideoUploadForm } from "@/components/analyze/video-upload-form";

/**
 * The two ingest paths BRD 7.5 asks for: "Player records themselves shooting
 * from within the app", with upload alongside it for footage shot on
 * something else. Both land on the same tap-to-log screen.
 */
export default function NewShootingSessionPage() {
  return (
    <div>
      <PageHeader
        back={{ href: "/analyze", label: "Back to Analyze" }}
        eyebrow="Analyze"
        title="New shooting session"
        description="Record here or upload a clip, then tap-log each shot as you watch it back. Makes, misses and locations are yours to enter - nothing is detected for you."
      />
      <div className="space-y-4">
        <SessionRecorder />
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <VideoUploadForm />
      </div>
    </div>
  );
}
