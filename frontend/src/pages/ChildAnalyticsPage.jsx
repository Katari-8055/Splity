import React, { useState, useEffect } from 'react';
import { parentService } from '../services/api';

export default function ChildAnalyticsPage() {
  const [childrenList, setChildrenList] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const list = await parentService.getChildren();
        setChildrenList(list || []);
        if (list && list.length > 0) {
          setSelectedChildId(list[0].child_id);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!selectedChildId) return;
    async function loadAnalytics() {
      try {
        const res = await parentService.getChildAnalytics(selectedChildId);
        setAnalytics(res);
      } catch (err) {
        console.error(err);
      }
    }
    loadAnalytics();
  }, [selectedChildId]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Child Spending Analytics</h1>
        <p className="text-xs text-slate-400 mt-0.5">Category breakdown and transactions for monitored accounts</p>
      </div>

      {childrenList.length > 0 && (
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 flex items-center space-x-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Select Child</label>
          <select
            value={selectedChildId}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="bg-[#0e131d] border border-[#1e2638] text-slate-100 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            {childrenList.map((c) => (
              <option key={c.child_id} value={c.child_id}>{c.child_name}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading analytics data...</div>
      ) : !analytics ? (
        <div className="py-12 text-center text-xs text-slate-500">No analytics data available for this child.</div>
      ) : (
        <div className="space-y-4">
          {/* Total Spending Card */}
          <div className="p-5 bg-[#121722] border border-[#1e2638] rounded-xl shadow-sm">
            <span className="text-[11px] uppercase font-semibold tracking-wider text-slate-400 block">Total Spending</span>
            <span className="text-3xl font-bold text-slate-100 font-mono mt-1 block">
              ${parseFloat(analytics.totalSpending || 0).toFixed(2)}
            </span>
          </div>

          {/* Category Breakdown */}
          <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Category Breakdown</h2>
            <div className="space-y-2">
              {(analytics.categoryBreakdown || []).map((cat, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 bg-[#0e131d] border border-[#1e2638] rounded-lg hover:border-[#2a364f] transition-colors"
                >
                  <span className="text-xs font-medium text-slate-300">{cat.category}</span>
                  <span className="text-xs font-bold text-emerald-400 font-mono">
                    ${parseFloat(cat.total_amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
