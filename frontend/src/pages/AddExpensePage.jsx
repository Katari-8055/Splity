import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { expenseService, friendService, groupService } from '../services/api';

export default function AddExpensePage() {
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [subcategory, setSubcategory] = useState('');
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [splitType, setSplitType] = useState('equal');

  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadOptions() {
      try {
        const [f, g] = await Promise.all([
          friendService.getFriends(),
          groupService.getGroups()
        ]);
        setFriends(f || []);
        setGroups(g || []);
      } catch (err) {
        console.error('Error loading options:', err);
      }
    }
    loadOptions();
  }, []);

  async function handleAiCategorize() {
    if (!description || !amount) return;
    setIsAiLoading(true);
    try {
      const res = await expenseService.aiSplit(description, amount);
      if (res?.category) setCategory(res.category);
      if (res?.subcategory) setSubcategory(res.subcategory);
    } catch (err) {
      console.error('AI error:', err);
    } finally {
      setIsAiLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || !category) {
      setError('Amount and category are required');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await expenseService.createExpense({
        description,
        amount: parseFloat(amount),
        category,
        subcategory,
        friendIds: selectedFriends,
        splitType,
        groupId: groupId || undefined
      });
      navigate('/expenses');
    } catch (err) {
      setError(err.message || 'Failed to create expense');
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleFriend(id) {
    if (selectedFriends.includes(id)) {
      setSelectedFriends(selectedFriends.filter((f) => f !== id));
    } else {
      setSelectedFriends([...selectedFriends, id]);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Add Expense</h1>
          <p className="text-xs text-slate-400 mt-0.5">Record a transaction and distribute balances</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/expenses')}
          className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg border border-[#1e2638] bg-[#121722] hover:bg-[#182030] transition-colors"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
          <svg className="w-4 h-4 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Form Container */}
      <form onSubmit={handleSubmit} className="bg-[#121722] border border-[#1e2638] rounded-xl p-6 space-y-5 shadow-sm">
        {/* Description & AI Autocomplete */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Description</label>
          <div className="flex space-x-2">
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dinner with team, Flight tickets, Groceries"
              className="flex-1 px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={handleAiCategorize}
              disabled={isAiLoading || !description || !amount}
              className="px-3.5 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5"
            >
              <span>{isAiLoading ? 'Categorizing...' : 'Auto-Categorize'}</span>
            </button>
          </div>
        </div>

        {/* Amount & Category */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Amount ($)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-slate-500 text-xs font-semibold">$</span>
              <input
                type="number"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs font-medium focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="Food">Food & Dining</option>
              <option value="Transport">Transport & Travel</option>
              <option value="Shopping">Shopping & Retail</option>
              <option value="Bills">Bills & Utilities</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Other">Other Expenses</option>
            </select>
          </div>
        </div>

        {/* Subcategory */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Subcategory (Optional)</label>
          <input
            type="text"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="e.g. Italian Restaurant, Coffee, Metro"
            className="w-full px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Group Selection */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Assign to Group</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Personal Expense (No Group)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        {/* Split with Friends */}
        {!groupId && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Split With Friends</label>
              <span className="text-[11px] text-slate-500">{selectedFriends.length} selected</span>
            </div>

            <div className="max-h-44 overflow-y-auto space-y-1.5 p-2 bg-[#0e131d] rounded-lg border border-[#1e2638]">
              {friends.length === 0 ? (
                <p className="text-xs text-slate-500 p-2">No friends found. Add friends to split individual expenses.</p>
              ) : (
                friends.map((f) => {
                  const id = f.id || f.friend_id;
                  const isSelected = selectedFriends.includes(id);
                  return (
                    <label
                      key={id}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                        isSelected ? 'bg-indigo-600/10 border border-indigo-500/20' : 'hover:bg-[#151c2a]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleFriend(id)}
                        className="rounded bg-[#121722] border-[#2a364f] text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-slate-200 block truncate">{f.name || f.email}</span>
                        <span className="text-[10px] text-slate-500 block truncate">{f.email}</span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Submit Actions */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#1e2638]">
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg hover:bg-[#182030] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Expense'}
          </button>
        </div>
      </form>
    </div>
  );
}
