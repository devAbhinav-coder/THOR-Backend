import { enqueueBroadcastChunks } from "../queues/emailQueue";

export type BroadcastUser = { email: string };

/**
 * Production broadcast entry point: queues chunks of 10 recipients; each chunk is
 * sent one-by-one via Resend with 1–2s spacing (see `runBroadcastChunk`).
 */
export async function sendBroadcast(
  users: BroadcastUser[],
  subject: string,
  html: string,
): Promise<{ recipientCount: number; chunkJobs: number }> {
  const emails = users.map((u) => u.email).filter(Boolean);
  const chunkJobs = await enqueueBroadcastChunks(emails, subject, html);
  return { recipientCount: emails.length, chunkJobs };
}
