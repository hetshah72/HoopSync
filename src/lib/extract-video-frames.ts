/**
 * Pulls still frames out of a video file in the browser, before upload.
 *
 * Browser-only by nature - it drives `<video>` and `<canvas>` - but it lives in
 * `src/lib` because it imports nothing from `src/server` and is safe to bundle.
 *
 * Why here rather than on the server: the browser already holds the file the
 * player picked, and it already has a video decoder. Extracting twelve stills
 * client-side means the server never needs an ffmpeg binary, never has to hold
 * a 250MB clip in memory to decode it, and only receives a few hundred KB of
 * JPEG regardless of how long the original clip is. On a serverless host that
 * is the difference between a workable feature and a cold-start problem.
 *
 * Every failure path returns an empty array rather than throwing. A phone
 * clip in a codec this browser can't decode is an ordinary outcome, not an
 * error: the upload still succeeds and the analysis falls back to the
 * profile-based review, correctly labelled as such.
 */
import {
  FRAME_WIDTH_PX,
  MAX_FRAMES,
  frameTimestamps,
  type GameFilmFrame,
} from "@/lib/game-film-vision";

/** A stuck seek must not hold the upload hostage. */
const SEEK_TIMEOUT_MS = 5_000;
const METADATA_TIMEOUT_MS = 10_000;
const JPEG_QUALITY = 0.7;

function once(
  target: EventTarget,
  event: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${event}".`));
    }, timeoutMs);

    function onEvent() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error(`The video emitted an error waiting for "${event}".`));
    }
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    }

    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

export interface ExtractFramesOptions {
  maxFrames?: number;
  /** Reports progress 0..1 so the upload button can show real movement. */
  onProgress?: (fraction: number) => void;
}

export async function extractVideoFrames(
  file: File,
  options: ExtractFramesOptions = {},
): Promise<GameFilmFrame[]> {
  if (typeof document === "undefined") return [];

  const maxFrames = options.maxFrames ?? MAX_FRAMES;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  // Required for iOS Safari to decode without a user gesture.
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await once(video, "loadedmetadata", METADATA_TIMEOUT_MS);

    const duration = video.duration;
    const timestamps = frameTimestamps(duration, maxFrames);
    if (timestamps.length === 0) return [];

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return [];

    const scale = Math.min(1, FRAME_WIDTH_PX / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const context = canvas.getContext("2d");
    if (!context) return [];

    const frames: GameFilmFrame[] = [];
    for (const [index, timestampInVideoSeconds] of timestamps.entries()) {
      try {
        video.currentTime = timestampInVideoSeconds;
        await once(video, "seeked", SEEK_TIMEOUT_MS);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        if (base64.length > 0) {
          frames.push({ base64, timestampInVideoSeconds });
        }
      } catch {
        // One unreadable seek shouldn't cost the other eleven frames.
        continue;
      }
      options.onProgress?.((index + 1) / timestamps.length);
    }

    return frames;
  } catch {
    return [];
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
