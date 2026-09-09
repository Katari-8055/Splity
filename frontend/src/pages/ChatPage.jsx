import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiService, expenseService } from '../services/api';

export default function ChatPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: '👋 Hello! I am your **SpendSavvy AI Assistant** with full autonomous group & expense superpowers.\n\nYou can ask me in English or Hindi:\n• 🏔️ **Create Group**: *"Create a group with all my friends and the group name should be Dargling Trip"*\n• 📋 **Group Details**: *"Show details of Dargling Trip group"*\n• 💸 **Split Expenses**: *"Split $60 dinner with Rahul and Alice"* or *"Add $120 hotel bill in Dargling Trip group"*\n• 💰 **Debts & Balances**: *"Who owes me money?"* or *"Settle up with Rahul"*\n• 📊 **Analytics**: *"Show my monthly spending breakdown"*\n• 👥 **Friends**: *"Show my friends"* or *"Add friend Priya"*'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingSplit, setPendingSplit] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function processMessage(userText, overridePending = null) {
    if (!userText.trim() || loading) return;

    const currentPending = overridePending !== null ? overridePending : pendingSplit;
    setInput('');
    setMessages((prev) => [...prev, { id: Date.now(), sender: 'user', text: userText }]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({
        type: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
      }));

      const res = await aiService.parseChat(userText, history, currentPending);

      if (res.needsConfirmation && res.data) {
        setPendingSplit(res.data);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            sender: 'assistant',
            text: res.message || 'Please review and confirm this expense split:',
            isPendingConfirmation: true,
            splitData: res.data,
            resData: res
          }
        ]);
      } else if (res.saved || (res.type === 'expense_split' && !res.needsConfirmation)) {
        setPendingSplit(null);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            sender: 'assistant',
            text: res.message || '✅ Expense successfully processed and saved!',
            resType: res.type,
            resData: res
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            sender: 'assistant',
            text: res.message || res.intent || 'Done!',
            resType: res.type,
            resData: res
          }
        ]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'assistant',
          text: '❌ Sorry, I encountered an error processing your message. Please make sure the backend is running.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend(e) {
    e.preventDefault();
    processMessage(input);
  }

  async function handleConfirmSplit(splitData) {
    setConfirming(true);
    await processMessage('yes, confirm and save this expense', splitData || pendingSplit);
    setConfirming(false);
  }

  function handleCancelSplit() {
    setPendingSplit(null);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        sender: 'assistant',
        text: '❌ Expense split has been cancelled.'
      }
    ]);
  }

  const quickPrompts = [
    'Create a group with all my friends and the group name should be Dargling Trip',
    'Show details of Dargling Trip group',
    'List all my groups',
    'Who owes me money?',
    'Show my spending insights',
    'Show my friends list',
    'Split $60 dinner with all my friends'
  ];

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-120px)] bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 bg-gray-850/80 backdrop-blur flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 rounded-xl flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-500/20">
            🤖
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              SpendSavvy AI Assistant
              <span className="text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/30">
                Full AI Autonomous
              </span>
            </h1>
            <p className="text-xs text-gray-400">Create groups, split bills, query live debts & view analytics</p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scrollbar-thin scrollbar-thumb-gray-700">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-xl p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                m.sender === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-none shadow-md shadow-blue-600/10'
                  : 'bg-gray-800/90 text-gray-200 rounded-bl-none border border-gray-700/60 shadow-md shadow-black/20'
              }`}
            >
              {m.text}
            </div>

            {/* Custom Rich Card: Group Creation */}
            {m.resType === 'create_group' && m.resData?.data?.group && (
              <div className="mt-3 w-full max-w-xl bg-gradient-to-br from-gray-850 to-gray-900 border border-emerald-500/40 rounded-2xl p-4 shadow-xl shadow-emerald-500/10 animate-fade-in">
                <div className="flex items-center justify-between pb-3 border-b border-gray-700/60">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🏔️</span>
                    <div>
                      <span className="font-bold text-white text-base block">
                        {m.resData.data.group.name}
                      </span>
                      <span className="text-xs text-emerald-400 font-medium">
                        Group Created Successfully
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {m.resData.data.memberCount || m.resData.data.members?.length || 1} Members
                  </span>
                </div>

                {m.resData.data.members && m.resData.data.members.length > 0 && (
                  <div className="my-3">
                    <div className="text-xs text-gray-400 mb-2 font-medium">Included Members:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.resData.data.members.map((member, i) => (
                        <span
                          key={i}
                          className="text-xs bg-gray-800 border border-gray-700 text-gray-200 px-2.5 py-1 rounded-lg flex items-center gap-1"
                        >
                          👤 {member.name || member.email || 'Member'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-gray-700/40 flex gap-2">
                  <button
                    onClick={() => processMessage(`Show details of ${m.resData.data.group.name} group`)}
                    className="flex-1 py-2 px-3 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 hover:text-white border border-indigo-500/30 rounded-xl text-xs font-semibold transition"
                  >
                    🔍 View Group Details
                  </button>
                  <button
                    onClick={() => processMessage(`Add $100 expense in ${m.resData.data.group.name} group`)}
                    className="flex-1 py-2 px-3 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 hover:text-white border border-emerald-500/30 rounded-xl text-xs font-semibold transition"
                  >
                    💳 Add Expense to Group
                  </button>
                </div>
              </div>
            )}

            {/* Custom Rich Card: Group Details */}
            {m.resType === 'group_details' && m.resData?.data?.group && (
              <div className="mt-3 w-full max-w-xl bg-gray-850 border border-indigo-500/40 rounded-2xl p-4 shadow-xl shadow-indigo-500/10 animate-fade-in">
                <div className="flex items-center justify-between pb-3 border-b border-gray-700/60">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🏔️</span>
                    <span className="font-bold text-white text-sm">
                      {m.resData.data.group.name}
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Total Spent: ${parseFloat(m.resData.data.totalSpent || 0).toFixed(2)}
                  </span>
                </div>

                {m.resData.data.members && (
                  <div className="my-2.5">
                    <div className="text-xs text-gray-400 mb-1.5 font-medium">Group Members:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.resData.data.members.map((member, i) => (
                        <span
                          key={i}
                          className="text-xs bg-gray-900 border border-gray-700/80 text-gray-300 px-2 py-0.5 rounded-md"
                        >
                          👤 {member.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => processMessage(`Add $50 food expense in ${m.resData.data.group.name}`)}
                    className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition"
                  >
                    ➕ Split Bill in {m.resData.data.group.name}
                  </button>
                </div>
              </div>
            )}

            {/* Interactive Confirmation Card */}
            {m.isPendingConfirmation && m.splitData && pendingSplit && (
              <div className="mt-3 w-full max-w-xl bg-gray-800/95 border border-indigo-500/40 rounded-2xl p-4 shadow-xl shadow-indigo-500/10 animate-fade-in">
                <div className="flex items-center justify-between pb-3 border-b border-gray-700/60">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">💳</span>
                    <span className="font-semibold text-white text-sm">
                      {m.splitData.description || 'Shared Expense'}
                    </span>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    {m.splitData.category || 'Food'}
                  </span>
                </div>

                <div className="my-3 space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Total Amount:</span>
                    <span className="text-white font-bold text-sm">
                      ${parseFloat(m.splitData.amount || m.splitData.totalAmount || 0).toFixed(2)}
                    </span>
                  </div>

                  {m.splitData.participants && m.splitData.participants.length > 0 && (
                    <div className="pt-2 border-t border-gray-700/40">
                      <div className="text-xs font-medium text-gray-400 mb-2">Split Breakdown:</div>
                      <div className="grid grid-cols-2 gap-2">
                        {m.splitData.participants.map((p, idx) => (
                          <div key={idx} className="bg-gray-900/60 rounded-lg p-2 flex justify-between items-center text-xs border border-gray-700/40">
                            <span className="text-gray-300 truncate max-w-[120px]">👤 {p.name}</span>
                            <span className="font-bold text-emerald-400">
                              ${parseFloat(p.amount || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm & Cancel Buttons */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => handleConfirmSplit(m.splitData)}
                    disabled={confirming || loading}
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-600/20"
                  >
                    {confirming ? (
                      <span>Saving to database...</span>
                    ) : (
                      <>
                        <span>✅</span> Confirm & Save Split
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelSplit}
                    disabled={confirming || loading}
                    className="py-2.5 px-4 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 hover:text-white rounded-xl text-xs font-semibold transition"
                  >
                    ❌ Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800/80 border border-gray-700/50 text-gray-300 px-4 py-3 rounded-2xl rounded-bl-none text-xs flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
              AI is analyzing & executing query...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2.5 border-t border-gray-800/80 bg-gray-850/40 flex gap-2 overflow-x-auto scrollbar-none">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => processMessage(prompt)}
            disabled={loading}
            className="text-xs text-gray-300 hover:text-white bg-gray-800/80 hover:bg-blue-600/30 border border-gray-700/60 hover:border-blue-500/40 rounded-full px-3 py-1.5 whitespace-nowrap transition flex-shrink-0"
          >
            💬 {prompt}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-gray-800 bg-gray-850 flex space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Create group Dargling Trip with all friends, or Who owes me money?..."
          className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition shadow-inner placeholder-gray-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm disabled:opacity-50 transition shadow-lg shadow-blue-600/20 flex items-center gap-2"
        >
          <span>Send</span>
          <span>🚀</span>
        </button>
      </form>
    </div>
  );
}
