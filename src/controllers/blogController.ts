import { Request, Response, NextFunction } from 'express';
import Blog from '../models/Blog';
import BlogComment from '../models/BlogComment';
import { deleteMultipleImages } from '../services/cloudinary';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import APIFeatures from '../utils/apiFeatures';
import { emailTemplates } from '../services/emailService';
import { IBlog, AuthRequest } from '../types';
import logger from '../utils/logger';
import { sendPaginated, sendSuccess } from '../utils/response';
import { blogRepository } from '../repositories/blogRepository';
import { safeJsonParse } from '../utils/safeJson';
import { enqueueBroadcastByUserFilter } from '../services/broadcastService';

type BlogBroadcastPayload = { _id: unknown; title: string; slug: string };
const broadcastNewBlog = async (blog: BlogBroadcastPayload) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const recipients = await enqueueBroadcastByUserFilter(
      { isActive: true, role: 'user' },
      (user) => {
        const tpl = emailTemplates.custom(
          `New Story: ${blog.title} — The House of Rani`,
          `<p>Hi ${user.name || 'there'},</p><p>We have just published a new story that you might love: <strong>${blog.title}</strong>.</p><p>Dive into our latest journal entry to stay inspired with the latest trends and updates!</p>`,
          'Read Story',
          `${frontendUrl}/blog/${blog.slug}`
        );
        return { subject: tpl.subject, html: tpl.html, jobIdPrefix: `blog:${String(blog._id)}` };
      },
      400
    );
    logger.info('Broadcasted blog notification', { recipients, blogId: String(blog._id) });
  } catch (error) {
    logger.error('Failed to broadcast new blog', { error });
  }
};

export const getAllBlogs = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IBlog>(
    blogRepository.findPublishedList({ isPublished: true }),
    req.query as Record<string, string>
  )
    .filter()
    .search(['title', 'content'])
    .sort()
    .limitFields()
    .paginate();

  const [blogs, totalCount] = await Promise.all([
    features.query,
    Blog.countDocuments(features.query.getFilter()),
  ]);

  sendPaginated(
    res,
    { blogs },
    { page: features.getPage(), limit: features.getLimit(), total: totalCount }
  );
});

export const getAdminBlogs = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IBlog>(
    Blog.find().populate('author', 'name avatar'),
    req.query as Record<string, string>
  )
    .filter()
    .search(['title', 'content'])
    .sort()
    .paginate();

  const [blogs, totalCount] = await Promise.all([
    features.query,
    Blog.countDocuments(features.query.getFilter()),
  ]);

  sendPaginated(
    res,
    { blogs },
    { page: features.getPage(), limit: features.getLimit(), total: totalCount }
  );
});

export const getBlogBySlug = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const blog = await Blog.findOneAndUpdate(
    { slug: req.params.slug, isPublished: true },
    { $inc: { viewCount: 1 } },
    { new: true }
  ).populate('author', 'name avatar');

  if (!blog) return next(new AppError('No blog found with that slug.', 404));

  const comments = await BlogComment.find({ blog: blog._id })
    .populate('user', 'name avatar')
    .sort('-createdAt');

  sendSuccess(res, { blog, comments });
});

export const createBlog = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const uploadedImages = (req as AuthRequest & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  
  let captions: string[] = [];
  if (req.body.captions) {
    captions = safeJsonParse<string[]>(req.body.captions, Array.isArray(req.body.captions) ? req.body.captions : [], 'captions');
  }

  const images = uploadedImages?.map((img, index) => ({
    url: img.url,
    publicId: img.publicId,
    caption: captions[index] || '',
  })) || [];

  const blogData = {
    ...req.body,
    author: req.user?._id,
    images,
    isPublished: req.body.isPublished === 'true' || req.body.isPublished === true,
  };

  const blog = await Blog.create(blogData);

  if (blog.isPublished) {
    broadcastNewBlog(blog).catch((err: unknown) => logger.error('Blog broadcast failed', { err }));
  }

  sendSuccess(res, { blog }, 'Blog created', 201);
});

export const updateBlog = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  const updateData: Record<string, unknown> = { ...req.body };

  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  if (uploadedImages && uploadedImages.length > 0) {
    let captions: string[] = [];
    if (req.body.newCaptions) {
      captions = safeJsonParse<string[]>(
        req.body.newCaptions,
        Array.isArray(req.body.newCaptions) ? req.body.newCaptions : [],
        'newCaptions'
      );
    }
    const newImages = uploadedImages.map((img, index) => ({
      url: img.url,
      publicId: img.publicId,
      caption: captions[index] || '',
    }));
    updateData.images = [...blog.images, ...newImages];
  }

  if (req.body.existingImages) {
      const existingImagesParsed = safeJsonParse<unknown[]>(
        req.body.existingImages,
        [],
        'existingImages'
      );
      if (!updateData.images) {
          updateData.images = existingImagesParsed;
      } else {
          const currentImages = Array.isArray(updateData.images) ? updateData.images : [];
          updateData.images = [...existingImagesParsed, ...currentImages.slice(blog.images.length)];
      }
  }

  if (req.body.isPublished !== undefined) {
    updateData.isPublished = req.body.isPublished === 'true' || req.body.isPublished === true;
  }

  const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  if (updateData.isPublished && !blog.isPublished && updatedBlog) {
    broadcastNewBlog(updatedBlog).catch((err: unknown) =>
      logger.error('Blog publish broadcast failed', { err })
    );
  }

  sendSuccess(res, { blog: updatedBlog }, 'Blog updated');
});

export const deleteBlog = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  if (blog.images && blog.images.length > 0) {
    const publicIds = blog.images.map((img) => img.publicId);
    await deleteMultipleImages(publicIds);
  }

  await BlogComment.deleteMany({ blog: blog._id });
  await blog.deleteOne();

  res.status(204).end();
});

export const deleteBlogImage = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { id, publicId } = req.params;
  const blog = await Blog.findById(id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  await deleteMultipleImages([publicId]);
  blog.images = blog.images.filter((img) => img.publicId !== publicId);
  await blog.save();

  sendSuccess(res, { blog });
});

export const likeBlog = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  const userId = req.user?._id;
  if (!userId) {
     return next(new AppError('Unauthorized', 401));
  }

  const isLiked = blog.likes.includes(userId);

  if (isLiked) {
    blog.likes = blog.likes.filter((id) => id.toString() !== userId.toString());
  } else {
    blog.likes.push(userId);
  }

  await blog.save();

  sendSuccess(res, { likes: blog.likes });
});

export const addComment = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  const comment = await BlogComment.create({
    blog: blog._id,
    user: req.user?._id,
    content: req.body.content,
  });

  await comment.populate('user', 'name avatar');

  sendSuccess(res, { comment }, 'Comment added', 201);
});

export const deleteComment = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const comment = await BlogComment.findById(req.params.commentId);
  if (!comment) return next(new AppError('No comment found with that ID.', 404));

  if (req.user?.role !== 'admin' && comment.user.toString() !== req.user?._id.toString()) {
    return next(new AppError('You are not authorized to delete this comment.', 403));
  }

  await comment.deleteOne();

  res.status(204).end();
});
