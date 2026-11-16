// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fitWithin,
  IMAGE_QUALITY,
  RESIZED_CONTENT_TYPE,
  resizeImageFile,
  toJpegName,
} from "./imageResize";

/**
 * The resize helper, with the browser's two halves of the pipeline stubbed:
 * jsdom implements neither `createImageBitmap` nor a real 2D canvas, so a
 * decoder and an encoder are installed per test.
 *
 * That is not a weakness of the test — it is what makes the interesting cases
 * reachable at all. The encoder is where the guarantees live, so it is driven
 * deliberately: one test gives it fewer bytes than the input, one gives it
 * more, one makes it fail outright. Real bytes through a real canvas could only
 * ever exercise the first.
 */

const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  HTMLCanvasElement.prototype.toBlob = realToBlob;
  vi.unstubAllGlobals();
});

/** Install a decoder that reports `width`x`height` for any file. */
function stubDecoder(width: number, height: number) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  const decode = vi.fn(async (file: Blob, options?: ImageBitmapOptions) => {
    void file;
    void options;
    return bitmap;
  });
  vi.stubGlobal("createImageBitmap", decode);
  return { close, decode };
}

/** Install a canvas whose encoder produces `bytes` bytes (or fails, for null). */
function stubCanvas(bytes: number | null) {
  const drawImage = vi.fn();
  const canvases: HTMLCanvasElement[] = [];
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    canvases.push(this);
    return { drawImage } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  const encode = vi.fn(function (
    callback: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    void quality;
    callback(bytes === null ? null : new Blob([new Uint8Array(bytes)], { type }));
  });
  HTMLCanvasElement.prototype.toBlob = encode;
  return { drawImage, encode, canvases };
}

function photo(bytes: number, name = "IMG_0001.jpg", type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("fitWithin", () => {
  it("scales the longest edge down to the cap, keeping the ratio", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(2000, 2000, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("never upscales an image that already fits", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("floors the short edge at one pixel", () => {
    // A 4000x2 panorama scales to a height of 0.8 — a canvas of height 0 cannot
    // be drawn into, so the guard is what keeps the resize from throwing.
    expect(fitWithin(4000, 2, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe("toJpegName", () => {
  it("replaces the extension, because the bytes are now JPEG", () => {
    expect(toJpegName("IMG_0001.HEIC")).toBe("IMG_0001.jpg");
    expect(toJpegName("pump leak.png")).toBe("pump leak.jpg");
  });

  it("adds one to a name that has none", () => {
    expect(toJpegName("photo")).toBe("photo.jpg");
  });
});

describe("resizeImageFile", () => {
  it("returns a SMALLER file than the phone handed over", async () => {
    stubDecoder(4000, 3000);
    stubCanvas(180_000);
    const original = photo(4_000_000);

    const resized = await resizeImageFile(original);

    expect(resized.size).toBeLessThan(original.size);
    expect(resized.size).toBe(180_000);
    expect(resized.type).toBe(RESIZED_CONTENT_TYPE);
  });

  it("renames the result, since a re-encoded HEIC is a JPEG", async () => {
    stubDecoder(4032, 3024);
    stubCanvas(200_000);

    const resized = await resizeImageFile(photo(6_000_000, "IMG_0002.HEIC", "image/heic"));

    expect(resized.name).toBe("IMG_0002.jpg");
    expect(resized.type).toBe("image/jpeg");
  });

  it("draws into a canvas sized by fitWithin, at the chosen quality", async () => {
    stubDecoder(4000, 3000);
    const { drawImage, encode, canvases } = stubCanvas(180_000);

    await resizeImageFile(photo(4_000_000), 1600);

    expect(canvases.map((c) => [c.width, c.height])).toEqual([[1600, 1200]]);
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([0, 0, 1600, 1200]);
    expect(encode.mock.calls[0]?.slice(1)).toEqual([RESIZED_CONTENT_TYPE, IMAGE_QUALITY]);
  });

  it("returns the ORIGINAL when re-encoding would make it bigger", async () => {
    // Real case, not a contrivance: a flat PNG screenshot or an already
    // optimised JPEG both grow when pushed through a JPEG encoder. "Resizing"
    // must never make the upload worse.
    stubDecoder(1200, 900);
    stubCanvas(90_000);
    const original = photo(40_000, "screenshot.png", "image/png");

    const resized = await resizeImageFile(original);

    expect(resized).toBe(original);
  });

  it("returns the original when the encoder fails", async () => {
    stubDecoder(4000, 3000);
    stubCanvas(null);
    const original = photo(4_000_000);

    expect(await resizeImageFile(original)).toBe(original);
  });

  it("returns the original when the image cannot be decoded", async () => {
    // HEIC on every Chromium build, and any truncated or mislabelled file.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("The source image cannot be decoded.");
      }),
    );
    stubCanvas(1_000);
    const original = photo(4_000_000, "IMG_0003.HEIC", "image/heic");

    expect(await resizeImageFile(original)).toBe(original);
  });

  it("passes a document straight through", async () => {
    const decoder = stubDecoder(10, 10);
    const original = new File([new Uint8Array(2_000_000)], "scope.pdf", {
      type: "application/pdf",
    });

    expect(await resizeImageFile(original)).toBe(original);
    // Not even decoded — a PDF is not an image.
    expect(decoder.decode).not.toHaveBeenCalled();
  });

  it("passes through where createImageBitmap does not exist", async () => {
    // jsdom, and Safari before 15. The uploader still has to work.
    const original = photo(4_000_000);
    expect(await resizeImageFile(original)).toBe(original);
  });

  it("closes the decoded bitmap, so the pixels are not held", async () => {
    const { close } = stubDecoder(4000, 3000);
    stubCanvas(180_000);

    await resizeImageFile(photo(4_000_000));

    expect(close).toHaveBeenCalledOnce();
  });

  it("applies the EXIF orientation while decoding", async () => {
    // Without this a portrait photograph is drawn sideways, and the re-encoded
    // copy has no EXIF tag left for a viewer to correct it.
    const { decode } = stubDecoder(3000, 4000);
    stubCanvas(180_000);

    await resizeImageFile(photo(4_000_000));

    expect(decode.mock.calls[0]?.[1]).toEqual({ imageOrientation: "from-image" });
  });
});
