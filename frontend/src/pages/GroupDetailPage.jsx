import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { groupService } from '../services/api';

export default function GroupDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    loadGroupData();
  }, [id]);

  async function loadGroupData() {
    try {
      const [g, e, m] = await Promise.all([
        groupService.getGroupDetails(id),
        groupService.getGroupExpenses(id),
        groupService.getGroupMessages(id)
      ]);
      setGroup(g);
      setExpenses(e || []);
      setMessages(m || []);
    } catch (err) {
      console.error('Error loading group detail:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setIsSending(true);
    try {
      await groupService.postGroupMessage(id, newMessage);
      setNewMessage('');
      const updatedMessages = await groupService.getGroupMessages(id);
      setMessages(updatedMessages || []);
    } catch (err) {
      console.error('Failed to post message:', err);
    } finally {
      setIsSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-xs text-slate-500">
        Loading group workspace...
      </div>
    );
  }

  if (!group) {
    return (
      <div className="p-6 bg-[#121722] border border-[#1e2638] rounded-xl text-center space-y-3">
        <p className="text-sm font-semibold text-rose-400">Group not found or you are not a member.</p>
        <button
          onClick={() => navigate('/groups')}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold"
        >
          Back to Groups
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">{group.name}</h1>
            <span className="text-[10px] uppercase font-bold tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded">
              Group
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{group.description || 'Shared expense group'}</p>
        </div>
        <button
          onClick={() => navigate('/groups')}
          className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg border border-[#1e2638] bg-[#121722] hover:bg-[#182030] transition-colors"
        >
          ← Back
        </button>
      </div>

      {/* Members Overview */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
          Members ({(group.members || []).length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {(group.members || []).map((m) => (
            <div
              key={m.id || m.email}
              className="flex items-center space-x-2 px-2.5 py-1.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-xs text-slate-200"
            >
              <div className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-400">
                {(m.name || m.email || 'U').charAt(0).toUpperCase()}
              </div>
              <span className="font-medium text-xs">{m.name || m.email}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expenses List */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Group Expenses</h2>
            <span className="text-[11px] text-slate-500">{expenses.length} records</span>
          </div>

          {expenses.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No expenses recorded in this group yet.
            </div>
          ) : (
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {expenses.map((e) => (
                <div
                  key={e.id}
                  className="p-3 bg-[#0e131d] border border-[#1e2638] rounded-lg flex items-center justify-between hover:border-[#2a364f] transition-colors"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-200">{e.description || e.category}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Paid by <span className="text-slate-400 font-medium">{e.paid_by_name || 'Member'}</span> • {new Date(e.created_at || Date.now()).toLocaleDateString()}
                    </p>
                  </div>
                  <p className="text-xs font-bold text-emerald-400 font-mono">${parseFloat(e.amount).toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Group Chat */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 flex flex-col h-[450px] shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Group Activity Chat</h2>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No group messages yet.
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="p-2.5 bg-[#0e131d] border border-[#1e2638] rounded-lg text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-indigo-400">{m.user_name || 'Member'}</span>
                    <span className="text-[10px] text-slate-500">
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{m.message}</p>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendMessage} className="mt-3 flex space-x-2 pt-2 border-t border-[#1e2638]">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Post an update or discussion..."
              className="flex-1 px-3 py-2 bg-[#0e131d] border border-[#1e2638] rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={isSending || !newMessage.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {isSending ? '...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
