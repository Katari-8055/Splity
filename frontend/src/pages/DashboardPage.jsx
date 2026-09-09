import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QuickStats from '../components/dashboard/QuickStats';
import RecentActivity from '../components/dashboard/RecentActivity';
import { analyticsService, expenseService } from '../services/api';

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState({ totalSpent: 0, groupCount: 0, recentExpenses: [] });
  const [balanceData, setBalanceData] = useState({ totalYouOwe: 0, totalYouAreOwed: 0, netBalance: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [dashRes, balRes] = await Promise.allSettled([
          analyticsService.getDashboard(),
          expenseService.getBalances()
        ]);

        if (dashRes.status === 'fulfilled' && dashRes.value) {
          setDashboardData(dashRes.value);
        }

        if (balRes.status === 'fulfilled' && balRes.value) {
          setBalanceData(balRes.value);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Overview</h1>
          <p className="text-xs text-slate-400 mt-0.5">Real-time balances, spending stats, and group activity</p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            to="/chat"
            className="px-3.5 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition"
          >
            ⚡ AI Assistant
          </Link>
          <Link
            to="/expenses/add"
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
          >
            + New Expense
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <QuickStats
        balanceData={balanceData}
        totalSpent={dashboardData.totalSpent}
        groupCount={dashboardData.groupCount}
      />

      {/* Main Grid: Activity + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentActivity transactions={dashboardData.recentExpenses || []} />
        </div>

        {/* Quick Operations Panel */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-100">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              to="/chat"
              className="flex items-center justify-between p-3 bg-[#182030] hover:bg-[#1e293d] border border-[#222d42] rounded-lg transition"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-sm">🤖</span>
                <span className="text-xs font-semibold text-slate-200">AI Assistant Split</span>
              </div>
              <span className="text-slate-400 text-xs">→</span>
            </Link>

            <Link
              to="/expenses"
              className="flex items-center justify-between p-3 bg-[#182030] hover:bg-[#1e293d] border border-[#222d42] rounded-lg transition"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-sm">🧾</span>
                <span className="text-xs font-semibold text-slate-200">Expense History</span>
              </div>
              <span className="text-slate-400 text-xs">→</span>
            </Link>

            <Link
              to="/groups"
              className="flex items-center justify-between p-3 bg-[#182030] hover:bg-[#1e293d] border border-[#222d42] rounded-lg transition"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-sm">🏔️</span>
                <span className="text-xs font-semibold text-slate-200">Trip & Flat Groups</span>
              </div>
              <span className="text-slate-400 text-xs">→</span>
            </Link>

            <Link
              to="/friends"
              className="flex items-center justify-between p-3 bg-[#182030] hover:bg-[#1e293d] border border-[#222d42] rounded-lg transition"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-sm">👥</span>
                <span className="text-xs font-semibold text-slate-200">Friends & Settle Up</span>
              </div>
              <span className="text-slate-400 text-xs">→</span>
            </Link>

            <Link
              to="/bills"
              className="flex items-center justify-between p-3 bg-[#182030] hover:bg-[#1e293d] border border-[#222d42] rounded-lg transition"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-sm">📷</span>
                <span className="text-xs font-semibold text-slate-200">Scan Bill / Receipt</span>
              </div>
              <span className="text-slate-400 text-xs">→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
