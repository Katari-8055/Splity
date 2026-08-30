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
        setChildrenList(list);
        if (list.length > 0) {
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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Child Spending Analytics</h1>
        <p className="text-gray-400 text-sm mt-1">Review category breakdown & transactions for monitored children</p>
      </div>

      {childrenList.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center space-x-3">
          <label className="text-xs font-medium text-gray-300">Select Child:</label>
          <select
            value={selectedChildId}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="bg-gray-900 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5"
          >
            {childrenList.map((c) => (
              <option key={c.child_id} value={c.child_id}>{c.child_name}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading analytics...</p>
      ) : !analytics ? (
        <p className="text-gray-400 text-sm">No child analytics available.</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-md font-semibold text-white">Total Child Spending</h2>
            <p className="text-3xl font-bold text-purple-400 mt-2">${analytics.totalSpending.toFixed(2)}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-md font-semibold text-white mb-4">Category Breakdown</h2>
            <div className="space-y-3">
              {(analytics.categoryBreakdown || []).map((cat, idx) => (
                <div key={idx} className="flex justify-between text-sm text-gray-300 p-2 bg-gray-700/40 rounded">
                  <span>{cat.category}</span>
                  <span className="font-bold">${parseFloat(cat.total_amount).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
