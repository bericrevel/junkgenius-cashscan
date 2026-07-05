import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

export interface CapturedPhoto {
  base64: string;
  mediaType: string;
  previewUrl: string;
}

// Why width 1280 / quality 80 (from the ship-readiness audit):
// - Claude downscales images to ≤1568px on the long edge anyway — pixels
//   beyond that are pure waste.
// - Uncapped modern-phone photos (3-8MB → 4-10MB as base64) blow BOTH the
//   Vercel 4.5MB body limit and Anthropic's 5MB per-image limit: scans would
//   fail on exactly the newest devices.
// - Mission math: an uncapped photo costs the user 3-5¢ of prepaid data and
//   30-60s on one bar of rural LTE. A capped one is under a cent and a few
//   seconds. 1280px is plenty to identify a lawnmower.
const CAPTURE_OPTS = {
  quality: 80,
  width: 1280,
  resultType: CameraResultType.Base64 as const,
  saveToGallery: false, // also means: zero Android permissions needed
};

// Belt-and-braces: reject anything that would still blow the payload limits
// (~4.5M base64 chars ≈ 3.4MB raw). With the caps above this shouldn't happen.
const MAX_B64_CHARS = 4_500_000;

/** True when the user backed out of the camera/picker — not a real error. */
export function isCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("cancel");
}

function toCaptured(base64String: string | undefined, format: string | undefined): CapturedPhoto {
  if (!base64String) throw new Error("The camera didn't return a photo. Try again.");
  if (base64String.length > MAX_B64_CHARS) {
    throw new Error("That photo came out too big to send. Try again from a bit further back.");
  }
  const mediaType = `image/${format || "jpeg"}`;
  return {
    base64: base64String,
    mediaType,
    previewUrl: `data:${mediaType};base64,${base64String}`,
  };
}

/** Opens the device's real native camera via Capacitor (no browser sandbox). */
export async function takePhoto(): Promise<CapturedPhoto> {
  const photo = await Camera.getPhoto({ ...CAPTURE_OPTS, source: CameraSource.Camera });
  return toCaptured(photo.base64String, photo.format);
}

/** Fallback: pick an existing photo instead of taking a new one. */
export async function pickPhoto(): Promise<CapturedPhoto> {
  const photo = await Camera.getPhoto({ ...CAPTURE_OPTS, source: CameraSource.Photos });
  return toCaptured(photo.base64String, photo.format);
}
