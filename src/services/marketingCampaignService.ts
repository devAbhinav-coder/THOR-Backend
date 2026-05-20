import { FilterQuery, Types } from 'mongoose';
import User from '../models/User';
import OfflineCustomer from '../models/OfflineCustomer';
import { Notification } from '../models/Notification';
import { emailTemplates } from './emailService';
import { enqueueBroadcastChunks } from '../queues/emailQueue';
import { enqueueBroadcastByUserFilter } from './broadcastService';
import { sanitizeMarketingEmailHtml } from '../utils/sanitizeMarketingHtml';
import { htmlToPlainText } from '../utils/emailPlainText';
import { normalizeMarketingCtaLink } from '../utils/marketingCtaLink';
import { onNotificationCreated } from './notifications/notificationReadService';
import { queuePushForUser } from './notifications/notificationDeliveryService';

export type MarketingChannel = 'email' | 'in_app' | 'push';
export type MarketingAudience = 'all' | 'users' | 'admins' | 'selected';

export type MarketingCampaignInput = {
  subject: string;
  messageHtml: string;
  audience: MarketingAudience;
  userIds?: string[];
  channels: MarketingChannel[];
  includeOfflineLeads?: boolean;
  ctaText?: string;
  ctaLink?: string;
};

export type MarketingAudienceStats = {
  audience: MarketingAudience;
  accountUsers: number;
  offlineLeadEmails: number;
  estimatedEmailRecipients: number;
  estimatedNotificationRecipients: number;
  channels: MarketingChannel[];
};

function buildUserFilter(
  audience: MarketingAudience,
  userIds?: string[],
): FilterQuery<unknown> {
  if (audience === 'selected') {
    return { _id: { $in: userIds || [] }, isActive: true };
  }
  if (audience === 'admins') {
    return { role: 'admin', isActive: true };
  }
  if (audience === 'users') {
    return { role: 'user', isActive: true };
  }
  return { isActive: true };
}

async function countOfflineOnlyEmails(): Promise<number> {
  const leadEmails = await OfflineCustomer.find({}).select('email').lean<{ email: string }[]>();
  if (!leadEmails.length) return 0;
  const normalized = leadEmails.map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  const existing = await User.find({ email: { $in: normalized } })
    .select('email')
    .lean<{ email: string }[]>();
  const existingSet = new Set(existing.map((u) => u.email.trim().toLowerCase()));
  return normalized.filter((e) => !existingSet.has(e)).length;
}

export async function getMarketingAudienceStats(
  audience: MarketingAudience,
  channels: MarketingChannel[],
  userIds?: string[],
  includeOfflineLeads = false,
): Promise<MarketingAudienceStats> {
  const filter = buildUserFilter(audience, userIds);
  const accountUsers = await User.countDocuments(filter);
  const wantsEmail = channels.includes('email');
  const offlineLeadEmails =
    wantsEmail && includeOfflineLeads && audience !== 'admins' ?
      await countOfflineOnlyEmails()
    : 0;

  return {
    audience,
    accountUsers,
    offlineLeadEmails,
    estimatedEmailRecipients: accountUsers + offlineLeadEmails,
    estimatedNotificationRecipients:
      channels.includes('in_app') || channels.includes('push') ? accountUsers : 0,
    channels,
  };
}

async function enqueueOfflineLeadEmails(
  subject: string,
  html: string,
): Promise<{ recipients: number; chunkJobs: number }> {
  const leads = await OfflineCustomer.find({}).select('email').lean<{ email: string }[]>();
  const emails = leads.map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return { recipients: 0, chunkJobs: 0 };

  const existing = await User.find({ email: { $in: emails } })
    .select('email')
    .lean<{ email: string }[]>();
  const existingSet = new Set(existing.map((u) => u.email.trim().toLowerCase()));
  const onlyLeads = emails.filter((e) => !existingSet.has(e));
  if (!onlyLeads.length) return { recipients: 0, chunkJobs: 0 };

  const chunkJobs = await enqueueBroadcastChunks(onlyLeads, subject, html);
  return { recipients: onlyLeads.length, chunkJobs };
}

