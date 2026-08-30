import { Router } from 'express';
import { getNotifications, ackNotification, createNotification } from '../controllers/notification.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', optionalAuth, getNotifications);
router.post('/ack', optionalAuth, ackNotification);
router.post('/', optionalAuth, createNotification);

export default router;
