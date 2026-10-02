import sharp from "sharp";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export async function compressAvatar(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES) throw new Error("INVALID_AVATAR");
  const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("INVALID_AVATAR");
  // Re-encode, remove metadata and honor EXIF orientation. The UI crops the thumbnail, not the stored photo.
  const result = await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer();
  if (result.length > 128 * 1024) throw new Error("INVALID_AVATAR");
  return result;
}
