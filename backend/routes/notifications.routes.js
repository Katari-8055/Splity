import { Router } from 'express';
import { getNotifications, ackNotification, createNotification } from '../controllers/notification.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, getNotifications);
router.post('/ack', authenticateToken, ackNotification);
router.post('/', authenticateToken, createNotification);

export default router;
