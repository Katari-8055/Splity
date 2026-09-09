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
      setNotifications(data || []);
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
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Notifications & Alerts</h1>
        <p className="text-xs text-slate-400 mt-0.5">Real-time alerts for expense splits and debt settlements</p>
      </div>

      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">All caught up! No unread notifications.</div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 rounded-lg border flex items-center justify-between transition-colors ${
                  n.is_read
                    ? 'bg-[#0e131d]/50 border-[#1e2638] text-slate-400'
                    : 'bg-indigo-600/10 border-indigo-500/30 text-slate-200'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-2 h-2 rounded-full ${n.is_read ? 'bg-slate-600' : 'bg-indigo-400'}`} />
                  <div>
                    <p className="text-xs font-medium text-slate-200">{n.message}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{new Date(n.created_at || Date.now()).toLocaleString()}</p>
                  </div>
                </div>
                {!n.is_read && (
                  <button
                    onClick={() => handleAck(n.id)}
                    className="px-2.5 py-1 bg-[#182030] hover:bg-[#202b40] text-slate-300 border border-[#2a364f] rounded text-[11px] font-medium transition-colors"
                  >
                    Mark read
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
