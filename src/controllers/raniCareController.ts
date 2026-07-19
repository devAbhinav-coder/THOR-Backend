import { Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendSuccess } from "../types/utils/response";
import { AuthRequest } from "../types";
import {
  answerRaniCareMessage,
  isRaniCareAiEnabled,
} from "../services/ai/raniCareAiService";

export const postRaniCareChat = catchAsync(async (req: AuthRequest, res: Response) => {
  const { message, localIntent, recentMessages } = req.body as {
    message: string;
    localIntent?: string;
    recentMessages?: Array<{ role: "user" | "bot"; text: string }>;
  };

  // Trust the server-side session (optionalProtect), not the client-sent flag.
  const userId = req.user?._id ? String(req.user._id) : undefined;

  const data = await answerRaniCareMessage({
    message,
    isAuthenticated: Boolean(userId),
    userId,
    localIntent,
    recentMessages,
  });

  sendSuccess(res, { ...data, aiEnabled: isRaniCareAiEnabled() }, "Rani Care reply ready.");
});

export const getRaniCareStatus = catchAsync(async (_req: AuthRequest, res: Response) => {
  sendSuccess(res, { aiEnabled: isRaniCareAiEnabled() });
});
