import { Request, Response, NextFunction } from "express";
import Blog from "../models/Blog";
import BlogComment from "../models/BlogComment";
import { deleteMultipleImages } from "../services/cloudinary";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import APIFeatures from "../types/utils/apiFeatures";
import { emailTemplates } from "../services/emailService";
import { IBlog, AuthRequest } from "../types";
import logger from "../types/utils/logger";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import { blogRepository } from "../repositories/blogRepository";
import { safeJsonParse } from "../types/utils/safeJson";
import { enqueueBroadcastByUserFilter } from "../services/broadcastService";
import {
  computeReadingTimeMin,
  plainBlogExcerpt,
  enrichBlogContentHtml,
  slugFromTitle,
} from "../types/utils/blogContent";
import { findRelatedBlogs } from "../services/ai/blogRagContextBuilder";
import { syncBlogEmbedding } from "../services/ai/vectorIndexService";
import {
  cancelBlogPublishOutbox,
  recordBlogPublishOutbox,
} from "../services/blogPublishOutboxService";
import { notifyIndexNowStorefront } from "../services/indexNowService";
import { Types } from "mongoose";

type BlogBroadcastPayload = { _id: unknown; title: string; slug: string };

function parseStringArray(val: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof val === "string" && val.trim()) {
    return safeJsonParse<string[]>(
      val,
      val
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      "array",
    );
  }
  return fallback;
}

function parseObjectIdArray(val: unknown): Types.ObjectId[] {
  const ids = parseStringArray(val);
  return ids
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
}

function enrichBlogFields(body: Record<string, unknown>, existing?: IBlog) {
  const title = String(body.title || existing?.title || "").trim();
  const rawContent = String(body.content ?? existing?.content ?? "");
  const content = enrichBlogContentHtml(rawContent);
  const excerptRaw = String(body.excerpt ?? existing?.excerpt ?? "").trim();
  const excerpt = excerptRaw || plainBlogExcerpt(content, 180);
  const newSlug = String(body.slug || existing?.slug || slugFromTitle(title))
    .trim()
    .toLowerCase();

  const slugChanged =
    Boolean(existing && body.slug !== undefined && newSlug !== existing.slug);

  return {
    title,
    slug: newSlug,
    ...(slugChanged && existing ? { oldSlug: existing.slug } : {}),
    content,
    excerpt,
    seoTitle: String(body.seoTitle ?? existing?.seoTitle ?? title)
      .trim()
      .slice(0, 70),
    seoDescription: String(
      body.seoDescription ?? existing?.seoDescription ?? excerpt,
    )
      .trim()
      .slice(0, 170),
    keywords:
      body.keywords !== undefined ?
        parseStringArray(body.keywords)
      : (existing?.keywords ?? []),
    tags:
      body.tags !== undefined ?
        parseStringArray(body.tags)
      : (existing?.tags ?? []),
    category: String(
      body.category ?? existing?.category ?? "saree-styling",
    ).trim(),
    articleTemplate: (() => {
      const allowed = ["classic", "magazine", "minimal", "lookbook"] as const;
      const raw = String(
        body.articleTemplate ?? existing?.articleTemplate ?? "classic",
      ).trim();
      return allowed.includes(raw as (typeof allowed)[number]) ?
          raw
        : "classic";
    })(),
    relatedProductIds:
      body.relatedProductIds !== undefined ?
        parseObjectIdArray(body.relatedProductIds)
      : (existing?.relatedProductIds ?? []),
    readingTimeMin: computeReadingTimeMin(content),
    aiGenerated:
      body.aiGenerated === "true" || body.aiGenerated === true ? true
      : body.aiGenerated === "false" || body.aiGenerated === false ? false
      : (existing?.aiGenerated ?? false),
    aiPromptSnapshot:
      body.aiPromptSnapshot !== undefined ?
        String(body.aiPromptSnapshot || "").slice(0, 500)
      : existing?.aiPromptSnapshot,
    scheduledPublishAt:
      body.scheduledPublishAt !== undefined ?
        body.scheduledPublishAt && String(body.scheduledPublishAt).trim() ?
          new Date(String(body.scheduledPublishAt))
        : null
      : existing?.scheduledPublishAt,
  };
}

export const broadcastNewBlog = async (blog: BlogBroadcastPayload) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const recipients = await enqueueBroadcastByUserFilter(
      { isActive: true, role: "user" },
      (user) => {
        const tpl = emailTemplates.custom(
          `New Story: ${blog.title} — The House of Rani`,
          `<p>Hi ${user.name || "there"},</p><p>We have just published a new story that you might love: <strong>${blog.title}</strong>.</p><p>Dive into our latest journal entry to stay inspired with the latest trends and updates!</p>`,
          "Read Story",
          `${frontendUrl}/blog/${blog.slug}`,
        );
        return {
          subject: tpl.subject,
          html: tpl.html,
          jobIdPrefix: `blog:${String(blog._id)}`,
        };
      },
      400,
    );
    logger.info("Broadcasted blog notification", {
      recipients,
      blogId: String(blog._id),
    });
  } catch (error) {
    logger.error("Failed to broadcast new blog", { error });
  }
};

