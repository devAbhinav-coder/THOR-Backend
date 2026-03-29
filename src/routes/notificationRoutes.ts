import express from 'express';
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
} from '../controllers/notificationController';
import { protect } from '../middleware/auth';

const router = express.Router();

router.use(protect); // All notification routes require authentication

router.get('/', getMyNotifications);
router.patch('/mark-all-read', markAllAsRead);
router.delete('/clear-all', clearAll);
router.patch('/:id/read', markAsRead);

export default router;
