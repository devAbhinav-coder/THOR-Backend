import { Request, Response, NextFunction } from "express";
import User from "../../models/User";
import AppError from "../../types/utils/AppError";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import {
  getMarketingAudienceStats,
  marketingDeliveryConfigured,
  sendMarketingCampaign,
  type MarketingAudience,
  type MarketingChannel,
} from "../../services/marketingCampaignService";

export const getMarketingAudiencePreview = catchAsync(
  async (req: Request, res: Response) => {
    const audience = (req.query.audience as MarketingAudience) || "users";
    const channelsRaw = String(req.query.channels || "email");
    const channels = channelsRaw
      .split(",")
      .map((c) => c.trim())
      .filter((c): c is MarketingChannel =>
        ["email", "in_app", "push"].includes(c),
      ) as MarketingChannel[];
    const includeOfflineLeads = req.query.includeOfflineLeads === "true";

    const stats = await getMarketingAudienceStats(
      audience,
      channels.length ? channels : ["email"],
      undefined,
      includeOfflineLeads,
    );

    sendSuccess(res, {
      ...stats,
      delivery: marketingDeliveryConfigured(),
    });
  },
);

export const sendCustomMarketingEmail = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      subject,
      messageHtml,
      audience = "users",
      userIds,
      ctaText,
      ctaLink,
      channels,
      includeOfflineLeads,
    } = req.body as {
      subject?: string;
      messageHtml?: string;
      audience?: MarketingAudience;
      userIds?: string[];
      ctaText?: string;
      ctaLink?: string;
      channels?: MarketingChannel[];
      includeOfflineLeads?: boolean;
    };

    if (!subject?.trim() || !messageHtml?.trim()) {
      return next(new AppError("Subject and message are required.", 400));
    }

    const activeChannels =
      channels?.length ? channels : (["email"] as MarketingChannel[]);

    if (
      activeChannels.includes("email") &&
      !marketingDeliveryConfigured().resendConfigured
    ) {
      return next(
        new AppError(
          "Email delivery is not configured (RESEND_API_KEY missing). Enable in-app or browser notifications, or configure Resend.",
          503,
        ),
      );
    }

    if (audience === "selected") {
      if (!userIds || userIds.length === 0) {
        return next(new AppError("Select at least one user.", 400));
      }
    }

    const result = await sendMarketingCampaign({
      subject: subject.trim(),
      messageHtml: messageHtml.trim(),
      audience,
      userIds,
      ctaText,
      ctaLink,
      channels: activeChannels,
      includeOfflineLeads: Boolean(includeOfflineLeads),
    });

    const parts: string[] = [];
    if (result.emailsQueued > 0) {
      parts.push(
        `${result.emailsQueued} email(s) queued${result.emailChunkJobs ? ` in ${result.emailChunkJobs} batch(es)` : ""}`,
      );
    }
    if (result.offlineEmailsQueued > 0) {
      parts.push(`${result.offlineEmailsQueued} offline lead email(s) queued`);
    }
    if (result.notificationsQueued > 0) {
      const notifBits: string[] = [];
      if (activeChannels.includes("in_app")) notifBits.push("in-app");
      if (activeChannels.includes("push")) notifBits.push("browser push");
      parts.push(
        `${result.notificationsQueued} account(s) — ${notifBits.join(" + ")}`,
      );
    }

    sendSuccess(
      res,
      result,
      parts.length ? parts.join(". ") + "." : "Campaign queued.",
    );
  },
);
