import AppError from "./AppError";

const IMAGE_MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
} as const;

const VIDEO_MIME = {
  mp4: "video/mp4",
  webm: "video/webm",
  quicktime: "video/quicktime",
} as const;

function startsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

/**
 * Sniff raster image type from magic bytes (ignores client Content-Type).
 * Rejects SVG/HTML/polyglot payloads that claim to be images.
 */
export function sniffImageMime(buffer: Buffer): string | null {
  if (!buffer?.length) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return IMAGE_MIME.jpeg;

  if (
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return IMAGE_MIME.png;
  }

  if (
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return IMAGE_MIME.gif;
  }

  // RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return IMAGE_MIME.webp;
  }

  return null;
}

/**
 * Sniff common video containers used for product motion clips.
 */
export function sniffVideoMime(buffer: Buffer): string | null {
  if (!buffer?.length) return null;

  // EBML / WebM
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return VIDEO_MIME.webm;

  // ISO BMFF (MP4 / MOV): ....ftyp
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 4, 8) === "ftyp"
  ) {
    const brand = buffer.toString("ascii", 8, 12);
    if (brand.startsWith("qt")) return VIDEO_MIME.quicktime;
    return VIDEO_MIME.mp4;
  }

  return null;
}

/** Assert buffer is a real allowed image; returns sniffed MIME. */
export function assertImageMagicBytes(buffer: Buffer): string {
  const mime = sniffImageMime(buffer);
  if (!mime) {
    throw new AppError(
      "Invalid image file. Only real JPEG, PNG, WebP, or GIF uploads are allowed.",
      400,
    );
  }
  return mime;
}

/** Assert buffer is a real allowed video; returns sniffed MIME. */
export function assertVideoMagicBytes(buffer: Buffer): string {
  const mime = sniffVideoMime(buffer);
  if (!mime) {
    throw new AppError(
      "Invalid video file. Only real MP4, WebM, or MOV uploads are allowed.",
      400,
    );
  }
  return mime;
}
