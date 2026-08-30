import React from 'react';
import { motion } from 'framer-motion';

export default function RecentActivity({ transactions = [] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm"
    >
      <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
      {transactions.length === 0 ? (
        <p className="text-gray-400 text-sm">No recent transactions.</p>
      ) : (
        <div className="space-y-4">
          {transactions.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-white">{t.description || t.category}</p>
                <p className="text-xs text-gray-400">{new Date(t.created_at || Date.now()).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-white">${parseFloat(t.amount || 0).toFixed(2)}</p>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                  {t.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
