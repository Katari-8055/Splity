import React, { useState, useEffect } from 'react';
import { parentService } from '../services/api';

export default function ParentNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await parentService.getNotifications();
        setNotifications(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Parent Safety & Threshold Alerts</h1>
        <p className="text-gray-400 text-sm mt-1">Real-time alerts for threshold breaches & item safety</p>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
        {loading ? (
          <p className="text-gray-400 text-sm">Loading alerts...</p>
        ) : notifications.length === 0 ? (
          <p className="text-gray-400 text-sm">No safety alerts present.</p>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div key={n.id} className="p-4 bg-red-950/20 border border-red-500/40 rounded-lg">
                <p className="text-sm font-semibold text-red-300">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at || Date.now()).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
