import WhatsAppMessageLog, {
  type WhatsAppMessageCategory,
  type WhatsAppMessageStatus,
} from "../models/WhatsAppMessageLog";

export async function logWhatsAppQueued(opts: {
  to: string;
  template: string;
  category: WhatsAppMessageCategory;
  bodyParams?: string[];
  userId?: string;
  orderId?: string;
  campaignSubject?: string;
}): Promise<string> {
  const doc = await WhatsAppMessageLog.create({
    to: opts.to,
    template: opts.template,
    category: opts.category,
    status: "queued",
    bodyParams: opts.bodyParams,
    userId: opts.userId || null,
    orderId: opts.orderId || null,
    campaignSubject: opts.campaignSubject,
    queuedAt: new Date(),
  });
  return String(doc._id);
}

export async function logWhatsAppResult(
  logId: string | undefined,
  result: { ok: boolean; metaMessageId?: string; errorMessage?: string },
): Promise<void> {
  if (!logId) return;
  const status: WhatsAppMessageStatus = result.ok ? "sent" : "failed";
  await WhatsAppMessageLog.findByIdAndUpdate(logId, {
    status,
    metaMessageId: result.metaMessageId,
    errorMessage: result.errorMessage,
    sentAt: result.ok ? new Date() : undefined,
  }).catch(() => {});
}

export async function getWhatsAppStats(since?: Date): Promise<{
  sent: number;
  failed: number;
  queued: number;
  total: number;
  byCategory: Record<string, { sent: number; failed: number }>;
}> {
  const match = since ? { createdAt: { $gte: since } } : {};
  const [statusAgg, categoryAgg] = await Promise.all([
    WhatsAppMessageLog.aggregate<{ _id: WhatsAppMessageStatus; count: number }>([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    WhatsAppMessageLog.aggregate<{
      _id: { category: string; status: WhatsAppMessageStatus };
      count: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { category: "$category", status: "$status" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const counts = { sent: 0, failed: 0, queued: 0, total: 0 };
  for (const row of statusAgg) {
    counts[row._id] = row.count;
    counts.total += row.count;
  }

  const byCategory: Record<string, { sent: number; failed: number }> = {};
  for (const row of categoryAgg) {
    const cat = row._id.category;
    if (!byCategory[cat]) byCategory[cat] = { sent: 0, failed: 0 };
    if (row._id.status === "sent") byCategory[cat].sent = row.count;
    if (row._id.status === "failed") byCategory[cat].failed = row.count;
  }

  return { ...counts, byCategory };
}

export async function listWhatsAppLogs(opts: {
  limit?: number;
  status?: WhatsAppMessageStatus;
  category?: WhatsAppMessageCategory;
}): Promise<
  Array<{
    _id: string;
    to: string;
    template: string;
    category: WhatsAppMessageCategory;
    status: WhatsAppMessageStatus;
    errorMessage?: string;
    campaignSubject?: string;
    createdAt: Date;
    sentAt?: Date;
  }>
> {
  const filter: Record<string, unknown> = {};
  if (opts.status) filter.status = opts.status;
  if (opts.category) filter.category = opts.category;

  const rows = await WhatsAppMessageLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit || 50)
    .select(
      "to template category status errorMessage campaignSubject createdAt sentAt",
    )
    .lean();

  return rows.map((r) => ({
    _id: String(r._id),
    to: r.to,
    template: r.template,
    category: r.category,
    status: r.status,
    errorMessage: r.errorMessage,
    campaignSubject: r.campaignSubject,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
  }));
}
