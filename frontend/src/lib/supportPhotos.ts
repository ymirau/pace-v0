import { resizeImageFile } from "./imageResize";

/**
 * Photos on the support form - staging, resizing and the limits.
 *
 * Mirrors `routers/support.py`'s `_read_images` and `services/uploads.py`: at
 * most `IMAGES_MAX` images, image types only, each within the size cap. Those
 * refusals are checked here, per photo, so one bad photo is marked beside
 * itself and left out rather than failing the whole send with a 422.
 *
 * A photo is resized the moment it is chosen: the thumbnail then shows what
 * will be sent, and a photo still too big after resizing says so before Send
 * rather than after.
 */

/** `IMAGES_MAX` in `routers/support.py`. */
export const SUPPORT_PHOTOS_MAX = 3;

/** `MAX_UPLOAD_BYTES` in `services/uploads.py`. */
export const SUPPORT_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/** `IMAGE_CONTENT_TYPES` in `services/uploads.py`. */
export const SUPPORT_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export interface SupportPhoto {
  /** Stable key for React and removal - not the name; the same photo can be chosen twice. */
  key: string;
  /** The resized file once ready (or the original while resizing). */
  file: File;
  /** True until the resize has settled. */
  preparing: boolean;
  /** Why this photo will not be sent, or null. */
  error: string | null;
}

let nextKey = 1;

export function newPhotoKey(): string {
  return `p${nextKey++}`;
}

/** `"IMAGE/JPEG; x=y"` -> `"image/jpeg"`, as the server normalises it. */
function normaliseContentType(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

/** Why the server would refuse this image, in its words, or null. */
export function supportPhotoRejection(file: File): string | null {
  const type = normaliseContentType(file.type);
  if (!(SUPPORT_PHOTO_TYPES as readonly string[]).includes(type)) {
    return `${type || "A file with no content type"} is not a supported image.`;
  }
  if (file.size === 0) return "The image is empty.";
  if (file.size > SUPPORT_PHOTO_MAX_BYTES) {
    return `The image is larger than the ${SUPPORT_PHOTO_MAX_BYTES / (1024 * 1024)} MB limit.`;
  }
  return null;
}

/**
 * Resize `file` and judge the result. `resizeImageFile` is written never to
 * throw, but a failure here would otherwise leave the photo "preparing" forever
 * and Send disabled with it, so a throw is caught and marked on the photo.
 */
export async function preparePhoto(file: File): Promise<Pick<SupportPhoto, "file" | "error">> {
  try {
    const resized = await resizeImageFile(file);
    return { file: resized, error: supportPhotoRejection(resized) };
  } catch {
    return { file, error: "This image could not be prepared." };
  }
}

/** How many of `chosen` fit beside `current` photos - the rest are refused. */
export function roomFor(current: number, chosen: number): number {
  return Math.max(0, Math.min(chosen, SUPPORT_PHOTOS_MAX - current));
}

/** The photos that go out with the message: settled and unrefused. */
export function sendablePhotos(photos: SupportPhoto[]): File[] {
  return photos.filter((photo) => !photo.preparing && photo.error === null).map((p) => p.file);
}
