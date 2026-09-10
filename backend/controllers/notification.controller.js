import { listNotifications, acknowledgeNotification, pushNotification } from '../services/notificationService.js';

export async function getNotifications(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const notifications = await listNotifications(userId);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
}

export async function ackNotification(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { notificationId } = req.body;
    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID required' });
    }

    const updated = await acknowledgeNotification(notificationId, userId);
    if (!updated) {
      return res.status(404).json({ error: 'Notification not found or access denied' });
    }
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function createNotification(req, res, next) {
  try {
    const fromUserId = req.user?.userId;
    if (!fromUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { userId, message, type, data } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: 'Recipient userId and message are required' });
    }
    const notif = await pushNotification(userId, message, type, { ...data, fromUserId });
    res.status(201).json(notif);
  } catch (error) {
    next(error);
  }
}
