import { Request, Response, NextFunction } from 'express';
import Blog from '../models/Blog';
import BlogComment from '../models/BlogComment';
import { deleteMultipleImages } from '../services/cloudinary';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import APIFeatures from '../utils/apiFeatures';
import User from '../models/User';
import { sendEmailNow, emailTemplates } from '../services/emailService';
import { IBlog, AuthRequest } from '../types';

const broadcastNewBlog = async (blog: any) => {
  try {
    const users = await User.find({ isActive: true, role: 'user' }); // target regular users
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    const emailPromises = users.map((user: any) => {
      const emailPayload = emailTemplates.custom(
        `New Story: ${blog.title} — The House of Rani`,
        `<p>Hi ${user.name},</p><p>We have just published a new story that you might love: <strong>${blog.title}</strong>.</p><p>Dive into our latest journal entry to stay inspired with the latest trends and updates!</p>`,
        'Read Story',
        `${frontendUrl}/blog/${blog.slug}`
      );
      
      return sendEmailNow({
        to: user.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
      }).catch((err) => console.error(`Failed to send to ${user.email}`, err));
    });

    await Promise.all(emailPromises);
    console.log(`Broadcasted new blog to ${users.length} users.`);
  } catch (error) {
    console.error('Failed to broadcast new blog:', error);
  }
};

export const getAllBlogs = catchAsync(async (req: Request, res: Response) => {
  const features = new APIFeatures<IBlog>(
    Blog.find({ isPublished: true }).populate('author', 'name avatar'),
    req.query as Record<string, string>
  )
    .filter()
    .search(['title', 'content'])
    .sort()
    .limitFields()
    .paginate();

  const [blogs, totalCount] = await Promise.all([
    features.query,
    Blog.countDocuments({ isPublished: true }),
  ]);

  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '12', 10);

  res.status(200).json({
    status: 'success',
    results: blogs.length,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalBlogs: totalCount,
      hasNextPage: page * limit < totalCount,
      hasPrevPage: page > 1,
    },
    data: { blogs },
  });
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
    Blog.countDocuments(),
  ]);

  res.status(200).json({
    status: 'success',
    results: blogs.length,
    total: totalCount,
    data: { blogs },
  });
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

  res.status(200).json({
    status: 'success',
    data: { blog, comments },
  });
});

export const createBlog = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const uploadedImages = (req as AuthRequest & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  
  let captions: string[] = [];
  if (req.body.captions) {
    try {
      captions = JSON.parse(req.body.captions);
    } catch {
      if (Array.isArray(req.body.captions)) {
        captions = req.body.captions;
      }
    }
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
    broadcastNewBlog(blog).catch(console.error);
  }

  res.status(201).json({
    status: 'success',
    data: { blog },
  });
});

export const updateBlog = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  const updateData: Record<string, any> = { ...req.body };

  const uploadedImages = (req as Request & { uploadedImages?: { url: string; publicId: string }[] }).uploadedImages;
  if (uploadedImages && uploadedImages.length > 0) {
    let captions: string[] = [];
    if (req.body.newCaptions) {
      try { captions = JSON.parse(req.body.newCaptions); } catch { if (Array.isArray(req.body.newCaptions)) captions = req.body.newCaptions; }
    }
    const newImages = uploadedImages.map((img, index) => ({
      url: img.url,
      publicId: img.publicId,
      caption: captions[index] || '',
    }));
    updateData.images = [...blog.images, ...newImages];
  }

  if (req.body.existingImages) {
      try {
          const existingImagesParsed = JSON.parse(req.body.existingImages);
          if (!updateData.images) {
              updateData.images = existingImagesParsed;
          } else {
              updateData.images = [...existingImagesParsed, ...updateData.images.slice(blog.images.length)];
          }
      } catch (e) {
          // ignore error
      }
  }

  if (req.body.isPublished !== undefined) {
    updateData.isPublished = req.body.isPublished === 'true' || req.body.isPublished === true;
  }

  const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  if (updateData.isPublished && !blog.isPublished) {
    broadcastNewBlog(updatedBlog).catch(console.error);
  }

  res.status(200).json({
    status: 'success',
    data: { blog: updatedBlog },
  });
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

  res.status(204).json({ status: 'success', data: null });
});

export const deleteBlogImage = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { id, publicId } = req.params;
  const blog = await Blog.findById(id);
  if (!blog) return next(new AppError('No blog found with that ID.', 404));

  await deleteMultipleImages([publicId]);
  blog.images = blog.images.filter((img) => img.publicId !== publicId);
  await blog.save();

  res.status(200).json({
    status: 'success',
    data: { blog },
  });
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

  res.status(200).json({
    status: 'success',
    data: { likes: blog.likes },
  });
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

  res.status(201).json({
    status: 'success',
    data: { comment },
  });
});

export const deleteComment = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const comment = await BlogComment.findById(req.params.commentId);
  if (!comment) return next(new AppError('No comment found with that ID.', 404));

  if (req.user?.role !== 'admin' && comment.user.toString() !== req.user?._id.toString()) {
    return next(new AppError('You are not authorized to delete this comment.', 403));
  }

  await comment.deleteOne();

  res.status(204).json({ status: 'success', data: null });
});
