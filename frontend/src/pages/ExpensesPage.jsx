import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { expenseService } from '../services/api';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExpenses();
  }, [categoryFilter]);

  async function loadExpenses() {
    setLoading(true);
    try {
      const data = await expenseService.getHistory({ category: categoryFilter });
      setExpenses(data || []);
    } catch (err) {
      console.error('Failed to load expenses:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredExpenses = expenses.filter((e) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (e.description && e.description.toLowerCase().includes(q)) ||
      (e.category && e.category.toLowerCase().includes(q)) ||
      (e.paid_by_name && e.paid_by_name.toLowerCase().includes(q))
    );
  });

  const totalFilteredAmount = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

  const categories = ['All Categories', 'Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'];

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Expense History</h1>
          <p className="text-xs text-slate-400 mt-0.5">Track, search, and manage all your logged and split transactions</p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            to="/expenses/add"
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs transition shadow-md shadow-indigo-600/20"
          >
            + Add Expense
          </Link>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-3.5">
          <span className="text-[11px] font-medium text-slate-400">Total Spent in View</span>
          <p className="text-lg font-bold text-slate-100 mt-1">${totalFilteredAmount.toFixed(2)}</p>
        </div>
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-3.5">
          <span className="text-[11px] font-medium text-slate-400">Transactions Count</span>
          <p className="text-lg font-bold text-slate-100 mt-1">{filteredExpenses.length} Records</p>
        </div>
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-3.5">
          <span className="text-[11px] font-medium text-slate-400">Active Category</span>
          <p className="text-lg font-bold text-indigo-400 mt-1">{categoryFilter || 'All Categories'}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-3.5 flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search description, payer..."
            className="w-full bg-[#182030] border border-[#222d42] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Category Pills */}
        <div className="flex gap-1.5 overflow-x-auto w-full sm:w-auto scrollbar-none">
          {categories.map((cat) => {
            const val = cat === 'All Categories' ? '' : cat;
            const isSelected = categoryFilter === val;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-[#182030] text-slate-400 hover:text-slate-200 hover:bg-[#202a40]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Expense Table */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">
            <span className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2 align-middle"></span>
            Loading transactions...
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-xs text-slate-400">No expenses found matching your filter.</p>
            <Link
              to="/expenses/add"
              className="mt-2 inline-block text-xs font-semibold text-indigo-400 hover:text-indigo-300"
            >
              + Create a new expense
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0e131d] text-[11px] uppercase tracking-wider text-slate-400 border-b border-[#1e2638]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Description</th>
                  <th className="px-5 py-3 font-semibold">Category</th>
                  <th className="px-5 py-3 font-semibold">Paid By</th>
                  <th className="px-5 py-3 font-semibold">Splits</th>
                  <th className="px-5 py-3 font-semibold text-right">Amount</th>
                  <th className="px-5 py-3 font-semibold text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2638]/70">
                {filteredExpenses.map((e) => (
                  <tr key={e.id} className="hover:bg-[#161c2a] transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-slate-100">
                      {e.description || e.category}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                        {e.category}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 font-medium">
                      {e.paid_by_name || 'You'}
                    </td>
                    <td className="px-5 py-3.5">
                      {e.splits && e.splits.length > 0 ? (
                        <div className="flex items-center space-x-1">
                          <span className="text-[11px] text-slate-400 bg-[#1a2233] px-2 py-0.5 rounded border border-[#242f46]">
                            Split ({e.splits.length})
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">Personal</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold text-slate-100">
                      ${parseFloat(e.amount).toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-400">
                      {new Date(e.created_at || Date.now()).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
