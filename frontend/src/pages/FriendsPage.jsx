import React, { useState, useEffect } from 'react';
import { friendService, userService } from '../services/api';

export default function FriendsPage() {
  const [friends, setFriends] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addSuccess, setAddSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFriends();
  }, []);

  async function loadFriends() {
    setLoading(true);
    try {
      const data = await friendService.getFriends();
      setFriends(data || []);
    } catch (err) {
      console.error('Failed to load friends:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e) {
    const val = e.target.value;
    setSearchTerm(val);
    if (val.length >= 2) {
      try {
        const results = await userService.searchUsers(val);
        setSearchResults(results || []);
      } catch (err) {
        console.error(err);
      }
    } else {
      setSearchResults([]);
    }
  }

  async function handleAddFriend(friendId) {
    try {
      setError('');
      await friendService.addFriend({ friendId });
      setAddSuccess('Friend added successfully!');
      setSearchTerm('');
      setSearchResults([]);
      loadFriends();
      setTimeout(() => setAddSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to add friend');
    }
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Friends & Connections</h1>
        <p className="text-xs text-slate-400 mt-0.5">Manage friendships, search people, and split shared expenses</p>
      </div>

      {addSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs font-medium">
          ✓ {addSuccess}
        </div>
      )}
      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Add Friend Search Card */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-4 shadow-sm relative">
        <label className="block text-xs font-semibold text-slate-300 mb-2">Find & Add Friends</label>
        <input
          type="text"
          value={searchTerm}
          onChange={handleSearch}
          placeholder="Search by name, email, or phone number..."
          className="w-full px-3.5 py-2 bg-[#182030] border border-[#222d42] rounded-lg text-slate-100 text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />

        {searchResults.length > 0 && (
          <div className="mt-2 bg-[#182030] border border-[#263452] rounded-lg overflow-hidden shadow-xl">
            {searchResults.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-2.5 border-b border-[#222d42] last:border-0 hover:bg-[#202b42]">
                <div>
                  <p className="text-xs font-semibold text-slate-200">{u.name}</p>
                  <p className="text-[11px] text-slate-400">{u.email} {u.phone ? `• ${u.phone}` : ''}</p>
                </div>
                <button
                  onClick={() => handleAddFriend(u.id)}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition"
                >
                  + Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Friends List */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Connected Friends ({friends.length})
        </h2>

        {loading ? (
          <div className="py-6 text-center text-xs text-slate-400">
            <span className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2 align-middle"></span>
            Loading friends...
          </div>
        ) : friends.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No friends added yet. Use the search bar above to connect with people!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {friends.map((f) => (
              <div key={f.id || f.friend_id} className="flex items-center space-x-3 p-3 bg-[#182030] rounded-lg border border-[#222d42] hover:border-[#2e3e5c] transition">
                <div className="w-8 h-8 bg-indigo-600/20 border border-indigo-500/30 rounded-full flex items-center justify-center text-indigo-400 font-bold text-xs">
                  {f.name ? f.name.charAt(0).toUpperCase() : 'F'}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-slate-200 truncate">{f.name}</h3>
                  <p className="text-[11px] text-slate-400 truncate">{f.email}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
