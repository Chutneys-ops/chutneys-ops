// Shrink a phone photo in the browser before uploading: a 12-megapixel
// photo is 3-5 MB, but an invoice is readable at 1600 px wide as a JPEG of
// about 200-400 KB. That's quicker on a truck's mobile data and cheaper to
// store. Uses a <canvas>, so no extra library.
//
// Re-encoding also drops the photo's EXIF data (including GPS location).

import { PHOTO_MAX_WIDTH, PHOTO_QUALITY, PHOTO_TARGET_BYTES, scaledSize } from "@/lib/uploads";

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not compress the photo"))),
      "image/jpeg",
      quality,
    );
  });
}

/** Any image the browser can open -> a JPEG at most 1600 px wide.
 *  Throws if the browser can't read the image (e.g. HEIC outside Safari). */
export async function shrinkImage(file: Blob): Promise<Blob> {
  // createImageBitmap applies the EXIF rotation, so sideways phone photos
  // come out the right way up.
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, PHOTO_MAX_WIDTH);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not compress the photo");
    // White background: a transparent PNG would otherwise turn black as a JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const first = await toJpeg(canvas, PHOTO_QUALITY);
    if (first.size <= PHOTO_TARGET_BYTES) return first;
    // A very busy photo: one more try a bit smaller, keep whichever is smaller.
    const second = await toJpeg(canvas, PHOTO_QUALITY - 0.1);
    return second.size < first.size ? second : first;
  } finally {
    bitmap.close();
  }
}
