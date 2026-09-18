/**
 * The one definition of how a shooting-session clip gets to the server,
 * shared by the two ingest paths BRD 7.5 calls for: recording in the app and
 * uploading an existing file.
 *
 * The size cap lives here rather than only in the route handler so the client
 * can reject an over-long recording immediately, instead of pushing 100MB up
 * the wire to be told no.
 */
export const MAX_SESSION_VIDEO_BYTES = 100 * 1024 * 1024;

export const MAX_SESSION_VIDEO_LABEL = "100MB";

/** POSTs a clip and returns the new session's id. Throws with the server's
 *  own message so callers can surface it directly. */
export async function uploadSessionVideo(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("video", file);

  const response = await fetch("/api/shot-sessions/upload", {
    method: "POST",
    body: formData,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Upload failed.");
  }
  return body.data.sessionId as string;
}