export const getAllBlogs = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IBlog>(
    blogRepository.findPublishedList({ isPublished: true }),
    req.query as Record<string, string>,
  )
    .filter()
    .searchRegex(["title", "excerpt", "tags", "keywords", "category"])
    .sort()
    .limitFields()
    .paginate();

  const mongoFilter = {
    isPublished: true,
    ...features.getMongoFilter(),
  };

  const [blogs, totalCount] = await Promise.all([
    features.query,
    Blog.countDocuments(mongoFilter),
  ]);

  sendPaginated(
    res,
    { blogs },
    { page: features.getPage(), limit: features.getLimit(), total: totalCount },
  );
});

export const getAdminBlogs = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IBlog>(
    Blog.find().populate("author", "name avatar"),
    req.query as Record<string, string>,
  )
    .filter()
    .search(["title", "content"])
    .sort()
    .paginate();

  const [blogs, totalCount] = await Promise.all([
    features.query,
    Blog.countDocuments(features.query.getFilter()),
  ]);

  sendPaginated(
    res,
    { blogs },
    { page: features.getPage(), limit: features.getLimit(), total: totalCount },
  );
});

export const getRelatedBlogs = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const blog = await Blog.findOne({
      slug: req.params.slug,
      isPublished: true,
    }).select("_id tags category");

    if (!blog) return next(new AppError("No blog found with that slug.", 404));

    const related = await findRelatedBlogs(
      blog._id,
      blog.tags || [],
      blog.category,
      4,
    );

    sendSuccess(res, { blogs: related });
  },
);

export const getBlogBySlug = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const slugParam = String(req.params.slug || "").trim().toLowerCase();

    const blog = await Blog.findOneAndUpdate(
      { slug: slugParam, isPublished: true },
      { $inc: { viewCount: 1 } },
      { new: true },
    )
      .populate("author", "name avatar")
      .populate("relatedProductIds", "name slug images price shortDescription");

    if (!blog) {
      const byOldSlug = await Blog.findOne({
        oldSlug: slugParam,
        isPublished: true,
      }).select("slug");

      if (byOldSlug?.slug) {
        return sendSuccess(
          res,
          { redirect: { slug: byOldSlug.slug, permanent: true } },
          "Redirect",
        );
      }

      return next(new AppError("No blog found with that slug.", 404));
    }

    const comments = await BlogComment.find({ blog: blog._id })
      .populate("user", "name avatar")
      .sort("-createdAt");

    sendSuccess(res, { blog, comments });
  },
);

export const createBlog = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const multerFiles =
      (req.files as Express.Multer.File[] | undefined) || [];
    const uploadedImages = (
      req as AuthRequest & {
        uploadedImages?: { url: string; publicId: string }[];
      }
    ).uploadedImages;

    const expectedCount = Number.parseInt(
      String(req.body.expectedImageCount || "0"),
      10,
    );
    if (expectedCount > 0) {
      if (!uploadedImages?.length || uploadedImages.length < expectedCount) {
        return next(
          new AppError(
            `Image upload failed (${uploadedImages?.length || 0} of ${expectedCount} saved). Please try again.`,
            500,
          ),
        );
      }
    } else if (
      multerFiles.length > 0 &&
      (!uploadedImages?.length ||
        uploadedImages.length !== multerFiles.length)
    ) {
      return next(
        new AppError("Image upload failed. Please try again.", 500),
      );
    }

    let captions: string[] = [];
    if (req.body.captions) {
      captions = safeJsonParse<string[]>(
        req.body.captions,
        Array.isArray(req.body.captions) ? req.body.captions : [],
        "captions",
      );
    }

    let layouts: string[] = [];
    if (req.body.layouts) {
      layouts = safeJsonParse<string[]>(
        req.body.layouts,
        Array.isArray(req.body.layouts) ? req.body.layouts : [],
        "layouts",
      );
    }

    let placements: string[] = [];
    if (req.body.placements) {
      placements = safeJsonParse<string[]>(
        req.body.placements,
        Array.isArray(req.body.placements) ? req.body.placements : [],
        "placements",
      );
    }

    const images =
      uploadedImages?.map((img, index) => ({
        url: img.url,
        publicId: img.publicId,
        caption: captions[index] || "",
        layout: layouts[index] || (index === 0 ? "hero" : "inline"),
        placement: placements[index] || (index === 0 ? "cover" : "article"),
      })) || [];

    const enriched = enrichBlogFields(req.body as Record<string, unknown>);
    let isPublished =
      req.body.isPublished === "true" || req.body.isPublished === true;
    const scheduled = enriched.scheduledPublishAt as Date | null | undefined;
    if (scheduled && scheduled.getTime() > Date.now()) {
      isPublished = false;
    }

    const blogData = {
      ...enriched,
      author: req.user?._id,
      images,
      isPublished,
    };

    const blog = await Blog.create(blogData);
    syncBlogEmbedding(String(blog._id)).catch(() => {});

    if (scheduled && scheduled.getTime() > Date.now()) {
      await recordBlogPublishOutbox(String(blog._id), scheduled);
    } else if (blog.isPublished) {
      await cancelBlogPublishOutbox(String(blog._id));
    }

    if (blog.isPublished) {
      broadcastNewBlog(blog).catch((err: unknown) =>
        logger.error("Blog broadcast failed", { err }),
      );
      if (blog.slug) {
        notifyIndexNowStorefront(`/blog/${encodeURIComponent(String(blog.slug))}`);
      }
    }

    sendSuccess(res, { blog }, "Blog created", 201);
  },
);

