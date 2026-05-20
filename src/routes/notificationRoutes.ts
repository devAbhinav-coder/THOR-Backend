import express from 'express';
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
  subscribeExpoPush,
  unsubscribeExpoPush,
  sendTestPushToSelf,
  getNotificationPreferencesHandler,
  updateNotificationPreferencesHandler,
} from '../controllers/notificationController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import {
  getNotificationsSchema,
  markNotificationReadSchema,
  subscribePushSchema,
  unsubscribePushSchema,
  subscribeExpoPushSchema,
  unsubscribeExpoPushSchema,
  updateNotificationPreferencesSchema,
} from '../validation/notificationSchemas';

const router = express.Router();

const subscribeLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 20,
  prefix: 'rl:notif:subscribe:',
  message: 'Too many push subscription requests. Please try again later.',
});

const testPushLimiter = createAdaptiveLimiter({
  windowMs: 5 * 60_000,
  max: 5,
  prefix: 'rl:notif:test-push:',
  message: 'Too many test push requests. Please try again later.',
});

router.use(protect);

router.get('/', validate(getNotificationsSchema), getMyNotifications);
router.get('/preferences', getNotificationPreferencesHandler);
router.patch('/preferences', validate(updateNotificationPreferencesSchema), updateNotificationPreferencesHandler);
router.patch('/mark-all-read', markAllAsRead);
router.delete('/clear-all', clearAll);
router.get('/push/public-key', getPushPublicKey);
router.post('/push/subscribe', subscribeLimiter, validate(subscribePushSchema), subscribePush);
router.post('/push/unsubscribe', subscribeLimiter, validate(unsubscribePushSchema), unsubscribePush);
router.post('/push/expo', subscribeLimiter, validate(subscribeExpoPushSchema), subscribeExpoPush);
router.delete('/push/expo', subscribeLimiter, validate(unsubscribeExpoPushSchema), unsubscribeExpoPush);
router.post('/push/test-self', testPushLimiter, sendTestPushToSelf);
router.patch('/:id/read', validate(markNotificationReadSchema), markAsRead);

export default router;
