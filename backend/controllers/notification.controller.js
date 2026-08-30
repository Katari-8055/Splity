import { listNotifications, acknowledgeNotification, pushNotification } from '../services/notificationService.js';

export async function getNotifications(req, res, next) {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    const notifications = await listNotifications(userId);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
}

export async function ackNotification(req, res, next) {
  try {
    const { notificationId } = req.body;
    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID required' });
    }
    const updated = await acknowledgeNotification(notificationId);
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function createNotification(req, res, next) {
  try {
    const { userId, message, type, data } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: 'User ID and message required' });
    }
    const notif = await pushNotification(userId, message, type, data);
    res.status(201).json(notif);
  } catch (error) {
    next(error);
  }
}
