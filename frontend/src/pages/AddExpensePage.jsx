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
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadOptions() {
      try {
        const f = await friendService.getFriends();
        const g = await groupService.getGroups();
        setFriends(f);
        setGroups(g);
      } catch (err) {
        console.error(err);
      }
    }
    loadOptions();
  }, []);

  async function handleAiCategorize() {
    if (!description || !amount) return;
    setIsAiLoading(true);
    try {
      const res = await expenseService.aiSplit(description, amount);
      if (res.category) setCategory(res.category);
      if (res.subcategory) setSubcategory(res.subcategory);
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
      <div>
        <h1 className="text-2xl font-bold text-white">Add New Expense</h1>
        <p className="text-gray-400 text-sm mt-1">Log an expense and split it with friends or groups</p>
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-5 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-gray-300 mb-1">Description</label>
          <div className="flex space-x-2">
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Team Dinner, Uber to Airport"
              className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
            />
            <button
              type="button"
              onClick={handleAiCategorize}
              disabled={isAiLoading || !description || !amount}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {isAiLoading ? 'Analyzing...' : '🤖 AI Auto-Cat'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">Amount ($)</label>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
            >
              <option value="Food">Food & Dining</option>
              <option value="Transport">Transport</option>
              <option value="Shopping">Shopping</option>
              <option value="Bills">Bills & Utilities</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300 mb-1">Subcategory (Optional)</label>
          <input
            type="text"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="e.g. Coffee, Groceries"
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300 mb-1">Assign to Group (Optional)</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
          >
            <option value="">No Group (Individual Split)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300 mb-2">Split With Friends</label>
          <div className="max-h-36 overflow-y-auto space-y-2 p-3 bg-gray-900 rounded-lg border border-gray-700">
            {friends.length === 0 ? (
              <p className="text-xs text-gray-500">No friends added yet.</p>
            ) : (
              friends.map((f) => (
                <label key={f.id || f.friend_id} className="flex items-center space-x-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={selectedFriends.includes(f.id || f.friend_id)}
                    onChange={() => toggleFriend(f.id || f.friend_id)}
                    className="rounded bg-gray-800 border-gray-600 text-blue-600"
                  />
                  <span>{f.name} ({f.email})</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
          >
            Save Expense
          </button>
        </div>
      </form>
    </div>
  );
}
