import { FilterQuery, Types } from "mongoose";
import User from "../models/User";
import { enqueueBroadcastEmail } from "../queues/emailQueue";

type Recipient = { _id: Types.ObjectId; email: string; name?: string };

export async function enqueueBroadcastByUserFilter(
  userFilter: FilterQuery<unknown>,
  buildPayload: (recipient: Recipient) => { subject: string; html: string; jobIdPrefix: string },
  batchSize = 500
): Promise<number> {
  let sent = 0;
  let lastId: Types.ObjectId | null = null;

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

    await Promise.all(
      recipients.map((u: Recipient) => {
        const payload = buildPayload(u);
        return enqueueBroadcastEmail(
          { to: u.email, subject: payload.subject, html: payload.html },
          { jobId: `${payload.jobIdPrefix}:${String(u._id)}` }
        );
      })
    );

    sent += recipients.length;
    lastId = recipients[recipients.length - 1]._id;
  }

  return sent;
}
