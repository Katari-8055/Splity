import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { groupService } from '../services/api';

export default function GroupDetailPage() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGroupData();
  }, [id]);

  async function loadGroupData() {
    try {
      const g = await groupService.getGroupDetails(id);
      const e = await groupService.getGroupExpenses(id);
      const m = await groupService.getGroupMessages(id);
      setGroup(g);
      setExpenses(e);
      setMessages(m);
    } catch (err) {
      console.error('Error loading group detail:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      await groupService.postGroupMessage(id, newMessage);
      setNewMessage('');
      const updatedMessages = await groupService.getGroupMessages(id);
      setMessages(updatedMessages);
    } catch (err) {
      console.error('Failed to post message:', err);
    }
  }

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading group...</div>;
  }

  if (!group) {
    return <div className="text-red-400 text-sm">Group not found.</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">{group.name}</h1>
        <p className="text-gray-400 text-sm mt-1">Group Details & Member Activity</p>
      </div>

      {/* Members overview */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h2 className="text-md font-semibold text-white mb-3">Members ({(group.members || []).length})</h2>
        <div className="flex flex-wrap gap-2">
          {(group.members || []).map((m) => (
            <span key={m.id} className="px-3 py-1 bg-gray-700 text-gray-200 text-xs rounded-full border border-gray-600">
              {m.name || m.email}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expenses List */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-md font-semibold text-white">Group Expenses</h2>
          {expenses.length === 0 ? (
            <p className="text-gray-400 text-sm">No expenses logged in this group yet.</p>
          ) : (
            <div className="space-y-3">
              {expenses.map((e) => (
                <div key={e.id} className="p-3 bg-gray-700/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{e.description || e.category}</p>
                    <p className="text-xs text-gray-400">Paid by: {e.paid_by_name || 'Member'}</p>
                  </div>
                  <p className="text-sm font-bold text-green-400">${parseFloat(e.amount).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Group Chat */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 flex flex-col h-[400px]">
          <h2 className="text-md font-semibold text-white mb-3">Group Chat</h2>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin">
            {messages.length === 0 ? (
              <p className="text-gray-400 text-sm">No messages yet. Say hello!</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="p-2 bg-gray-700/40 rounded text-xs">
                  <span className="font-bold text-blue-400">{m.user_name}: </span>
                  <span className="text-gray-200">{m.message}</span>
                </div>
              ))
            )}
          </div>
          <form onSubmit={handleSendMessage} className="mt-3 flex space-x-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
