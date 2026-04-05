import { FilterQuery, Types } from "mongoose";
import User from "../models/User";
import { enqueueBroadcastChunks } from "../queues/emailQueue";

type Recipient = { _id: Types.ObjectId; email: string; name?: string };

/**
 * Streams active users and enqueues broadcast chunk jobs (10 emails per job, no Promise.all).
 * Template is built once from the first row (same subject/html for all recipients).
 */
export async function enqueueBroadcastByUserFilter(
  userFilter: FilterQuery<unknown>,
  buildPayload: (recipient: Recipient) => {
    subject: string;
    html: string;
    jobIdPrefix: string;
  },
  batchSize = 500,
): Promise<number> {
  let total = 0;
  let lastId: Types.ObjectId | null = null;
  let subject: string | null = null;
  let html: string | null = null;
  const pendingEmails: string[] = [];

  const flushPending = async () => {
    if (pendingEmails.length === 0 || !subject || !html) return;
    await enqueueBroadcastChunks([...pendingEmails], subject, html);
    pendingEmails.length = 0;
  };

  while (true) {
    const filter: FilterQuery<unknown> = {
      ...userFilter,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    };
    const recipients: Recipient[] = await User.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .select("_id email name")
      .lean<Recipient[]>();

    if (!recipients.length) break;

    if (subject === null) {
      const payload = buildPayload(recipients[0]);
      subject = payload.subject;
      html = payload.html;
    }

    for (const u of recipients) {
      pendingEmails.push(u.email);
      total++;
      if (pendingEmails.length >= 10) {
        await flushPending();
      }
    }

    lastId = recipients[recipients.length - 1]._id;
    if (recipients.length < batchSize) break;
  }

  await flushPending();
  return total;
}