export const updateBlog = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return next(new AppError("No blog found with that ID.", 404));

    const updateData: Record<string, unknown> = {
      ...enrichBlogFields(req.body as Record<string, unknown>, blog),
    };

    const multerFiles =
      (req.files as Express.Multer.File[] | undefined) || [];
    const uploadedImages = (
      req as Request & { uploadedImages?: { url: string; publicId: string }[] }
    ).uploadedImages;

    const expectedNew = Number.parseInt(
      String(req.body.expectedImageCount || "0"),
      10,
    );
    if (expectedNew > 0) {
      if (!uploadedImages?.length || uploadedImages.length < expectedNew) {
        return next(
          new AppError(
            `Image upload failed (${uploadedImages?.length || 0} of ${expectedNew} saved). Please try again.`,
            500,
          ),
        );
      }
    } else if (
      multerFiles.length > 0 &&
      (!uploadedImages?.length ||
        uploadedImages.length !== multerFiles.length)
    ) {
      return next(
        new AppError("Image upload failed. Please try again.", 500),
      );
    }

    if (uploadedImages && uploadedImages.length > 0) {
      let captions: string[] = [];
      if (req.body.newCaptions) {
        captions = safeJsonParse<string[]>(
          req.body.newCaptions,
          Array.isArray(req.body.newCaptions) ? req.body.newCaptions : [],
          "newCaptions",
        );
      }
      let layouts: string[] = [];
      if (req.body.newLayouts) {
        layouts = safeJsonParse<string[]>(
          req.body.newLayouts,
          Array.isArray(req.body.newLayouts) ? req.body.newLayouts : [],
          "newLayouts",
        );
      }
      let placements: string[] = [];
      if (req.body.newPlacements) {
        placements = safeJsonParse<string[]>(
          req.body.newPlacements,
          Array.isArray(req.body.newPlacements) ? req.body.newPlacements : [],
          "newPlacements",
        );
      }
      const newImages = uploadedImages.map((img, index) => ({
        url: img.url,
        publicId: img.publicId,
        caption: captions[index] || "",
        layout: layouts[index] || "inline",
        placement: placements[index] || "article",
      }));
      updateData.images = [...blog.images, ...newImages];
    }

    if (req.body.existingImages) {
      const existingImagesParsed = safeJsonParse<unknown[]>(
        req.body.existingImages,
        [],
        "existingImages",
      );
      if (!updateData.images) {
        updateData.images = existingImagesParsed;
      } else {
        const currentImages =
          Array.isArray(updateData.images) ? updateData.images : [];
        updateData.images = [
          ...existingImagesParsed,
          ...currentImages.slice(blog.images.length),
        ];
      }
    }

    if (req.body.isPublished !== undefined) {
      updateData.isPublished =
        req.body.isPublished === "true" || req.body.isPublished === true;
    }

    const scheduled = updateData.scheduledPublishAt as Date | null | undefined;
    if (scheduled && scheduled.getTime() > Date.now()) {
      updateData.isPublished = false;
    }
    if (updateData.isPublished === true) {
      updateData.scheduledPublishAt = null;
    }

    const updatedBlog = await Blog.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      },
    );

    if (updatedBlog) {
      syncBlogEmbedding(String(updatedBlog._id)).catch(() => {});

      if (scheduled && scheduled.getTime() > Date.now()) {
        await recordBlogPublishOutbox(String(updatedBlog._id), scheduled);
      } else if (updateData.isPublished === true) {
        await cancelBlogPublishOutbox(String(updatedBlog._id));
      }
    }

    if (updateData.isPublished && !blog.isPublished && updatedBlog) {
      broadcastNewBlog(updatedBlog).catch((err: unknown) =>
        logger.error("Blog publish broadcast failed", { err }),
      );
    }

    if (updatedBlog?.isPublished && updatedBlog.slug) {
      notifyIndexNowStorefront(
        `/blog/${encodeURIComponent(String(updatedBlog.slug))}`,
      );
    }

    sendSuccess(res, { blog: updatedBlog }, "Blog updated");
  },
);

