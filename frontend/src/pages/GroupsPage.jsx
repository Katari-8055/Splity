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
    setLoading(true);
    try {
      const [g, f] = await Promise.all([
        groupService.getGroups(),
        friendService.getFriends()
      ]);
      setGroups(g || []);
      setFriends(f || []);
    } catch (err) {
      console.error('Error loading groups:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!groupName.trim()) return;

    try {
      await groupService.createGroup({ name: groupName.trim(), members: selectedMembers });
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
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Expense Groups</h1>
          <p className="text-xs text-slate-400 mt-0.5">Manage trip, apartment, and event groups for shared splitting</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
        >
          + Create Group
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-xs text-slate-400">
          <span className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2 align-middle"></span>
          Loading groups...
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-8 text-center">
          <p className="text-xs text-slate-400">No groups created yet. Create a group to start sharing expenses!</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-3 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
          >
            + Create your first group
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => {
            const memberCount = parseInt(g.member_count || 1);
            const totalSpent = parseFloat(g.total_spent || 0);

            return (
              <Link
                key={g.id}
                to={`/groups/${g.id}`}
                className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 hover:border-indigo-500/40 transition block shadow-sm"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">
                    {(g.name || 'G').charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[11px] font-medium text-slate-400 bg-[#182030] px-2 py-0.5 rounded border border-[#222d42]">
                    {memberCount} Member{memberCount > 1 ? 's' : ''}
                  </span>
                </div>

                <h2 className="text-sm font-bold text-slate-100 truncate">{g.name}</h2>
                <div className="mt-3 pt-3 border-t border-[#1e2638] flex items-center justify-between text-xs">
                  <span className="text-slate-400">Total Spent:</span>
                  <span className="font-bold text-slate-100">${totalSpent.toFixed(2)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#121722] border border-[#1e2638] rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <h2 className="text-sm font-bold text-slate-100">Create New Group</h2>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Group Name</label>
                <input
                  type="text"
                  required
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Dargling Trip, Flatmates"
                  className="w-full px-3 py-2 bg-[#182030] border border-[#222d42] rounded-lg text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Select Friends to Add</label>
                <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-[#182030] rounded-lg border border-[#222d42]">
                  {friends.length === 0 ? (
                    <p className="text-xs text-slate-500 p-2">No friends found. Add friends first or invite later.</p>
                  ) : (
                    friends.map((f) => (
                      <label key={f.id || f.friend_id} className="flex items-center space-x-2 text-xs text-slate-300 p-1 hover:bg-[#202a40] rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedMembers.includes(f.id || f.friend_id)}
                          onChange={() => toggleMember(f.id || f.friend_id)}
                          className="rounded bg-[#121722] border-slate-700 text-indigo-600"
                        />
                        <span className="truncate">{f.name} ({f.email})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#1e2638]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 bg-[#182030] hover:bg-[#202a40] text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
