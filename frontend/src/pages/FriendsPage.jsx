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
    try {
      const data = await friendService.getFriends();
      setFriends(data);
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
        setSearchResults(results);
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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Friends</h1>
        <p className="text-gray-400 text-sm mt-1">Manage friend relationships and split expenses</p>
      </div>

      {addSuccess && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
          {addSuccess}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Add Friend Search Card */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm relative">
        <h2 className="text-lg font-semibold text-white mb-3">Find & Add Friends</h2>
        <input
          type="text"
          value={searchTerm}
          onChange={handleSearch}
          placeholder="Search users by name, email, or phone number..."
          className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />

        {searchResults.length > 0 && (
          <div className="mt-2 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden shadow-lg">
            {searchResults.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-3 border-b border-gray-800 last:border-0 hover:bg-gray-800">
                <div>
                  <p className="text-sm font-medium text-white">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.email} {u.phone ? `• ${u.phone}` : ''}</p>
                </div>
                <button
                  onClick={() => handleAddFriend(u.id)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-medium"
                >
                  Add Friend
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Friends List */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-4">Your Friends ({friends.length})</h2>
        {loading ? (
          <p className="text-gray-400 text-sm">Loading friends...</p>
        ) : friends.length === 0 ? (
          <p className="text-gray-400 text-sm">No friends added yet. Search above to connect with friends!</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {friends.map((f) => (
              <div key={f.id || f.friend_id} className="flex items-center space-x-3 p-4 bg-gray-700/50 rounded-lg border border-gray-700">
                <div className="w-10 h-10 bg-blue-600/30 rounded-full flex items-center justify-center text-blue-400 font-bold">
                  {f.name ? f.name.charAt(0).toUpperCase() : 'F'}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{f.name}</h3>
                  <p className="text-xs text-gray-400">{f.email}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
