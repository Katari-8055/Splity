import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { expenseService } from '../services/api';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExpenses();
  }, [categoryFilter]);

  async function loadExpenses() {
    try {
      const data = await expenseService.getHistory({ category: categoryFilter });
      setExpenses(data);
    } catch (err) {
      console.error('Failed to load expenses:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Expense History</h1>
          <p className="text-gray-400 text-sm mt-1">Track and manage all your logged expenses</p>
        </div>
        <Link
          to="/expenses/add"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm transition"
        >
          Add New Expense
        </Link>
      </div>

      {/* Filter bar */}
      <div className="flex items-center space-x-4 bg-gray-800 border border-gray-700 rounded-xl p-4">
        <label className="text-xs text-gray-400 font-medium">Filter by Category:</label>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none"
        >
          <option value="">All Categories</option>
          <option value="Food">Food</option>
          <option value="Transport">Transport</option>
          <option value="Shopping">Shopping</option>
          <option value="Bills">Bills</option>
          <option value="Entertainment">Entertainment</option>
          <option value="Other">Other</option>
        </select>
      </div>

      {/* Expense Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-6 text-gray-400 text-sm">Loading expenses...</p>
        ) : expenses.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No expenses found matching the filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="bg-gray-900 text-xs uppercase text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="px-6 py-3">Description / Category</th>
                  <th className="px-6 py-3">Category</th>
                  <th className="px-6 py-3">Paid By</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-750">
                    <td className="px-6 py-4 font-medium text-white">{e.description || e.category}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {e.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">{e.paid_by_name || 'You'}</td>
                    <td className="px-6 py-4 font-bold text-white">${parseFloat(e.amount).toFixed(2)}</td>
                    <td className="px-6 py-4 text-xs text-gray-400">
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
