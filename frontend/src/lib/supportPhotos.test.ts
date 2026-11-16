import { describe, expect, it } from "vitest";

import {
  SUPPORT_PHOTO_MAX_BYTES,
  type SupportPhoto,
  roomFor,
  sendablePhotos,
  supportPhotoRejection,
} from "./supportPhotos";

function file(type: string, size: number, name = "p.png"): File {
  const f = new File([new Uint8Array(Math.min(size, 8))], name, { type });
  // Size is what the check reads; avoid allocating 25 MB to test the cap.
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function photo(overrides: Partial<SupportPhoto>): SupportPhoto {
  return { key: "k", file: file("image/png", 10), preparing: false, error: null, ...overrides };
}

describe("supportPhotoRejection", () => {
  it("accepts the server's image types, case and parameters ignored", () => {
    expect(supportPhotoRejection(file("image/png", 10))).toBeNull();
    expect(supportPhotoRejection(file("IMAGE/JPEG; x=y", 10))).toBeNull();
    expect(supportPhotoRejection(file("image/heic", 10))).toBeNull();
  });

  it("refuses non-images, empty files and files over the cap", () => {
    expect(supportPhotoRejection(file("application/pdf", 10))).toBe(
      "application/pdf is not a supported image.",
    );
    expect(supportPhotoRejection(file("", 10))).toBe(
      "A file with no content type is not a supported image.",
    );
    expect(supportPhotoRejection(file("image/png", 0))).toBe("The image is empty.");
    expect(supportPhotoRejection(file("image/png", SUPPORT_PHOTO_MAX_BYTES + 1))).toBe(
      "The image is larger than the 25 MB limit.",
    );
  });
});

describe("roomFor", () => {
  it("caps the total at three", () => {
    expect(roomFor(0, 5)).toBe(3);
    expect(roomFor(2, 2)).toBe(1);
    expect(roomFor(3, 1)).toBe(0);
  });
});

describe("sendablePhotos", () => {
  it("keeps only settled, unrefused photos", () => {
    const ok = photo({ key: "a" });
    const sent = sendablePhotos([
      ok,
      photo({ key: "b", preparing: true }),
      photo({ key: "c", error: "nope" }),
    ]);
    expect(sent).toEqual([ok.file]);
  });
});
