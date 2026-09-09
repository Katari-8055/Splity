import React from 'react';
import { Link } from 'react-router-dom';

export default function RecentActivity({ transactions = [] }) {
  return (
    <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-100">Recent Transactions</h3>
        <Link to="/expenses" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
          View all →
        </Link>
      </div>

      {transactions.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs text-slate-500">No recent transactions recorded yet.</p>
          <Link
            to="/expenses/add"
            className="mt-2 inline-block text-xs font-semibold text-indigo-400 hover:text-indigo-300"
          >
            + Log your first expense
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-[#1e2638]">
          {transactions.slice(0, 5).map((t) => (
            <div key={t.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#1a2233] border border-[#263147] flex items-center justify-center text-xs font-bold text-slate-300">
                  {(t.category || 'O').charAt(0)}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">{t.description || t.category}</p>
                  <p className="text-[11px] text-slate-500">
                    {t.paid_by_name || 'You'} • {new Date(t.created_at || Date.now()).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-slate-100">${parseFloat(t.amount || 0).toFixed(2)}</p>
                <span className="text-[10px] text-slate-400 font-medium">{t.category}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
