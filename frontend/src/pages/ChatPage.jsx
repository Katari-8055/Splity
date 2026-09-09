import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiService } from '../services/api';

export default function ChatPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your **SpendSavvy Assistant**.\n\nYou can ask me directly to:\n• **Create a Group**: *"Create a group with all my friends and the group name should be Dargling Trip"*\n• **Group Activity**: *"Show details of Dargling Trip group"*\n• **Split Bills**: *"Split $60 dinner with Rahul and Alice"* or *"Add $120 hotel bill in Dargling Trip group"*\n• **Debts & Balances**: *"Who owes me money?"* or *"Settle up with Rahul"*\n• **Analytics**: *"Show my spending breakdown"*\n• **Friends**: *"Show my friends"* or *"Add friend Priya"*'
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
            text: res.message || 'Expense successfully processed and saved to database.',
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
            text: res.message || res.intent || 'Completed.',
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
          text: 'Encountered an error communicating with the backend. Please verify your connection.'
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
        text: 'Expense split cancelled.'
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
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-100px)] bg-[#101522] border border-[#1e2638] rounded-xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#1e2638] bg-[#0c101a] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
            AI
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              SpendSavvy AI Assistant
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded">
                Active
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">Natural language group management & bill splitting</p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-xl px-4 py-3 rounded-xl text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                m.sender === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none shadow-sm'
                  : 'bg-[#182030] text-slate-200 rounded-bl-none border border-[#222d42] shadow-sm'
              }`}
            >
              {m.text}
            </div>

            {/* Custom Card: Group Creation */}
            {m.resType === 'create_group' && m.resData?.data?.group && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-emerald-500/30 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#243048]">
                  <div>
                    <span className="font-bold text-slate-100 text-sm block">
                      {m.resData.data.group.name}
                    </span>
                    <span className="text-[11px] text-emerald-400 font-medium">
                      Group Created
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {m.resData.data.memberCount || m.resData.data.members?.length || 1} Members
                  </span>
                </div>

                {m.resData.data.members && m.resData.data.members.length > 0 && (
                  <div className="my-2.5">
                    <div className="text-[11px] text-slate-400 mb-1.5 font-medium">Members:</div>
                    <div className="flex flex-wrap gap-1">
                      {m.resData.data.members.map((member, i) => (
                        <span
                          key={i}
                          className="text-[11px] bg-[#1a2338] border border-[#263452] text-slate-300 px-2 py-0.5 rounded"
                        >
                          {member.name || member.email || 'Member'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => processMessage(`Show details of ${m.resData.data.group.name} group`)}
                    className="flex-1 py-1.5 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition"
                  >
                    View Group Details
                  </button>
                  <button
                    onClick={() => processMessage(`Add $100 expense in ${m.resData.data.group.name} group`)}
                    className="flex-1 py-1.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition"
                  >
                    + Add Group Expense
                  </button>
                </div>
              </div>
            )}

            {/* Custom Card: Group Details */}
            {m.resType === 'group_details' && m.resData?.data?.group && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/30 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#243048]">
                  <span className="font-bold text-slate-100 text-sm">
                    {m.resData.data.group.name}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                    Total: ${parseFloat(m.resData.data.totalSpent || 0).toFixed(2)}
                  </span>
                </div>

                {m.resData.data.members && (
                  <div className="my-2.5">
                    <div className="text-[11px] text-slate-400 mb-1.5 font-medium">Group Members:</div>
                    <div className="flex flex-wrap gap-1">
                      {m.resData.data.members.map((member, i) => (
                        <span
                          key={i}
                          className="text-[11px] bg-[#1a2338] border border-[#263452] text-slate-300 px-2 py-0.5 rounded"
                        >
                          {member.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => processMessage(`Add $50 food expense in ${m.resData.data.group.name}`)}
                    className="flex-1 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
                  >
                    + Split Bill in {m.resData.data.group.name}
                  </button>
                </div>
              </div>
            )}

            {/* Interactive Confirmation Card */}
            {m.isPendingConfirmation && m.splitData && pendingSplit && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/30 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#243048]">
                  <span className="font-semibold text-slate-100 text-xs sm:text-sm">
                    {m.splitData.description || 'Shared Expense'}
                  </span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                    {m.splitData.category || 'Food'}
                  </span>
                </div>

                <div className="my-2.5 space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Total Amount:</span>
                    <span className="text-slate-100 font-bold text-sm">
                      ${parseFloat(m.splitData.amount || m.splitData.totalAmount || 0).toFixed(2)}
                    </span>
                  </div>

                  {m.splitData.participants && m.splitData.participants.length > 0 && (
                    <div className="pt-2 border-t border-[#243048]">
                      <div className="text-[11px] font-medium text-slate-400 mb-1.5">Participant Breakdown:</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {m.splitData.participants.map((p, idx) => (
                          <div key={idx} className="bg-[#182030] rounded p-1.5 flex justify-between items-center text-xs border border-[#222d42]">
                            <span className="text-slate-300 truncate max-w-[100px]">{p.name}</span>
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
                    className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow-sm"
                  >
                    {confirming ? 'Saving to Database...' : 'Confirm & Save Split'}
                  </button>
                  <button
                    onClick={handleCancelSplit}
                    disabled={confirming || loading}
                    className="py-2 px-3 bg-[#1e2638] hover:bg-[#28324a] text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#182030] border border-[#222d42] text-slate-300 px-3.5 py-2.5 rounded-xl text-xs flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              Assistant is analyzing and querying database...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2 border-t border-[#1e2638] bg-[#0c101a] flex gap-1.5 overflow-x-auto scrollbar-none">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => processMessage(prompt)}
            disabled={loading}
            className="text-[11px] text-slate-400 hover:text-slate-200 bg-[#182030] hover:bg-[#202a40] border border-[#222d42] rounded-md px-2.5 py-1 whitespace-nowrap transition flex-shrink-0"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-[#1e2638] bg-[#0c101a] flex space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything (e.g. Split $50 with Rahul, or Who owes me money?)..."
          className="flex-1 px-3.5 py-2.5 bg-[#141a29] border border-[#222c42] rounded-lg text-slate-100 text-xs sm:text-sm focus:outline-none focus:border-indigo-500 transition placeholder-slate-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs disabled:opacity-50 transition shadow-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}
