import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { groupService, friendService } from '../services/api';

export default function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [friends, setFriends] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const g = await groupService.getGroups();
      const f = await friendService.getFriends();
      setGroups(g);
      setFriends(f);
    } catch (err) {
      console.error('Error loading groups:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!groupName) return;

    try {
      await groupService.createGroup({ name: groupName, members: selectedMembers });
      setGroupName('');
      setSelectedMembers([]);
      setShowModal(false);
      loadData();
    } catch (err) {
      console.error('Failed to create group:', err);
    }
  }

  function toggleMember(id) {
    if (selectedMembers.includes(id)) {
      setSelectedMembers(selectedMembers.filter((m) => m !== id));
    } else {
      setSelectedMembers([...selectedMembers, id]);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Groups</h1>
          <p className="text-gray-400 text-sm mt-1">Manage shared expense groups</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm transition"
        >
          Create Group
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading groups...</p>
      ) : groups.length === 0 ? (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-400">
          No groups created yet. Create a group to start sharing expenses with friends!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {groups.map((g) => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-blue-500/50 transition block shadow-sm"
            >
              <div className="w-10 h-10 bg-purple-600/30 rounded-lg flex items-center justify-center text-purple-400 font-bold text-lg mb-3">
                {g.name.charAt(0).toUpperCase()}
              </div>
              <h2 className="text-lg font-semibold text-white">{g.name}</h2>
              <p className="text-xs text-gray-400 mt-1">Created: {new Date(g.created_at || Date.now()).toLocaleDateString()}</p>
            </Link>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Create New Group</h2>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Group Name</label>
                <input
                  type="text"
                  required
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Trip to Goa, Apartment Rent"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Select Friends to Add</label>
                <div className="max-h-40 overflow-y-auto space-y-2 p-2 bg-gray-900 rounded-lg border border-gray-700">
                  {friends.map((f) => (
                    <label key={f.id || f.friend_id} className="flex items-center space-x-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={selectedMembers.includes(f.id || f.friend_id)}
                        onChange={() => toggleMember(f.id || f.friend_id)}
                        className="rounded bg-gray-800 border-gray-600 text-blue-600"
                      />
                      <span>{f.name} ({f.email})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
