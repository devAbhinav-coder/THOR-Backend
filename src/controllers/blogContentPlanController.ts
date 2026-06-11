import { Response, NextFunction } from 'express';
import BlogContentPlan from '../models/BlogContentPlan';
import AppError from '../types/utils/AppError';
import catchAsync from '../types/utils/catchAsync';
import { sendSuccess } from '../types/utils/response';
import { AuthRequest } from '../types';

function parseKeywords(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export const getContentPlans = catchAsync(async (req: AuthRequest, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const filter: Record<string, unknown> = {};
  if (from || to) {
    filter.plannedDate = {};
    if (from) (filter.plannedDate as Record<string, Date>).$gte = from;
    if (to) (filter.plannedDate as Record<string, Date>).$lte = to;
  }
  if (req.query.status) filter.status = req.query.status;

  const plans = await BlogContentPlan.find(filter)
    .populate('blog', 'title slug isPublished')
    .populate('createdBy', 'name')
    .sort('plannedDate')
    .lean();

  sendSuccess(res, { plans });
});

export const createContentPlan = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const topic = String(req.body.topic || '').trim();
    if (topic.length < 5) return next(new AppError('Topic is required.', 400));
    const plannedDate = new Date(req.body.plannedDate);
    if (Number.isNaN(plannedDate.getTime())) {
      return next(new AppError('Valid plannedDate is required.', 400));
    }

    const plan = await BlogContentPlan.create({
      topic,
      keywords: parseKeywords(req.body.keywords),
      category: req.body.category || 'saree-styling',
      plannedDate,
      notes: req.body.notes,
      status: 'planned',
      createdBy: req.user?._id,
    });

    sendSuccess(res, { plan }, 'Content plan created', 201);
  },
);

export const updateContentPlan = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const plan = await BlogContentPlan.findById(req.params.id);
    if (!plan) return next(new AppError('Plan not found.', 404));

    if (req.body.topic) plan.topic = String(req.body.topic).trim();
    if (req.body.keywords !== undefined) plan.keywords = parseKeywords(req.body.keywords);
    if (req.body.category) plan.category = req.body.category;
    if (req.body.plannedDate) {
      const d = new Date(req.body.plannedDate);
      if (!Number.isNaN(d.getTime())) plan.plannedDate = d;
    }
    if (req.body.notes !== undefined) plan.notes = req.body.notes;
    if (req.body.status) plan.status = req.body.status;
    if (req.body.blog) plan.blog = req.body.blog;

    await plan.save();
    sendSuccess(res, { plan }, 'Plan updated');
  },
);

export const deleteContentPlan = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const plan = await BlogContentPlan.findByIdAndDelete(req.params.id);
    if (!plan) return next(new AppError('Plan not found.', 404));
    res.status(204).end();
  },
);

export const bulkCreateContentPlans = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return next(new AppError('No items to add.', 400));
    if (items.length > 16) return next(new AppError('Max 16 plans per batch.', 400));

    const docs = [];
    for (const raw of items) {
      const topic = String(raw.topic || '').trim();
      if (topic.length < 5) continue;
      const plannedDate = new Date(raw.plannedDate);
      if (Number.isNaN(plannedDate.getTime())) continue;

      docs.push({
        topic,
        keywords: parseKeywords(raw.keywords),
        category: raw.category || 'saree-styling',
        plannedDate,
        notes: raw.notes ? String(raw.notes).slice(0, 1000) : undefined,
        status: 'planned',
        createdBy: req.user?._id,
      });
    }

    if (docs.length === 0) return next(new AppError('No valid plan items.', 400));

    const plans = await BlogContentPlan.insertMany(docs);
    sendSuccess(res, { plans, count: plans.length }, 'Plans added', 201);
  },
);
