import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { aiService, friendService } from '../services/api';

const CONVERSATION_KEY = 'splity.conversationId';

const TOOL_LABELS = {
  list_friends: 'Looking up your friends',
  find_friends: 'Searching friends',
  get_balances: 'Checking balances',
  list_expenses: 'Reading your expenses',
  list_groups: 'Loading your groups',
  get_group: 'Opening the group',
  spending_summary: 'Adding up your spending',
  list_notifications: 'Checking notifications',
  create_expense: 'Preparing the expense',
  settle_up: 'Preparing the settlement',
  create_group: 'Preparing the group',
  add_friend: 'Preparing the friend request',
  post_group_message: 'Preparing the message',
};

const QUICK_PROMPTS = [
  'Who owes me money?',
  'How much did I spend this month?',
  'Show my recent expenses',
  'List my groups',
];

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  text:
    "Hi! I can split expenses, check balances and answer questions about your spending.\n\n" +
    'Try *"split 600 dinner with Rahul and Priya"* or *"who owes me money?"*. ' +
    'Type **@** to pick a friend. Nothing is saved until you press **Confirm**.',
};

// Model output is untrusted: no raw HTML (react-markdown's default), no images
// (a classic prompt-injection exfiltration channel), and links shown as plain text.
const markdownComponents = {
  img: () => null,
  a: ({ children, href }) => (
    <span className="text-slate-300">
      {children} <span className="text-slate-500">({href})</span>
    </span>
  ),
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5 mb-1.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5 mb-1.5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-emerald-300">{children}</strong>,
  code: ({ children }) => (
    <code className="px-1 py-0.5 bg-[#121826] border border-[#232f48] rounded text-indigo-300 text-xs">{children}</code>
  ),
};

function ToolChips({ tools }) {
  if (!tools?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {tools.map((t, i) => (
        <span
          key={i}
          className={`text-[11px] px-2 py-0.5 rounded-full border ${
            t.state === 'running'
              ? 'border-indigo-500/40 text-indigo-300 bg-indigo-500/10 animate-pulse'
              : t.ok
                ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                : 'border-amber-500/30 text-amber-300 bg-amber-500/10'
          }`}
        >
          {t.state === 'running' ? '⏳' : t.ok ? '✓' : '!'} {TOOL_LABELS[t.name] || t.name}
        </span>
      ))}
    </div>
  );
}

