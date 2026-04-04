/**
 * Some legacy/admin entries store Cloudinary URLs without the delivery segment
 * `image/upload`, e.g. `.../cloud_name/folder/file.jpg` instead of
 * `.../cloud_name/image/upload/folder/file.jpg`. Those URLs 404; Next.js
 * `/_next/image` then returns an empty/broken response.
 */
export function normalizeCloudinaryDeliveryUrl(
  url: string | undefined | null,
): string {
  if (url == null) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    if (u.hostname !== "res.cloudinary.com") return trimmed;
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return trimmed;
    const resource = segments[1];
    if (
      resource === "image" ||
      resource === "video" ||
      resource === "raw"
    ) {
      return trimmed;
    }
    const cloud = segments[0];
    const rest = segments.slice(1).join("/");
    u.pathname = `/${cloud}/image/upload/${rest}`;
    return u.toString();
  } catch {
    return trimmed;
  }
}
