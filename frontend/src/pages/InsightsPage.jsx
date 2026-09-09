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
    return (
      <div className="flex items-center justify-center py-20 text-xs text-slate-500">
        Analyzing financial trends...
      </div>
    );
  }

  const categorySpend = data?.categorySpend || [];
  const monthlySummary = data?.monthlySummary || [];

  const totalSpent = categorySpend.reduce((sum, c) => sum + parseFloat(c.total || 0), 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Spending Analytics & Trends</h1>
        <p className="text-xs text-slate-400 mt-0.5">Categorized breakdown and historical distribution</p>
      </div>

      {/* Top summary metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-[#121722] border border-[#1e2638] rounded-xl shadow-sm">
          <span className="text-[11px] uppercase font-semibold tracking-wider text-slate-400 block">Total Spent (This Month)</span>
          <span className="text-xl font-bold text-slate-100 font-mono mt-1 block">${totalSpent.toFixed(2)}</span>
          <span className="text-[10px] text-emerald-400 mt-1 block">Live aggregated</span>
        </div>
        <div className="p-4 bg-[#121722] border border-[#1e2638] rounded-xl shadow-sm">
          <span className="text-[11px] uppercase font-semibold tracking-wider text-slate-400 block">Active Categories</span>
          <span className="text-xl font-bold text-slate-100 font-mono mt-1 block">{categorySpend.length}</span>
          <span className="text-[10px] text-slate-500 mt-1 block">Distinct expense types</span>
        </div>
        <div className="p-4 bg-[#121722] border border-[#1e2638] rounded-xl shadow-sm">
          <span className="text-[11px] uppercase font-semibold tracking-wider text-slate-400 block">Logged Periods</span>
          <span className="text-xl font-bold text-slate-100 font-mono mt-1 block">{monthlySummary.length} months</span>
          <span className="text-[10px] text-indigo-400 mt-1 block">Historical tracking</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Category Breakdown</h2>

          {categorySpend.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No expenses recorded for this period.</p>
          ) : (
            <div className="space-y-3.5">
              {categorySpend.map((cat, idx) => {
                const amount = parseFloat(cat.total || 0);
                const percent = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">{cat.category}</span>
                      <span className="text-slate-100 font-mono font-semibold">${amount.toFixed(2)} ({percent.toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-[#0e131d] h-2 rounded-full overflow-hidden border border-[#1e2638]">
                      <div
                        className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Monthly Summary */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Monthly Spending History</h2>

          {monthlySummary.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No monthly historical data yet.</p>
          ) : (
            <div className="space-y-2">
              {monthlySummary.map((m, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 bg-[#0e131d] border border-[#1e2638] rounded-lg hover:border-[#2a364f] transition-colors"
                >
                  <span className="text-xs font-medium text-slate-300">
                    {new Date(m.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </span>
                  <span className="text-xs font-bold text-emerald-400 font-mono">${parseFloat(m.total).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
