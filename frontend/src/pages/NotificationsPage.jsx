import React, { useState, useEffect } from 'react';
import { notificationService } from '../services/api';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
  }, []);

  async function loadNotifications() {
    try {
      const data = await notificationService.getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAck(id) {
    try {
      await notificationService.acknowledge(id);
      loadNotifications();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Notifications</h1>
        <p className="text-gray-400 text-sm mt-1">Activity alerts and expense split notifications</p>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
        {loading ? (
          <p className="text-gray-400 text-sm">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <p className="text-gray-400 text-sm">No notifications found.</p>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 rounded-lg border flex items-center justify-between transition ${
                  n.is_read ? 'bg-gray-800/40 border-gray-700/50' : 'bg-blue-950/30 border-blue-500/50'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-white">{n.message}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(n.created_at || Date.now()).toLocaleString()}</p>
                </div>
                {!n.is_read && (
                  <button
                    onClick={() => handleAck(n.id)}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
                  >
                    Mark as read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
