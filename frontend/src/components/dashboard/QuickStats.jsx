import React from 'react';

export default function QuickStats({ balanceData, totalSpent = 0, groupCount = 0 }) {
  const { totalYouOwe = 0, totalYouAreOwed = 0, netBalance = 0 } = balanceData || {};

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Net Balance */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 transition hover:border-[#2e3b56]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Net Balance</span>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              netBalance >= 0
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {netBalance >= 0 ? '+Credit' : '-Owed'}
          </span>
        </div>
        <div className="mt-2 flex items-baseline space-x-1">
          <span className={`text-2xl font-bold tracking-tight ${netBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${Math.abs(netBalance).toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Overall balance with all friends</p>
      </div>

      {/* 2. Total You Are Owed */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 transition hover:border-[#2e3b56]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">You Are Owed</span>
          <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-xs">
            ↓
          </div>
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold text-slate-100 tracking-tight">
            ${totalYouAreOwed.toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Money to be received</p>
      </div>

      {/* 3. Total You Owe */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 transition hover:border-[#2e3b56]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">You Owe</span>
          <div className="w-6 h-6 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 text-xs">
            ↑
          </div>
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold text-slate-100 tracking-tight">
            ${totalYouOwe.toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Debts to settle</p>
      </div>

      {/* 4. Total Monthly Spend */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 transition hover:border-[#2e3b56]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Total Spent</span>
          <div className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 text-xs">
            💳
          </div>
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold text-slate-100 tracking-tight">
            ${totalSpent.toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">{groupCount} active group(s)</p>
      </div>
    </div>
  );
}
