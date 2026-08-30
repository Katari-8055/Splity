import React, { useState, useEffect } from 'react';
import { parentService } from '../services/api';

export default function ChildMonitoringPage() {
  const [childrenList, setChildrenList] = useState([]);
  const [childEmail, setChildEmail] = useState('');
  const [childPhone, setChildPhone] = useState('');
  const [thresholdAmount, setThresholdAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadChildren();
  }, []);

  async function loadChildren() {
    try {
      const data = await parentService.getChildren();
      setChildrenList(data);
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
    try {
      await parentService.addChild({
        childEmail,
        childPhone,
        thresholdAmount: parseFloat(thresholdAmount || 0)
      });
      setSuccess('Child added to safety monitoring successfully!');
      setChildEmail('');
      setChildPhone('');
      setThresholdAmount('');
      loadChildren();
    } catch (err) {
      setError(err.message || 'Failed to add child');
    }
  }

  async function handleUpdateThreshold(relationshipId, newThreshold) {
    try {
      await parentService.updateThreshold(relationshipId, parseFloat(newThreshold));
      loadChildren();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Child Safety & Spending Monitoring</h1>
        <p className="text-gray-400 text-sm mt-1">Set monthly thresholds and safety controls for child accounts</p>
      </div>

      {success && <div className="p-3 bg-green-500/20 text-green-300 text-sm rounded-lg border border-green-500/50">{success}</div>}
      {error && <div className="p-3 bg-red-500/20 text-red-300 text-sm rounded-lg border border-red-500/50">{error}</div>}

      {/* Add Child Form */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-3">Add Child Account</h2>
        <form onSubmit={handleAddChild} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-300 mb-1">Child Email</label>
            <input
              type="email"
              required
              value={childEmail}
              onChange={(e) => setChildEmail(e.target.value)}
              placeholder="child@example.com"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-300 mb-1">Child Phone</label>
            <input
              type="tel"
              required
              value={childPhone}
              onChange={(e) => setChildPhone(e.target.value)}
              placeholder="+1234567890"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-300 mb-1">Spending Threshold ($)</label>
            <input
              type="number"
              value={thresholdAmount}
              onChange={(e) => setThresholdAmount(e.target.value)}
              placeholder="e.g. 500"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-xs"
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg"
            >
              Add Child
            </button>
          </div>
        </form>
      </div>

      {/* Children list */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Monitored Children</h2>
        {loading ? (
          <p className="text-gray-400 text-sm">Loading children...</p>
        ) : childrenList.length === 0 ? (
          <p className="text-gray-400 text-sm">No child accounts connected.</p>
        ) : (
          <div className="space-y-4">
            {childrenList.map((c) => (
              <div key={c.relationship_id} className="p-4 bg-gray-700/40 border border-gray-700 rounded-lg flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">{c.child_name}</h3>
                  <p className="text-xs text-gray-400">{c.child_email} • {c.child_phone}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-400">Limit: ${c.threshold_amount}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
