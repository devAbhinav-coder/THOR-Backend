import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import AppError from "../../types/utils/AppError";
import { aiConfig, blogAiConfig } from "../../config/ai";
import {
  askStore,
  draftBlogPost,
  draftMarketingEmail,
  draftProductCopy,
  draftReviewReply,
  explainOrder,
  explainReturns,
  explainUser,
  getActionSuggestions,
  getAiStatus,
  getDailyBrief,
} from "../../services/ai/adminAiService";
import { generateBlogCalendarPlan } from "../../services/ai/blogCalendarAiService";

function ensureEnabled(
  _req: Request,
  _res: Response,
  next: (err?: Error) => void,
) {
  if (!aiConfig.enabled) {
    return next(
      new AppError(
        "Admin AI is not configured. Set GROQ_API_KEY on the server.",
        503,
      ),
    );
  }
  next();
}

function ensureBlogAiEnabled(
  _req: Request,
  _res: Response,
  next: (err?: Error) => void,
) {
  if (!blogAiConfig.enabled) {
    const msg =
      blogAiConfig.provider === "gemini" ?
        "Blog AI is not configured. Set GEMINI_API_KEY on the server."
      : "Blog AI is not configured. Set GEMINI_API_KEY or GROQ_API_KEY on the server.";
    return next(new AppError(msg, 503));
  }
  next();
}

export const getAdminAiStatus = catchAsync(
  async (_req: Request, res: Response) => {
    sendSuccess(res, getAiStatus());
  },
);

export const getAdminDailyBrief = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const force = req.query.force === "true";
    const data = await getDailyBrief(force);
    sendSuccess(res, data, "Daily brief generated.");
  }),
];

export const getAdminActionSuggestions = [
  ensureEnabled,
  catchAsync(async (_req: Request, res: Response) => {
    const data = await getActionSuggestions();
    sendSuccess(res, data, "Action suggestions ready.");
  }),
];

export const explainAdminOrder = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await explainOrder(req.params.orderId);
    sendSuccess(res, data, "Order explained.");
  }),
];

export const explainAdminUser = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await explainUser(req.params.userId);
    sendSuccess(res, data, "User insights explained.");
  }),
];

export const explainAdminReturns = [
  ensureEnabled,
  catchAsync(async (_req: Request, res: Response) => {
    const data = await explainReturns();
    sendSuccess(res, data, "Returns explained.");
  }),
];

export const draftAdminProductCopy = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftProductCopy(req.body);
    sendSuccess(res, data, "Product copy drafted.");
  }),
];

export const draftAdminReviewReply = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftReviewReply(req.params.reviewId);
    sendSuccess(res, data, "Review reply drafted.");
  }),
];

export const draftAdminMarketingEmail = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftMarketingEmail(req.body);
    sendSuccess(res, data, "Email drafted.");
  }),
];

export const draftAdminBlogPost = [
  ensureBlogAiEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await draftBlogPost(req.body);
    sendSuccess(res, data, "Blog drafted.");
  }),
];

export const planAdminBlogCalendar = [
  ensureBlogAiEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await generateBlogCalendarPlan(req.body);
    sendSuccess(res, data, "Content calendar planned.");
  }),
];

export const askAdminStore = [
  ensureEnabled,
  catchAsync(async (req: Request, res: Response) => {
    const data = await askStore(req.body.question, req.body.history);
    sendSuccess(res, data, "Answer generated.");
  }),
];
