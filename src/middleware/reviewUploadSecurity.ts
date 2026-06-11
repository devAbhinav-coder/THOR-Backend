import { Request, Response, NextFunction } from "express";
import AppError from "../types/utils/AppError";
import { REVIEW_MAX_IMAGES } from "../services/reviews/reviewConstants";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * Defense-in-depth after multer — whitelist MIME/extension and cap count.
 */
export function assertReviewUploadSecurity(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) return next();

  if (files.length > REVIEW_MAX_IMAGES) {
    return next(
      new AppError(
        `You can upload at most ${REVIEW_MAX_IMAGES} images per review.`,
        400,
      ),
    );
  }

  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return next(
        new AppError("Only JPEG, PNG, WebP, or GIF images are allowed.", 400),
      );
    }
    const ext = (file.originalname || "").toLowerCase().match(/\.[a-z]+$/)?.[0];
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      return next(new AppError("Invalid image file extension.", 400));
    }
    if (file.size > 3 * 1024 * 1024) {
      return next(
        new AppError("Each review image must be 3MB or smaller.", 400),
      );
    }
  }

  next();
}
