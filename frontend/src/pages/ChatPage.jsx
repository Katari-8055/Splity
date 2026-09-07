import React, { useState, useRef, useEffect } from 'react';
import { aiService, expenseService } from '../services/api';

export default function ChatPage() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: '👋 Hello! I am your **AI Expense Assistant** with full MCP support.\n\nYou can ask me to:\n• 💸 **Split an expense**: *"Split $50 dinner with Rahul Bind"*\n• 💰 **Check balances**: *"Who owes me money?"* or *"What is my balance?"*\n• 📊 **View analytics**: *"Show my spending breakdown"*\n• 👥 **Friends & Groups**: *"Show my friends"* or *"List my groups"*\n• 🧾 **Recent activity**: *"Show recent expenses"*'
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
            splitData: res.data
          }
        ]);
      } else if (res.saved || (res.type === 'expense_split' && !res.needsConfirmation)) {
        setPendingSplit(null);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            sender: 'assistant',
            text: res.message || '✅ Expense successfully processed and saved!'
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            sender: 'assistant',
            text: res.message || res.intent || 'Done!'
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
          text: '❌ Sorry, I encountered an error processing your message.'
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
    'Split $50 with all my friends',
    'Who owes me money?',
    'Show my spending insights',
    'Show my friends list',
    'Show my recent expenses'
  ];

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-120px)] bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 bg-gray-850/80 backdrop-blur flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center text-white text-xl shadow-lg shadow-blue-500/20">
            🤖
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              SpendSavvy AI Assistant
              <span className="text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/30">
                MCP Connected
              </span>
            </h1>
            <p className="text-xs text-gray-400">Expense splitting, live balances, analytics & smart queries</p>
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
      <div className="px-4 py-2 border-t border-gray-800/80 bg-gray-850/40 flex gap-2 overflow-x-auto scrollbar-none">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => processMessage(prompt)}
            disabled={loading}
            className="text-xs text-gray-300 hover:text-white bg-gray-800/80 hover:bg-blue-600/30 border border-gray-700/60 hover:border-blue-500/40 rounded-full px-3 py-1 whitespace-nowrap transition"
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
          placeholder="e.g. Split $50 with Rahul Bind, or Who owes me money?..."
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
