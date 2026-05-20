import { z } from 'zod';
import { isExpoPushToken } from '../utils/isExpoPushToken';

const MAX_TITLE = 200;
const MAX_BODY = 2000;
const MAX_LINK = 2048;
const MAX_ENDPOINT = 2048;
const MAX_KEY = 512;

const trimmedString = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max);

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  isRead: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

const pushSubscriptionBodySchema = z.object({
  subscription: z.object({
    endpoint: trimmedString(MAX_ENDPOINT).url('Invalid push subscription endpoint.'),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: trimmedString(MAX_KEY),
      auth: trimmedString(MAX_KEY),
    }),
  }),
});

const endpointBodySchema = z.object({
  endpoint: trimmedString(MAX_ENDPOINT),
});

const expoTokenBodySchema = z.object({
  expoPushToken: z.string().trim().optional(),
  token: z.string().trim().optional(),
  platform: z.enum(['ios', 'android', 'unknown']).optional(),
  deviceType: z.string().trim().max(64).optional(),
  appVersion: z.string().trim().max(32).optional(),
}).superRefine((data, ctx) => {
  const raw = (data.expoPushToken ?? data.token ?? '').trim();
  if (!raw) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expo push token is required.', path: ['expoPushToken'] });
    return;
  }
  if (!isExpoPushToken(raw)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Expo push token.', path: ['expoPushToken'] });
  }
});

const preferencesBodySchema = z.object({
  pushOptIn: z.boolean().optional(),
  mutedCategories: z.array(z.enum(['order', 'promotion', 'system', 'alert', 'info', 'success', 'error'])).max(20).optional(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const getNotificationsSchema = z.object({
  query: paginationQuerySchema,
});

export const markNotificationReadSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid notification id.'),
  }),
});

export const subscribePushSchema = z.object({
  body: pushSubscriptionBodySchema,
});

export const unsubscribePushSchema = z.object({
  body: endpointBodySchema,
});

export const subscribeExpoPushSchema = z.object({
  body: expoTokenBodySchema,
});

export const unsubscribeExpoPushSchema = z.object({
  body: expoTokenBodySchema,
});

export const updateNotificationPreferencesSchema = z.object({
  body: preferencesBodySchema,
});

export type NotificationPaginationQuery = z.infer<typeof paginationQuerySchema>;
export type ParsedPushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;
export type ParsedExpoTokenBody = z.infer<typeof expoTokenBodySchema>;