export const deleteBlog = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return next(new AppError("No blog found with that ID.", 404));

    if (blog.images && blog.images.length > 0) {
      const publicIds = blog.images.map((img) => img.publicId);
      await deleteMultipleImages(publicIds);
    }

    await BlogComment.deleteMany({ blog: blog._id });
    await blog.deleteOne();

    res.status(204).end();
  },
);

export const deleteBlogImage = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const rawParam = req.params.publicId;
    const decodedId = decodeURIComponent(rawParam);
    const blog = await Blog.findById(id);
    if (!blog) return next(new AppError("No blog found with that ID.", 404));

    const match = blog.images.find(
      (img) => img.publicId === decodedId || img.publicId === rawParam,
    );
    if (!match)
      return next(new AppError("Image not found on this blog.", 404));

    await deleteMultipleImages([match.publicId]);
    blog.images = blog.images.filter((img) => img.publicId !== match.publicId);
    await blog.save();

    sendSuccess(res, { blog });
  },
);

export const likeBlog = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return next(new AppError("No blog found with that ID.", 404));

    const userId = req.user?._id;
    if (!userId) {
      return next(new AppError("Unauthorized", 401));
    }

    const isLiked = blog.likes.includes(userId);

    if (isLiked) {
      blog.likes = blog.likes.filter(
        (id) => id.toString() !== userId.toString(),
      );
    } else {
      blog.likes.push(userId);
    }

    await blog.save();

    sendSuccess(res, { likes: blog.likes });
  },
);

export const addComment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return next(new AppError("No blog found with that ID.", 404));

    const comment = await BlogComment.create({
      blog: blog._id,
      user: req.user?._id,
      content: req.body.content,
    });

    await comment.populate("user", "name avatar");

    sendSuccess(res, { comment }, "Comment added", 201);
  },
);

export const deleteComment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const comment = await BlogComment.findById(req.params.commentId);
    if (!comment)
      return next(new AppError("No comment found with that ID.", 404));

    if (
      req.user?.role !== "admin" &&
      comment.user.toString() !== req.user?._id.toString()
    ) {
      return next(
        new AppError("You are not authorized to delete this comment.", 403),
      );
    }

    await comment.deleteOne();

    res.status(204).end();
  },
);

export const trackBlogShopClick = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const blog = await Blog.findOneAndUpdate(
      { slug: req.params.slug, isPublished: true },
      { $inc: { shopClickCount: 1 } },
      { new: true },
    ).select("_id shopClickCount slug");

    if (!blog) return next(new AppError("No blog found with that slug.", 404));

    sendSuccess(res, {
      shopClickCount: blog.shopClickCount,
      productSlug: req.body?.productSlug || null,
    });
  },
);

export const getBlogAnalytics = catchAsync(async (_req: Request, res: Response) => {
  const [totals, topByViews, topByShopClicks, recentPublished] = await Promise.all([
    Blog.aggregate([
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          published: { $sum: { $cond: ["$isPublished", 1, 0] } },
          totalViews: { $sum: "$viewCount" },
          totalShopClicks: { $sum: "$shopClickCount" },
        },
      },
    ]),
    Blog.find({ isPublished: true })
      .sort("-viewCount")
      .limit(8)
      .select("title slug viewCount shopClickCount category createdAt")
      .lean(),
    Blog.find({ isPublished: true, shopClickCount: { $gt: 0 } })
      .sort("-shopClickCount")
      .limit(8)
      .select("title slug viewCount shopClickCount category")
      .lean(),
    Blog.find({ isPublished: true })
      .sort("-createdAt")
      .limit(5)
      .select("title slug createdAt viewCount shopClickCount")
      .lean(),
  ]);

  const summary = totals[0] || {
    totalPosts: 0,
    published: 0,
    totalViews: 0,
    totalShopClicks: 0,
  };

  sendSuccess(res, {
    summary: {
      ...summary,
      clickThroughRate:
        summary.totalViews > 0 ?
          Math.round((summary.totalShopClicks / summary.totalViews) * 10000) / 100
        : 0,
    },
    topByViews,
    topByShopClicks,
    recentPublished,
  });
});
