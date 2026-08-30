import React, { useState, useEffect } from 'react';
import { analyticsService } from '../services/api';

export default function InsightsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAnalytics() {
      try {
        const date = new Date();
        const res = await analyticsService.getAnalytics(date.getMonth() + 1, date.getFullYear());
        setData(res);
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadAnalytics();
  }, []);

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading insights...</div>;
  }

  const categorySpend = data?.categorySpend || [];
  const monthlySummary = data?.monthlySummary || [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Financial Insights</h1>
        <p className="text-gray-400 text-sm mt-1">Detailed spending breakdown & historical analytics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Category breakdown */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-white mb-4">Category Breakdown (This Month)</h2>
          {categorySpend.length === 0 ? (
            <p className="text-gray-400 text-sm">No expenses logged for this month yet.</p>
          ) : (
            <div className="space-y-3">
              {categorySpend.map((cat, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-sm text-gray-300">
                    <span>{cat.category}</span>
                    <span className="font-bold">${parseFloat(cat.total).toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full"
                      style={{ width: `${Math.min(100, (parseFloat(cat.total) / 500) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Monthly Summary */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-white mb-4">Monthly Trends</h2>
          {monthlySummary.length === 0 ? (
            <p className="text-gray-400 text-sm">No monthly historical data yet.</p>
          ) : (
            <div className="space-y-3">
              {monthlySummary.map((m, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 bg-gray-700/50 rounded-lg">
                  <span className="text-sm font-medium text-gray-300">
                    {new Date(m.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </span>
                  <span className="text-sm font-bold text-green-400">${parseFloat(m.total).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