function ConfirmationCard({ card, onConfirm, onCancel }) {
  const breakdown = card.preview?.breakdown;
  const settled = card.status && card.status !== 'pending';
  return (
    <div className="mt-2 rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3 text-xs">
      <div className="font-semibold text-indigo-200 mb-1">Review before saving</div>
      <div className="text-slate-200">{card.summary}</div>
      {breakdown && (
        <table className="mt-2 w-full text-slate-300">
          <tbody>
            {breakdown.map((b) => (
              <tr key={b.name}>
                <td className="py-0.5">{b.name}</td>
                <td className="py-0.5 text-right font-mono">₹{Number(b.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {settled ? (
        <div
          className={`mt-2 font-medium ${
            card.status === 'executed' ? 'text-emerald-300' : card.status === 'cancelled' ? 'text-slate-400' : 'text-amber-300'
          }`}
        >
          {card.resultMessage}
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onConfirm}
            disabled={card.busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
          >
            {card.busy ? 'Saving…' : 'Confirm'}
          </button>
          <button
            onClick={onCancel}
            disabled={card.busy}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] hover:bg-[#222c44] border border-[#2a3550] text-slate-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Suggest friends while the user types "@ra…" (Ram, Rama, Ramesh). */
function useMentionSuggestions(input) {
  const [suggestions, setSuggestions] = useState([]);
  const match = input.match(/@([^\s@]*)$/);
  const query = match ? match[1] : null;

  useEffect(() => {
    if (query === null) {
      setSuggestions([]);
      return undefined;
    }
    const handle = setTimeout(async () => {
      try {
        setSuggestions(await friendService.searchFriends(query));
      } catch {
        setSuggestions([]);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [query]);

  return suggestions;
}

export default function ChatPage() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(() => localStorage.getItem(CONVERSATION_KEY));
  const [pending, setPending] = useState([]);
  const endRef = useRef(null);
  const suggestions = useMentionSuggestions(input);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  // Restore the last conversation and any actions waiting for approval (e.g. proposed over MCP).
  useEffect(() => {
    if (conversationId) {
      aiService
        .conversationMessages(conversationId)
        .then((rows) =>
          setMessages([
            WELCOME,
            ...rows
              .filter((r) => !(r.role === 'assistant' && r.content.startsWith('[')))
              .map((r, i) => ({ id: `h${i}`, role: r.role, text: r.content })),
          ]),
        )
        .catch(() => {
          localStorage.removeItem(CONVERSATION_KEY);
          setConversationId(null);
        });
    }
    aiService.pendingActions().then(setPending).catch(() => setPending([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchMessage(id, patch) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    const replyId = `a${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u${Date.now()}`, role: 'user', text: message },
      { id: replyId, role: 'assistant', text: '', tools: [], streaming: true },
    ]);

    try {
      await aiService.streamChat({
        message,
        conversationId,
        onEvent: (event) => {
          switch (event.type) {
            case 'conversation':
              setConversationId(event.conversationId);
              localStorage.setItem(CONVERSATION_KEY, event.conversationId);
              break;
            case 'token':
              patchMessage(replyId, (m) => ({ text: m.text + event.text }));
              break;
            case 'tool_start':
              patchMessage(replyId, (m) => ({ tools: [...m.tools, { name: event.name, state: 'running' }] }));
              break;
            case 'tool_end':
              patchMessage(replyId, (m) => {
                const tools = [...m.tools];
                const idx = tools.map((t) => t.name).lastIndexOf(event.name);
                if (idx >= 0) tools[idx] = { ...tools[idx], state: 'done', ok: event.ok };
                return { tools };
              });
              break;
            case 'confirmation':
              patchMessage(replyId, { confirmation: { ...event, status: 'pending' } });
              break;
            case 'done':
              patchMessage(replyId, { text: event.message, streaming: false });
              break;
            case 'error':
              patchMessage(replyId, { text: event.message, streaming: false, error: true });
              break;
            default:
          }
        },
      });
    } catch (err) {
      patchMessage(replyId, { text: err.message || 'Something went wrong. Please try again.', streaming: false, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function decide(messageId, card, confirm) {
    patchMessage(messageId, (m) => ({ confirmation: { ...m.confirmation, busy: true } }));
    try {
      const res = confirm ? await aiService.confirmAction(card.actionId) : await aiService.cancelAction(card.actionId);
      patchMessage(messageId, (m) => ({
        confirmation: { ...m.confirmation, busy: false, status: res.status, resultMessage: res.message },
      }));
    } catch (err) {
      patchMessage(messageId, (m) => ({
        confirmation: { ...m.confirmation, busy: false, status: 'failed', resultMessage: err.message },
      }));
    }
  }

  async function decidePending(action, confirm) {
    try {
      if (confirm) await aiService.confirmAction(action.actionId);
      else await aiService.cancelAction(action.actionId);
    } finally {
      setPending((prev) => prev.filter((p) => p.actionId !== action.actionId));
    }
  }

  function newChat() {
    localStorage.removeItem(CONVERSATION_KEY);
    setConversationId(null);
    setMessages([WELCOME]);
  }

  function pickSuggestion(friend) {
    setInput((prev) => prev.replace(/@([^\s@]*)$/, `${friend.name} `));
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-90px)] bg-[#101522] border border-[#1e2638] rounded-2xl overflow-hidden shadow-2xl">
      <div className="px-5 py-3.5 border-b border-[#1e2638] bg-[#0c101a] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-bold text-sm">
            AI
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">Splity Assistant</h1>
            <p className="text-[11px] text-slate-400">Answers come from your live data. Changes need your confirmation.</p>
          </div>
        </div>
        <button onClick={newChat} className="text-xs px-3 py-1.5 rounded-lg border border-[#2a3550] text-slate-300 hover:bg-[#1a2235]">
          New chat
        </button>
      </div>

      {pending.length > 0 && (
        <div className="px-5 py-2.5 border-b border-amber-500/20 bg-amber-950/20 text-xs space-y-1.5">
          <div className="font-semibold text-amber-300">Waiting for your approval</div>
          {pending.map((p) => (
            <div key={p.actionId} className="flex items-center justify-between gap-3">
              <span className="text-slate-300">{p.summary}</span>
              <span className="flex gap-1.5 shrink-0">
                <button onClick={() => decidePending(p, true)} className="px-2 py-1 rounded bg-emerald-600 text-white">
                  Approve
                </button>
                <button onClick={() => decidePending(p, false)} className="px-2 py-1 rounded border border-[#2a3550] text-slate-300">
                  Reject
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-md'
                  : `bg-[#161d2e] border ${m.error ? 'border-amber-500/40' : 'border-[#222c42]'} text-slate-200 rounded-bl-md`
              }`}
            >
              {m.role === 'assistant' && <ToolChips tools={m.tools} />}
              {m.role === 'assistant' ? (
                m.text ? (
                  <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
                ) : (
                  m.streaming && <span className="text-slate-500 animate-pulse">Thinking…</span>
                )
              ) : (
                <span className="whitespace-pre-wrap">{m.text}</span>
              )}
              {m.confirmation && (
                <ConfirmationCard
                  card={m.confirmation}
                  onConfirm={() => decide(m.id, m.confirmation, true)}
                  onCancel={() => decide(m.id, m.confirmation, false)}
                />
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="px-5 pt-2 flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => send(p)}
            disabled={busy}
            className="text-[11px] px-2.5 py-1 rounded-full border border-[#2a3550] text-slate-300 hover:bg-[#1a2235] disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>

      <form
        className="relative p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-4 mb-1 w-64 rounded-lg border border-[#2a3550] bg-[#0f1422] shadow-xl overflow-hidden">
            {suggestions.map((f) => (
              <button
                type="button"
                key={f.id}
                onClick={() => pickSuggestion(f)}
                className="block w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-[#1a2235]"
              >
                {f.name} <span className="text-xs text-slate-500">{f.email}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={2000}
            placeholder="Ask anything… type @ to mention a friend"
            className="flex-1 bg-[#0c101a] border border-[#222c42] rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold"
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
