import { Request, Response, NextFunction } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import AppError from "../../types/utils/AppError";
import {
  whatsappConfigured,
  whatsappEnabled,
  whatsappMarketingEnabled,
  whatsappConfig,
  whatsAppTemplateLabels,
  whatsAppAutomatedTriggers,
} from "../../config/whatsapp";
import {
  getWhatsAppStats,
  listWhatsAppLogs,
} from "../../services/whatsappLogService";
import { getWhatsAppQueueCounts } from "../../queues/whatsappQueue";
import { sendWhatsAppTemplate } from "../../services/whatsappCloudService";
import { logWhatsAppQueued, logWhatsAppResult } from "../../services/whatsappLogService";
import { toWhatsAppMsisdn } from "../../config/whatsapp";
import User from "../../models/User";
import { isRedisOperational } from "../../config/redis";

export const getWhatsAppAdminStatus = catchAsync(
  async (_req: Request, res: Response) => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const [statsToday, statsAllTime, queueCounts, optedInCount, phoneUsersCount] =
      await Promise.all([
        getWhatsAppStats(dayStart),
        getWhatsAppStats(),
        getWhatsAppQueueCounts(),
        User.countDocuments({
          isActive: true,
          role: "user",
          whatsappMarketingOptIn: { $ne: false },
          $or: [
            { phone: { $exists: true, $nin: [null, ""] } },
            { "addresses.0.phone": { $exists: true } },
          ],
        }),
        User.countDocuments({
          isActive: true,
          role: "user",
          $or: [
            { phone: { $exists: true, $nin: [null, ""] } },
            { "addresses.0.phone": { $exists: true } },
          ],
        }),
      ]);

    const templates = Object.entries(whatsappConfig.templates).map(
      ([key, value]) => ({
        key,
        label: whatsAppTemplateLabels[key as keyof typeof whatsAppTemplateLabels],
        configured: Boolean(value),
        templateName: value || null,
      }),
    );

    sendSuccess(res, {
      enabled: whatsappEnabled(),
      configured: whatsappConfigured(),
      marketingEnabled: whatsappMarketingEnabled(),
      redisEnabled: isRedisOperational(),
      phoneNumberId: whatsappConfigured()
        ? whatsappConfig.phoneNumberId.slice(0, 6) + "…"
        : null,
      graphVersion: whatsappConfig.graphVersion,
      language: whatsappConfig.language,
      templates,
      automatedTriggers: whatsAppAutomatedTriggers.map((t) => ({
        ...t,
        templateConfigured: Boolean(
          whatsappConfig.templates[t.templateKey],
        ),
      })),
      audience: {
        usersWithPhone: phoneUsersCount,
        marketingOptIn: optedInCount,
      },
      stats: {
        today: statsToday,
        allTime: statsAllTime,
      },
      queue: queueCounts,
    });
  },
);

export const getWhatsAppAdminLogs = catchAsync(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const status = req.query.status as "queued" | "sent" | "failed" | undefined;
  const category = req.query.category as string | undefined;

  const logs = await listWhatsAppLogs({
    limit,
    status,
    category: category as Parameters<typeof listWhatsAppLogs>[0]["category"],
  });

  sendSuccess(res, { logs });
});

export const sendWhatsAppTest = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!whatsappEnabled()) {
      return next(
        new AppError(
          "WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
          503,
        ),
      );
    }

    const { phone, templateKey } = req.body as {
      phone?: string;
      templateKey?: string;
    };

    const to = toWhatsAppMsisdn(phone);
    if (!to) {
      return next(new AppError("Enter a valid Indian mobile number (10 digits).", 400));
    }

    const key = (templateKey || "catalog") as keyof typeof whatsappConfig.templates;
    const template = whatsappConfig.templates[key];
    if (!template) {
      return next(
        new AppError(`Template "${key}" is not configured in environment variables.`, 400),
      );
    }

    const logId = await logWhatsAppQueued({
      to,
      template,
      category: "test",
      bodyParams: ["Admin", "Test message from The House of Rani", frontendTestUrl()],
    });

    const result = await sendWhatsAppTemplate({
      to,
      template,
      bodyParams: ["Admin", "Test message from The House of Rani", frontendTestUrl()],
    });
    await logWhatsAppResult(logId, result);

    if (!result.ok) {
      return next(new AppError(result.errorMessage || "WhatsApp test send failed.", 502));
    }

    sendSuccess(res, { logId, metaMessageId: result.metaMessageId }, "Test WhatsApp sent.");
  },
);

function frontendTestUrl(): string {
  return (process.env.FRONTEND_URL || "https://thehouseofrani.com").replace(/\/$/, "");
}
