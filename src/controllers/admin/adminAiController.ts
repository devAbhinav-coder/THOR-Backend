import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import { sendSuccess } from '../../utils/response';
import AppError from '../../utils/AppError';
import { aiConfig } from '../../config/ai';
import {
  askStore,
  draftMarketingEmail,
  draftProductCopy,
  draftReviewReply,
  explainOrder,
  explainReturns,
  explainUser,
  getActionSuggestions,
  getAiStatus,
  getDailyBrief,
} from '../../services/ai/adminAiService';

function ensureEnabled(_req: Request, _res: Response, next: (err?: Error) => void) {
  if (!aiConfig.enabled) {
    return next(new AppError('Admin AI is not configured. Set GROQ_API_KEY on the server.', 503));
  }
  next();
}

export const getAdminAiStatus = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, getAiStatus());
});

export const getAdminDailyBrief = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const force = req.query.force === 'true';
    const data = await getDailyBrief(force);
    sendSuccess(res, data, 'Daily brief generated.');
  }),
];

export const getAdminActionSuggestions = [
  ensureEnabled,
  catchAsync(async (_req: Request, res: Response) => {
    const data = await getActionSuggestions();
    sendSuccess(res, data, 'Action suggestions ready.');
  }),
];

export const explainAdminOrder = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await explainOrder(req.params.orderId);
    sendSuccess(res, data, 'Order explained.');
  }),
];

export const explainAdminUser = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await explainUser(req.params.userId);
    sendSuccess(res, data, 'User insights explained.');
  }),
];

export const explainAdminReturns = [
  ensureEnabled,
  catchAsync(async (_req: Request, res: Response) => {
    const data = await explainReturns();
    sendSuccess(res, data, 'Returns explained.');
  }),
];

export const draftAdminProductCopy = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftProductCopy(req.body);
    sendSuccess(res, data, 'Product copy drafted.');
  }),
];

export const draftAdminReviewReply = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftReviewReply(req.params.reviewId);
    sendSuccess(res, data, 'Review reply drafted.');
  }),
];

export const draftAdminMarketingEmail = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftMarketingEmail(req.body);
    sendSuccess(res, data, 'Email drafted.');
  }),
];

export const askAdminStore = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await askStore(req.body.question, req.body.history);
    sendSuccess(res, data, 'Answer generated.');
  }),
];
