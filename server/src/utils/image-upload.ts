import multer from "multer";

export const receiveProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype));
  }
}).single("image");

export const receivePromoImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype));
  }
}).single("image");

export function validatedProfileImage(file?: Express.Multer.File) {
  if (!file) throw new Error("Choose a JPEG, PNG, or WebP image under 2 MB");
  const valid = file.mimetype === "image/jpeg"
    ? file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : file.mimetype === "image/png"
      ? file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : file.mimetype === "image/webp"
        ? file.buffer.subarray(0, 4).toString("ascii") === "RIFF" && file.buffer.subarray(8, 12).toString("ascii") === "WEBP"
        : false;
  if (!valid) throw new Error("The uploaded image content does not match its file type");
  return { data: file.buffer, mimeType: file.mimetype, updatedAt: new Date() };
}

export function validatedPromoImage(file?: Express.Multer.File) {
  if (!file) throw new Error("Choose a JPEG, PNG, or WebP image under 4 MB");
  return validatedProfileImage(file);
}
