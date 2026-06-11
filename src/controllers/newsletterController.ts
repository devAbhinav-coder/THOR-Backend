import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import NewsletterSubscriber from "../models/NewsletterSubscriber";
import { notifyAdmins, notifyAdminsEmail } from "../services/notificationService";

function adminSubscribeEmailHtml(email: string, source: string): string {
  const label = source === "blog_detail" ? "Blog article page" : "Blog listing page";
  return `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h2 style="margin:0 0 12px;font-size:20px;">New journal subscriber</h2>
      <p style="margin:0 0 8px;font-size:15px;"><strong>Email:</strong> ${email}</p>
      <p style="margin:0 0 8px;font-size:15px;"><strong>Source:</strong> ${label}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#666;">View all subscribers in the admin panel.</p>
    </div>
  `;
}

export const subscribeNewsletter = catchAsync(async (req: Request, res: Response) => {
  const { email, source } = req.body as { email: string; source: string };

  const existing = await NewsletterSubscriber.findOne({ email });
  if (existing) {
    if (existing.isActive) {
      sendSuccess(res, { subscribed: true }, "You're already on the list.");
      return;
    }
    existing.isActive = true;
    existing.unsubscribedAt = null;
    existing.source = source as "blog_listing" | "blog_detail";
    await existing.save();

    notifyAdminsEmail(
      "Journal subscriber rejoined",
      adminSubscribeEmailHtml(email, source),
    ).catch(() => {});
    notifyAdmins(
      "Subscriber rejoined",
      `${email} resubscribed to The Inner Circle`,
      "/admin/newsletter",
      "system",
    ).catch(() => {});

    sendSuccess(res, { subscribed: true }, "Welcome back to The Inner Circle.");
    return;
  }

  await NewsletterSubscriber.create({ email, source });

  notifyAdminsEmail(
    "New journal subscriber",
    adminSubscribeEmailHtml(email, source),
  ).catch(() => {});
  notifyAdmins(
    "New subscriber",
    `${email} joined The Inner Circle`,
    "/admin/newsletter",
    "system",
  ).catch(() => {});

  sendSuccess(res, { subscribed: true }, "Welcome to The Inner Circle.", 201);
});

export const getNewsletterSubscribersAdmin = catchAsync(
  async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || "").trim().toLowerCase();
    const activeFilter = String(req.query.active || "all");

    const filter: Record<string, unknown> = {};
    if (activeFilter === "true") filter.isActive = true;
    if (activeFilter === "false") filter.isActive = false;
    if (search) {
      filter.email = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const skip = (page - 1) * limit;
    const [subscribers, total, activeCount] = await Promise.all([
      NewsletterSubscriber.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("email source isActive unsubscribedAt createdAt updatedAt")
        .lean(),
      NewsletterSubscriber.countDocuments(filter),
      NewsletterSubscriber.countDocuments({ isActive: true }),
    ]);

    sendPaginated(
      res,
      { subscribers, activeCount },
      { page, limit, total },
    );
  },
);
