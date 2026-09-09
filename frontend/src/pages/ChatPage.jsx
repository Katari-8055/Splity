import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiService } from '../services/api';

// Rich Message Formatter for AI text responses
function FormattedText({ text, onPromptClick }) {
  if (!text) return null;

  const lines = text.split('\n');

  return (
    <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed text-slate-200">
      {lines.map((line, lineIdx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={lineIdx} className="h-1.5" />;

        // Header lines (starts with # or 🏔️ / 📊 / 👥 / 💰 / 🧾 / 🎉)
        const isHeader = trimmed.startsWith('#') || /^[🏔️📊👥💰🧾🎉🤝💬📋💡⚡]/.test(trimmed) && trimmed.includes('**');
        
        // Tip / Note lines
        const isTip = trimmed.startsWith('💬') || trimmed.startsWith('💡') || trimmed.toLowerCase().includes('*tip:');

        // Bullet point lines
        const isBullet = trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ');

        // Numbered list lines (e.g. "1. ")
        const isNumbered = /^\d+\.\s/.test(trimmed);

        const renderInlineFormatting = (str) => {
          // Tokenize bold **...**, italics *...*, code `...`, prompt suggestions *"..."*
          const tokens = [];
          let remaining = str;
          let key = 0;

          while (remaining) {
            // Check for prompt in quotes like *"Split $60 dinner with Rahul"*
            const promptMatch = remaining.match(/^(\*?["“]([^"”]+)["”]\*?)/);
            // Check for bold **...**
            const boldMatch = remaining.match(/^(\*\*(.+?)\*\*)/);
            // Check for code `...`
            const codeMatch = remaining.match(/^(`([^`]+)`)/);
            // Check for currency $XX.XX or ₹XX
            const amountMatch = remaining.match(/^([$₹€£]\d+(?:\.\d{2})?)/);

            if (promptMatch && onPromptClick && promptMatch[2].length > 4) {
              const promptText = promptMatch[2];
              tokens.push(
                <button
                  key={key++}
                  onClick={() => onPromptClick(promptText)}
                  className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 font-medium text-[11px] sm:text-xs transition cursor-pointer"
                >
                  "{promptText}" ↗
                </button>
              );
              remaining = remaining.slice(promptMatch[1].length);
            } else if (boldMatch) {
              tokens.push(
                <strong key={key++} className="font-semibold text-slate-100">
                  {boldMatch[2]}
                </strong>
              );
              remaining = remaining.slice(boldMatch[1].length);
            } else if (codeMatch) {
              tokens.push(
                <code key={key++} className="px-1.5 py-0.5 bg-[#121826] border border-[#232f48] text-indigo-300 rounded font-mono text-xs">
                  {codeMatch[2]}
                </code>
              );
              remaining = remaining.slice(codeMatch[1].length);
            } else if (amountMatch) {
              tokens.push(
                <span key={key++} className="font-bold text-emerald-400 font-mono">
                  {amountMatch[1]}
                </span>
              );
              remaining = remaining.slice(amountMatch[1].length);
            } else {
              // Take regular character up to next special char
              const nextSpecial = remaining.search(/[\*`"$₹€£]/);
              if (nextSpecial === -1) {
                tokens.push(remaining);
                break;
              } else if (nextSpecial === 0) {
                tokens.push(remaining[0]);
                remaining = remaining.slice(1);
              } else {
                tokens.push(remaining.slice(0, nextSpecial));
                remaining = remaining.slice(nextSpecial);
              }
            }
          }

          return tokens;
        };

        if (isTip) {
          return (
            <div key={lineIdx} className="my-2 p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-indigo-300 text-xs flex items-start space-x-2">
              <span className="text-sm flex-shrink-0">💡</span>
              <div className="flex-1">{renderInlineFormatting(trimmed.replace(/^[💬💡]\s*/, ''))}</div>
            </div>
          );
        }

        if (isBullet) {
          return (
            <div key={lineIdx} className="flex items-start space-x-2 pl-1 py-0.5">
              <span className="text-indigo-400 font-bold mt-0.5 text-xs">•</span>
              <div className="flex-1">{renderInlineFormatting(trimmed.replace(/^[•\-\*]\s*/, ''))}</div>
            </div>
          );
        }

        if (isNumbered) {
          const numberMatch = trimmed.match(/^(\d+)\.\s*(.*)$/);
          return (
            <div key={lineIdx} className="flex items-start space-x-2 pl-1 py-0.5">
              <span className="w-4 h-4 rounded-full bg-indigo-600/20 text-indigo-400 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                {numberMatch ? numberMatch[1] : '•'}
              </span>
              <div className="flex-1">{renderInlineFormatting(numberMatch ? numberMatch[2] : trimmed)}</div>
            </div>
          );
        }

        return (
          <div key={lineIdx} className={isHeader ? 'font-semibold text-slate-100 mt-1 mb-0.5' : ''}>
            {renderInlineFormatting(line)}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `👋 **Welcome to SpendSavvy AI Assistant!**

I can help you manage your expenses, groups, and social finances naturally. Here are quick things you can ask me:

• 👥 **Friends**: *"Show my friends"* or *"Add friend Priya with email priya@test.com"*
• 🏔️ **Groups**: *"Create a group with all my friends named Dargling Trip"*
• 📋 **Group Details**: *"Show details of Dargling Trip group"*
• 💸 **Split Expenses**: *"Split $60 dinner with Rahul and Alice"*
• 💰 **Balances & Debts**: *"Who owes me money?"* or *"Settle up with Rahul"*
• 📊 **Analytics**: *"Show my spending breakdown"*`
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
            resData: res,
            resType: res.type
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
          text: 'Encountered an issue processing your request. Please try again.'
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

  function handleClearChat() {
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        text: `👋 Chat cleared! How can I help you today?\n\n• *"Show my friends"*\n• *"List all my groups"*\n• *"Who owes me money?"*\n• *"Show my spending breakdown"*`
      }
    ]);
    setPendingSplit(null);
  }

  const quickPrompts = [
    { label: '👥 My Friends', prompt: 'Show my friends' },
    { label: '🏔️ My Groups', prompt: 'List all my groups' },
    { label: '💰 Who Owes Me?', prompt: 'Who owes me money?' },
    { label: '📊 Spending Insights', prompt: 'Show my spending breakdown' },
    { label: '🧾 Recent Expenses', prompt: 'Show my recent expenses' },
    { label: '➕ Create Group', prompt: 'Create a group with all my friends and the group name should be Dargling Trip' },
    { label: '💸 Split $60 Dinner', prompt: 'Split $60 dinner with all my friends' }
  ];

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-90px)] bg-[#101522] border border-[#1e2638] rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#1e2638] bg-[#0c101a] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 border border-indigo-400/30 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/20">
            AI
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              SpendSavvy AI Assistant
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Active
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">Natural language group management, balances & expense splitting</p>
          </div>
        </div>

        <button
          onClick={handleClearChat}
          className="text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#1e2638] bg-[#141b2a] hover:bg-[#1c2538] transition flex items-center gap-1.5"
          title="Clear Conversation"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 scroll-smooth">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            {/* Sender Label */}
            <div className={`text-[10px] font-medium text-slate-500 mb-1 px-1 flex items-center gap-1.5 ${m.sender === 'user' ? 'flex-row-reverse' : ''}`}>
              <span>{m.sender === 'user' ? 'You' : 'SpendSavvy AI'}</span>
              <span className="text-[9px] text-slate-600">•</span>
              <span className="text-[9px] text-slate-600">Just now</span>
            </div>

            {/* Bubble */}
            <div
              className={`max-w-xl px-4 py-3 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-tr-xs shadow-md shadow-indigo-600/10'
                  : 'bg-[#151c2c] text-slate-200 rounded-tl-xs border border-[#202b40] shadow-md'
              }`}
            >
              {m.sender === 'user' ? (
                <span className="text-white font-medium">{m.text}</span>
              ) : (
                <FormattedText text={m.text} onPromptClick={(p) => processMessage(p)} />
              )}
            </div>

            {/* 1. Interactive Card: Friends List */}
            {m.resType === 'friend_info' && Array.isArray(m.resData?.data) && m.resData.data.length > 0 && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/30 rounded-xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-[#243048] pb-2">
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <span>👥</span> Friends Directory ({m.resData.data.length})
                  </span>
                  <span className="text-[10px] text-indigo-400 font-medium">Click to interact</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {m.resData.data.map((f, idx) => (
                    <div
                      key={f.id || idx}
                      className="bg-[#0e131f] border border-[#1e283d] hover:border-indigo-500/40 rounded-lg p-2.5 transition flex flex-col justify-between"
                    >
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600/30 to-purple-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-xs">
                          {f.name ? f.name.charAt(0).toUpperCase() : 'F'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-200 truncate">{f.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{f.email || 'No email'}</p>
                        </div>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-[#1a2234] flex gap-1.5">
                        <button
                          onClick={() => processMessage(`Split $40 for dinner with ${f.name}`)}
                          className="flex-1 py-1 px-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded text-[10px] font-semibold transition"
                        >
                          💸 Split Bill
                        </button>
                        <button
                          onClick={() => processMessage(`What is my balance with ${f.name}?`)}
                          className="flex-1 py-1 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-medium transition"
                        >
                          💰 Balance
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Interactive Card: Groups List */}
            {m.resType === 'list_groups' && Array.isArray(m.resData?.data) && m.resData.data.length > 0 && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/30 rounded-xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-[#243048] pb-2">
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🏔️</span> Your Active Groups ({m.resData.data.length})
                  </span>
                </div>

                <div className="space-y-2">
                  {m.resData.data.map((g, idx) => (
                    <div
                      key={g.id || idx}
                      className="bg-[#0e131f] border border-[#1e283d] hover:border-indigo-500/40 rounded-lg p-3 transition flex items-center justify-between"
                    >
                      <div>
                        <h4 className="text-xs font-bold text-slate-100">{g.name}</h4>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                          <span>👥 {g.member_count || 1} members</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-mono font-medium">${parseFloat(g.total_spent || 0).toFixed(2)} spent</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => processMessage(`Show details of ${g.name} group`)}
                          className="py-1 px-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => processMessage(`Add $100 hotel bill in ${g.name} group`)}
                          className="py-1 px-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition"
                        >
                          + Split
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Interactive Card: Friend Balances & Debts */}
            {m.resType === 'friend_balances' && m.resData?.data && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/30 rounded-xl p-4 shadow-md space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#0e131f] border border-[#1e283d] rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-slate-400 block">You Are Owed</span>
                    <span className="text-emerald-400 font-bold text-sm block mt-0.5 font-mono">
                      ${parseFloat(m.resData.data.totalYouAreOwed || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-[#0e131f] border border-[#1e283d] rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-slate-400 block">You Owe</span>
                    <span className="text-rose-400 font-bold text-sm block mt-0.5 font-mono">
                      ${parseFloat(m.resData.data.totalYouOwe || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-[#0e131f] border border-[#1e283d] rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-slate-400 block">Net Balance</span>
                    <span className={`font-bold text-sm block mt-0.5 font-mono ${(m.resData.data.netBalance || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {(m.resData.data.netBalance || 0) >= 0 ? '+' : ''}${parseFloat(m.resData.data.netBalance || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {Array.isArray(m.resData.data.balances) && m.resData.data.balances.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {m.resData.data.balances.map((b, idx) => (
                      <div key={idx} className="bg-[#0e131f] border border-[#1e283d] rounded-lg p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.balance > 0 ? '#10b981' : b.balance < 0 ? '#f43f5e' : '#64748b' }} />
                          <span className="font-semibold text-slate-200">{b.friendName}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`font-bold font-mono ${b.balance > 0 ? 'text-emerald-400' : b.balance < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                            {b.balance > 0 ? `+ $${b.balance.toFixed(2)}` : b.balance < 0 ? `- $${Math.abs(b.balance).toFixed(2)}` : '$0.00'}
                          </span>
                          {b.balance !== 0 && (
                            <button
                              onClick={() => processMessage(`Settle up with ${b.friendName}`)}
                              className="py-0.5 px-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded text-[10px] font-semibold transition"
                            >
                              Settle
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3.5 Interactive Card: Settlement Completed */}
            {m.resType === 'settle_up' && m.resData?.data && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-emerald-500/30 rounded-xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-[#243048] pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold">
                      ✓
                    </span>
                    <span className="text-xs font-bold text-slate-100">
                      Settlement with {m.resData.data.friend?.name || 'Friend'}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Payment Saved
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#0e131f] border border-[#1e283d] rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 block">Amount Settled</span>
                    <span className="text-emerald-400 font-bold text-sm block mt-0.5 font-mono">
                      ${parseFloat(m.resData.data.settleAmount || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-[#0e131f] border border-[#1e283d] rounded-lg p-2.5">
                    <span className="text-[10px] text-slate-400 block">Updated Balance</span>
                    <span className="text-slate-100 font-bold text-sm block mt-0.5 font-mono">
                      ${parseFloat(Math.abs(m.resData.data.newBalance || 0)).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    onClick={() => processMessage('Who owes me money?')}
                    className="w-full py-1.5 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold transition"
                  >
                    💰 View All Updated Balances
                  </button>
                </div>
              </div>
            )}

            {/* 4. Interactive Card: Group Creation */}
            {m.resType === 'create_group' && m.resData?.data?.group && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-emerald-500/30 rounded-xl p-4 shadow-md">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#243048]">
                  <div>
                    <span className="font-bold text-slate-100 text-sm block">
                      {m.resData.data.group.name}
                    </span>
                    <span className="text-[11px] text-emerald-400 font-medium">
                      Group Created Successfully ✓
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {m.resData.data.memberCount || m.resData.data.members?.length || 1} Members
                  </span>
                </div>

                {m.resData.data.members && m.resData.data.members.length > 0 && (
                  <div className="my-2.5">
                    <div className="text-[11px] text-slate-400 mb-1.5 font-medium">Members Included:</div>
                    <div className="flex flex-wrap gap-1">
                      {m.resData.data.members.map((member, i) => (
                        <span
                          key={i}
                          className="text-[11px] bg-[#1a2338] border border-[#263452] text-slate-300 px-2 py-0.5 rounded-full"
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
                    View Details
                  </button>
                  <button
                    onClick={() => processMessage(`Add $100 expense in ${m.resData.data.group.name} group`)}
                    className="flex-1 py-1.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition"
                  >
                    + Add Expense
                  </button>
                </div>
              </div>
            )}

            {/* 5. Interactive Card: Group Details */}
            {m.resType === 'group_details' && m.resData?.data?.group && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/30 rounded-xl p-4 shadow-md">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#243048]">
                  <span className="font-bold text-slate-100 text-sm">
                    {m.resData.data.group.name}
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
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
                          className="text-[11px] bg-[#1a2338] border border-[#263452] text-slate-300 px-2 py-0.5 rounded-full"
                        >
                          {member.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => processMessage(`Add $50 dinner bill in ${m.resData.data.group.name}`)}
                    className="flex-1 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
                  >
                    + Split Bill in Group
                  </button>
                </div>
              </div>
            )}

            {/* 6. Interactive Card: Expense Split Review & Confirmation */}
            {m.isPendingConfirmation && m.splitData && pendingSplit && (
              <div className="mt-2.5 w-full max-w-xl bg-[#141b2b] border border-indigo-500/40 rounded-xl p-4 shadow-lg ring-1 ring-indigo-500/20">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#243048]">
                  <div>
                    <span className="font-bold text-slate-100 text-sm block">
                      {m.splitData.description || 'Shared Expense'}
                    </span>
                    <span className="text-[10px] text-indigo-400 uppercase tracking-wider font-semibold">
                      Review Expense Split
                    </span>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    {m.splitData.category || 'General'}
                  </span>
                </div>

                <div className="my-3 space-y-2.5">
                  <div className="flex justify-between items-center bg-[#0e131f] p-2.5 rounded-lg border border-[#1e283d]">
                    <span className="text-xs text-slate-400 font-medium">Total Bill Amount:</span>
                    <span className="text-slate-100 font-bold text-base font-mono">
                      ${parseFloat(m.splitData.amount || m.splitData.totalAmount || 0).toFixed(2)}
                    </span>
                  </div>

                  {m.splitData.participants && m.splitData.participants.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Per Person Breakdown:
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {m.splitData.participants.map((p, idx) => (
                          <div key={idx} className="bg-[#0e131f] rounded-lg p-2 flex justify-between items-center text-xs border border-[#1e283d]">
                            <span className="text-slate-300 truncate font-medium">{p.name}</span>
                            <span className="font-bold text-emerald-400 font-mono ml-2">
                              ${parseFloat(p.amount || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm & Cancel Buttons */}
                <div className="flex gap-2 pt-2 border-t border-[#243048]">
                  <button
                    onClick={() => handleConfirmSplit(m.splitData)}
                    disabled={confirming || loading}
                    className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {confirming ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        Saving...
                      </>
                    ) : (
                      '✓ Confirm & Save Split'
                    )}
                  </button>
                  <button
                    onClick={handleCancelSplit}
                    disabled={confirming || loading}
                    className="py-2.5 px-3 bg-[#1e2638] hover:bg-[#28324a] text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition cursor-pointer"
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
            <div className="bg-[#151c2c] border border-[#202b40] text-slate-300 px-4 py-2.5 rounded-2xl rounded-tl-xs text-xs flex items-center gap-2.5 shadow-md">
              <div className="flex space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]"></span>
              </div>
              <span className="text-slate-400 text-xs">AI is thinking and processing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Carousel Bar */}
      <div className="px-4 py-2.5 border-t border-[#1e2638] bg-[#0c101a] flex gap-2 overflow-x-auto scrollbar-none">
        {quickPrompts.map((item, idx) => (
          <button
            key={idx}
            onClick={() => processMessage(item.prompt)}
            disabled={loading}
            className="text-xs text-slate-300 hover:text-white bg-[#141b2a] hover:bg-[#1e283d] border border-[#222d42] hover:border-indigo-500/40 rounded-lg px-3 py-1.5 whitespace-nowrap transition flex-shrink-0 font-medium shadow-sm cursor-pointer"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3.5 border-t border-[#1e2638] bg-[#0c101a] flex space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask AI anything (e.g. Split $50 with Rahul, or Who owes me money?)..."
          className="flex-1 px-4 py-2.5 bg-[#141a29] border border-[#222c42] rounded-xl text-slate-100 text-xs sm:text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition placeholder-slate-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition shadow-md shadow-indigo-600/20 flex items-center gap-1.5 cursor-pointer"
        >
          <span>Send</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </form>
    </div>
  );
}