async function enqueueNotificationsByUserFilter(
  userFilter: FilterQuery<unknown>,
  payload: {
    title: string;
    message: string;
    link?: string;
    sendInApp: boolean;
    sendPush: boolean;
  },
  batchSize = 400,
): Promise<number> {
  let total = 0;
  let lastId: Types.ObjectId | null = null;

  while (true) {
    const filter: FilterQuery<unknown> = {
      ...userFilter,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    };
    const users = await User.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();

    if (!users.length) break;

    if (payload.sendInApp) {
      const docs = users.map((u) => ({
        user: u._id,
        title: payload.title,
        message: payload.message,
        link: payload.link,
        type: 'promotion' as const,
      }));
      const created = await Notification.insertMany(docs, { ordered: false });

      await Promise.all(
        created.map((n) => onNotificationCreated(String(n.user)).catch(() => {})),
      );

      if (payload.sendPush) {
        for (const n of created) {
          void queuePushForUser(
            {
              userId: String(n.user),
              title: payload.title,
              body: payload.message,
              link: payload.link,
              notificationId: String(n._id),
            },
            { category: 'promotion' },
          );
        }
      }
    } else if (payload.sendPush) {
      for (const u of users) {
        void queuePushForUser(
          {
            userId: String(u._id),
            title: payload.title,
            body: payload.message,
            link: payload.link,
          },
          { category: 'promotion' },
        );
      }
    }

    total += users.length;
    lastId = users[users.length - 1]._id;
    if (users.length < batchSize) break;
  }

  return total;
}

export async function sendMarketingCampaign(
  input: MarketingCampaignInput,
): Promise<{
  emailsQueued: number;
  emailChunkJobs: number;
  offlineEmailsQueued: number;
  notificationsQueued: number;
  channels: MarketingChannel[];
}> {
  const channels =
    input.channels?.length ? input.channels : (['email'] as MarketingChannel[]);
  const safeCtaLink = normalizeMarketingCtaLink(input.ctaLink);
  const rawMessage = input.messageHtml.trim();
  const htmlBody =
    rawMessage.includes('<') ? rawMessage : rawMessage.replace(/\n/g, '<br/>');
  const tpl = emailTemplates.custom(
    input.subject.trim(),
    sanitizeMarketingEmailHtml(htmlBody),
    input.ctaText?.trim(),
    safeCtaLink,
  );

  const notificationTitle = input.subject.trim().slice(0, 120);
  const notificationBody = htmlToPlainText(tpl.html).slice(0, 500);

  let emailsQueued = 0;
  let emailChunkJobs = 0;
  let offlineEmailsQueued = 0;
  let notificationsQueued = 0;

  const wantsEmail = channels.includes('email');
  const wantsInApp = channels.includes('in_app');
  const wantsPush = channels.includes('push');

  if (wantsEmail) {
    if (input.audience === 'selected') {
      const ids = input.userIds || [];
      const selected = await User.find({ _id: { $in: ids }, isActive: true }).select('email');
      const emails = selected.map((r) => r.email).filter(Boolean);
      emailChunkJobs = await enqueueBroadcastChunks(emails, tpl.subject, tpl.html);
      emailsQueued = emails.length;
    } else {
      const filter = buildUserFilter(input.audience);
      emailsQueued = await enqueueBroadcastByUserFilter(
        filter,
        () => ({
          subject: tpl.subject,
          html: tpl.html,
          jobIdPrefix: `marketing:${input.subject.trim().slice(0, 32)}`,
        }),
        400,
      );
    }

    if (input.includeOfflineLeads && input.audience !== 'admins') {
      const offline = await enqueueOfflineLeadEmails(tpl.subject, tpl.html);
      offlineEmailsQueued = offline.recipients;
      emailChunkJobs += offline.chunkJobs;
    }
  }

  if (wantsInApp || wantsPush) {
    if (input.audience === 'selected') {
      const filter = buildUserFilter('selected', input.userIds);
      notificationsQueued = await enqueueNotificationsByUserFilter(filter, {
        title: notificationTitle,
        message: notificationBody,
        link: safeCtaLink,
        sendInApp: wantsInApp,
        sendPush: wantsPush,
      });
    } else {
      const filter = buildUserFilter(input.audience);
      notificationsQueued = await enqueueNotificationsByUserFilter(filter, {
        title: notificationTitle,
        message: notificationBody,
        link: safeCtaLink,
        sendInApp: wantsInApp,
        sendPush: wantsPush,
      });
    }
  }

  return {
    emailsQueued,
    emailChunkJobs,
    offlineEmailsQueued,
    notificationsQueued,
    channels,
  };
}

export function marketingDeliveryConfigured(): {
  resendConfigured: boolean;
  redisEnabled: boolean;
} {
  return {
    resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    redisEnabled: Boolean(process.env.REDIS_URL?.trim()),
  };
}
