import React, { useState } from 'react';
import { aiService, expenseService } from '../services/api';

export default function ChatPage() {
  const [messages, setMessages] = useState([
    {
      sender: 'assistant',
      text: 'Hello! I am your AI Expense Assistant. Tell me about any expense (e.g. "I paid $40 for dinner with John and Alice") and I will split it for you!'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({
        type: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text
      }));

      const res = await aiService.parseChat(userText, history, pendingConfirmation);

      if (res.needsConfirmation) {
        setPendingConfirmation(res.data);
        setMessages((prev) => [
          ...prev,
          { sender: 'assistant', text: res.message || 'Please confirm if you would like me to process this expense split.' }
        ]);
      } else if (res.type === 'expense_split' && res.data) {
        // Automatically save expense if confirmed or parsed
        await expenseService.createExpense({
          description: res.data.description || 'AI Split Expense',
          amount: res.data.totalAmount || res.data.amount || 0,
          category: res.data.category || 'Food',
          friendIds: res.data.friendIds || []
        });

        setPendingConfirmation(null);
        setMessages((prev) => [
          ...prev,
          { sender: 'assistant', text: `✅ Expense successfully processed and saved!` }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: 'assistant', text: res.message || res.intent || 'I have processed your message.' }
        ]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => [
        ...prev,
        { sender: 'assistant', text: 'Sorry, I encountered an error processing your message.' }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-120px)] bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 bg-gray-850 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 bg-blue-600/30 rounded-full flex items-center justify-center text-blue-400 font-bold">
            🤖
          </div>
          <div>
            <h1 className="text-md font-bold text-white">AI Expense Chatbot</h1>
            <p className="text-xs text-gray-400">Natural language expense splitting & queries</p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-md p-3.5 rounded-xl text-sm ${
                m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-gray-700 text-gray-200 rounded-bl-none border border-gray-600'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-700 text-gray-400 p-3 rounded-xl text-xs animate-pulse">
              AI is thinking...
            </div>
          </div>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-gray-700 bg-gray-850 flex space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Split $60 dinner with Bob and Charlie..."
          className="flex-1 px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50 transition"
        >
          Send
        </button>
      </form>
    </div>
  );
}
