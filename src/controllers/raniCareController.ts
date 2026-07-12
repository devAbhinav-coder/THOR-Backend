import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendSuccess } from "../types/utils/response";
import {
  answerRaniCareMessage,
  isRaniCareAiEnabled,
} from "../services/ai/raniCareAiService";

export const postRaniCareChat = catchAsync(async (req: Request, res: Response) => {
  const { message, isAuthenticated, localIntent, recentMessages } = req.body as {
    message: string;
    isAuthenticated?: boolean;
    localIntent?: string;
    recentMessages?: Array<{ role: "user" | "bot"; text: string }>;
  };

  const data = await answerRaniCareMessage({
    message,
    isAuthenticated: Boolean(isAuthenticated),
    localIntent,
    recentMessages,
  });

  sendSuccess(res, { ...data, aiEnabled: isRaniCareAiEnabled() }, "Rani Care reply ready.");
});

export const getRaniCareStatus = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, { aiEnabled: isRaniCareAiEnabled() });
});
