import React, { useState, useEffect } from 'react';
import { parentService } from '../services/api';

export default function ChildMonitoringPage() {
  const [childrenList, setChildrenList] = useState([]);
  const [childEmail, setChildEmail] = useState('');
  const [childPhone, setChildPhone] = useState('');
  const [thresholdAmount, setThresholdAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadChildren();
  }, []);

  async function loadChildren() {
    try {
      const data = await parentService.getChildren();
      setChildrenList(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddChild(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsAdding(true);
    try {
      await parentService.addChild({
        childEmail,
        childPhone,
        thresholdAmount: parseFloat(thresholdAmount || 0)
      });
      setSuccess('Child account linked to safety monitoring.');
      setChildEmail('');
      setChildPhone('');
      setThresholdAmount('');
      loadChildren();
    } catch (err) {
      setError(err.message || 'Failed to add child account');
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Child Safety & Monitoring</h1>
        <p className="text-xs text-slate-400 mt-0.5">Set spending thresholds and monitor child accounts</p>
      </div>

      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs flex items-center space-x-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Add Child Form */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Link Child Account</h2>
        <form onSubmit={handleAddChild} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Child Email</label>
            <input
              type="email"
              required
              value={childEmail}
              onChange={(e) => setChildEmail(e.target.value)}
              placeholder="child@example.com"
              className="w-full px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Child Phone</label>
            <input
              type="tel"
              required
              value={childPhone}
              onChange={(e) => setChildPhone(e.target.value)}
              placeholder="+1234567890"
              className="w-full px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Monthly Limit ($)</label>
            <input
              type="number"
              value={thresholdAmount}
              onChange={(e) => setThresholdAmount(e.target.value)}
              placeholder="500"
              className="w-full px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="md:col-span-3 flex justify-end pt-1">
            <button
              type="submit"
              disabled={isAdding}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {isAdding ? 'Linking...' : 'Link Child Account'}
            </button>
          </div>
        </form>
      </div>

      {/* Children List */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Monitored Children</h2>
          <span className="text-[11px] text-slate-500">{childrenList.length} account{childrenList.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Loading child accounts...</div>
        ) : childrenList.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">No child accounts linked yet. Use the form above to get started.</div>
        ) : (
          <div className="space-y-2">
            {childrenList.map((c) => (
              <div
                key={c.relationship_id}
                className="p-3.5 bg-[#0e131d] border border-[#1e2638] rounded-lg flex items-center justify-between hover:border-[#2a364f] transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-400">
                    {(c.child_name || 'C').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-200">{c.child_name}</h3>
                    <p className="text-[10px] text-slate-500">{c.child_email} • {c.child_phone}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 block">Monthly limit</span>
                  <span className="text-xs font-bold text-emerald-400 font-mono">${c.threshold_amount}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
