import React, { useEffect, useState } from 'react';
import QuickStats from '../components/dashboard/QuickStats';
import RecentActivity from '../components/dashboard/RecentActivity';
import { analyticsService, expenseService } from '../services/api';

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState({ totalSpent: 0, recentExpenses: [] });
  const [balanceData, setBalanceData] = useState({ youOwe: 0, owedToYou: 0, netBalance: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await analyticsService.getDashboard();
        setDashboardData(data);

        // Fetch user balances
        const history = await expenseService.getHistory();
        const youOwe = 0;
        const owedToYou = 0;
        setBalanceData({ youOwe, owedToYou, netBalance: owedToYou - youOwe });
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Overview of your spending & group balances</p>
      </div>

      <QuickStats balanceData={balanceData} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentActivity transactions={dashboardData.recentExpenses || []} />

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-4">
            <a
              href="/chat"
              className="p-4 bg-blue-600/20 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition text-center"
            >
              <span className="text-xl block mb-1">🤖</span>
              <span className="text-sm font-medium text-blue-300">AI Split Assistant</span>
            </a>
            <a
              href="/expenses"
              className="p-4 bg-purple-600/20 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition text-center"
            >
              <span className="text-xl block mb-1">➕</span>
              <span className="text-sm font-medium text-purple-300">Add Expense</span>
            </a>
            <a
              href="/friends"
              className="p-4 bg-green-600/20 border border-green-500/30 rounded-lg hover:bg-green-600/30 transition text-center"
            >
              <span className="text-xl block mb-1">👥</span>
              <span className="text-sm font-medium text-green-300">Manage Friends</span>
            </a>
            <a
              href="/bills"
              className="p-4 bg-orange-600/20 border border-orange-500/30 rounded-lg hover:bg-orange-600/30 transition text-center"
            >
              <span className="text-xl block mb-1">📄</span>
              <span className="text-sm font-medium text-orange-300">Upload Receipt</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
