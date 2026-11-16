/**
 * Client-side image downscaling, for the support form's photos
 * (`lib/supportPhotos.ts`).
 *
 * A modern phone camera writes a 4-to-12 MB JPEG. Sending that as-is makes the
 * support email slow to send and heavy in the inbox, and nothing downstream
 * benefits: the picture is looked at on a phone or in a mail client, never
 * printed. So every image is decoded, drawn into a
 * canvas at a capped longest edge and re-encoded before it is sent.
 *
 * ## Three guarantees, all of them load-bearing
 *
 * 1. **The result is never bigger than the input.** Re-encoding can grow a
 *    file — a small PNG screenshot, an already-optimised JPEG — so the encoded
 *    blob is measured and the original returned when it did not help. Without
 *    this, "resizing" would sometimes make the upload worse.
 * 2. **A file it cannot handle passes through untouched.** A PDF is not an
 *    image; HEIC is an image no Chromium build can decode. The server accepts
 *    HEIC, so every failure path returns the caller's own file rather than
 *    throwing, and `supportPhotos` judges what comes back.
 * 3. **The name follows the bytes.** A re-encoded HEIC is a JPEG, and storing
 *    JPEG bytes under `IMG_0001.HEIC` misleads every consumer downstream.
 */

/** Longest edge of the re-encoded image, in pixels. 1600 is comfortably more
 *  than a phone screen or a desktop preview pane shows, and roughly a tenth of
 *  a 12 MP original's pixel count. */
export const MAX_IMAGE_EDGE = 1600;

/** JPEG quality. 0.82 is the knee: visually indistinguishable from 0.95 on a
 *  photograph or a screenshot, at around half the bytes. */
export const IMAGE_QUALITY = 0.82;

/** What a resized image is re-encoded as. JPEG, not WebP: iOS Safari's canvas
 *  silently falls back to PNG for an unsupported type, which on a photograph is
 *  larger than the original — caught by the never-bigger guarantee, but it
 *  would mean no resizing happened at all. */
export const RESIZED_CONTENT_TYPE = "image/jpeg";

/**
 * `width`/`height` scaled to fit inside a `maxEdge` box, preserving the aspect
 * ratio. Already-small dimensions are returned unchanged (never upscaled), and
 * the result is at least 1x1 — a 4000x3 panorama must not round to zero height
 * and produce an unusable canvas.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** `IMG_0001.HEIC` → `IMG_0001.jpg`. Keeps the stem, which is how the sender
 *  recognises the photo, and drops a now-wrong extension. */
export function toJpegName(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, "");
  return `${stem || "photo"}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, RESIZED_CONTENT_TYPE, IMAGE_QUALITY));
}

/**
 * Downscale and re-encode `file`, or return `file` unchanged when that is not
 * possible or not an improvement. Never throws and never returns something
 * larger than what it was given.
 */
export async function resizeImageFile(
  file: File,
  maxEdge: number = MAX_IMAGE_EDGE,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Absent in a jsdom test and in older Safari; the uploader must still work.
  if (typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF orientation while decoding. Without it a
    // photo taken in portrait is drawn to the canvas rotated, and the
    // re-encoded copy has no EXIF tag left to correct it — so the resize would
    // silently turn every portrait photograph on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // HEIC on Chromium, a truncated download, a mislabelled file.
    return file;
  }

  try {
    const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await canvasToBlob(canvas);
    // `>=` not `>`: an equal size is not worth swapping the user's own file
    // (and its name) for.
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], toJpegName(file.name), {
      type: RESIZED_CONTENT_TYPE,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
