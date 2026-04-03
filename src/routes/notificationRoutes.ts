import express from 'express';
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
  sendTestPushToSelf,
} from '../controllers/notificationController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect); // All notification routes require authentication

router.get('/', getMyNotifications);
router.patch('/mark-all-read', markAllAsRead);
router.delete('/clear-all', clearAll);
router.get('/push/public-key', getPushPublicKey);
router.post('/push/subscribe', subscribePush);
router.post('/push/unsubscribe', unsubscribePush);
router.post('/push/test-self', sendTestPushToSelf);
router.patch('/:id/read', markAsRead);

export default router;
