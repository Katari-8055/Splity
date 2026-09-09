import React, { useState, useEffect } from 'react';
import { parentService } from '../services/api';

export default function ParentNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await parentService.getNotifications();
        setNotifications(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Parent Safety & Threshold Alerts</h1>
        <p className="text-xs text-slate-400 mt-0.5">Real-time alerts for threshold breaches and child spending</p>
      </div>

      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Loading safety alerts...</div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">No alerts or safety threshold warnings.</div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-lg">
                <p className="text-xs font-semibold text-rose-300">{n.message}</p>
                <p className="text-[10px] text-slate-500 mt-1">{new Date(n.created_at || Date.now()).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
