import { connectToPostgres } from '../config/db.js';
import { sendActualEmail } from './emailService.js';
import { safetyDetectionChain } from '../ai/langchainConfig.js';

export async function pushNotification(userId, message, type = 'general', data = {}) {
  const db = await connectToPostgres();
  const query = `
    INSERT INTO notifications (user_id, message, type, data, is_read, created_at)
    VALUES ($1, $2, $3, $4, false, NOW()) RETURNING *`;
  const result = await db.query(query, [userId, message, type, JSON.stringify(data)]);
  return result.rows[0];
}

export async function listNotifications(userId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function acknowledgeNotification(notificationId, userId = null) {
  const db = await connectToPostgres();
  if (userId) {
    const result = await db.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *`,
      [notificationId, userId]
    );
    return result.rows[0] || null;
  }
  const result = await db.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 RETURNING *`,
    [notificationId]
  );
  return result.rows[0];
}

export async function checkNotificationSent(relationshipId, alertType) {
  const db = await connectToPostgres();
  const query = `SELECT * FROM notification_logs WHERE relationship_id = $1 AND alert_type = $2 ORDER BY sent_at DESC LIMIT 1`;
  const result = await db.query(query, [relationshipId, alertType]);
  return result.rows.length > 0;
}

export async function logNotification(relationshipId, type, alertType, message) {
  const db = await connectToPostgres();
  const query = `INSERT INTO notification_logs (relationship_id, type, alert_type, message) VALUES ($1, $2, $3, $4) RETURNING *`;
  const result = await db.query(query, [relationshipId, type, alertType, message]);
  return result.rows[0];
}

export async function checkBillForUnsafeItems(
  billItems,
  relationshipId,
  childName,
  parentEmail,
  parentPhone
) {
  try {
    const itemsList = billItems.map(item => `- ${item.item_name} ($${item.price})`).join('\n');
    
    // Execute LangChain Safety Detection Chain
    const result = await safetyDetectionChain.invoke({ itemsList });

    if (result && result.isUnsafe && result.unsafeItems.length > 0) {
      const message = `🚨 SAFETY ALERT: ${childName} purchased potentially unsafe items: ${result.unsafeItems.join(', ')}. Details: ${result.reasoning || 'Hazard detected'}`;

      await sendEmailNotification(
        parentEmail,
        '🚨 URGENT: Child Safety Alert - Unsafe Purchase Detected',
        message,
        'safety_alert',
        childName,
        { unsafeItems: result.unsafeItems, relationshipId }
      );

      await logNotification(relationshipId, 'safety_alert', 'unsafe_item', message);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error checking bill for unsafe items with LangChain:', error);
    return false;
  }
}

export async function sendEmailNotification(
  recipientEmail, 
  subject, 
  message,
  notificationType = 'safety_alert',
  childName,
  additionalData
) {
  try {
    const htmlTemplate = generateEmailTemplate(message, notificationType, childName, additionalData);
    return await sendActualEmail(recipientEmail, subject, message, htmlTemplate);
  } catch (error) {
    console.error('Error sending email notification:', error);
    return false;
  }
}

function generateEmailTemplate(message, type, childName, additionalData) {
  const isUrgent = type === 'safety_alert';
  const primaryColor = isUrgent ? '#dc2626' : '#f59e0b';
  const backgroundColor = isUrgent ? '#fef2f2' : '#fffbeb';
  const iconEmoji = isUrgent ? '🚨' : '💸';
  const alertTitle = isUrgent ? 'URGENT SAFETY ALERT' : 'SPENDING NOTIFICATION';
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${alertTitle}</title>
    </head>
    <body style="font-family: sans-serif; background-color: #f9fafb; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: ${primaryColor}; color: white; padding: 16px; text-align: center; border-radius: 8px;">
          <h2>${iconEmoji} ${alertTitle}</h2>
          ${childName ? `<p>Child: ${childName}</p>` : ''}
        </div>
        <div style="margin-top: 20px; background-color: ${backgroundColor}; padding: 16px; border-radius: 8px;">
          <p style="font-size: 16px; color: #374151;">${message}</p>
        </div>
        <div style="margin-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
          spendsavvy - Sent at ${new Date().toLocaleString()}
        </div>
      </div>
    </body>
    </html>
  `;
}
