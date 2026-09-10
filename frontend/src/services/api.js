const API_BASE = '/api';

async function fetchAPI(endpoint, options = {}) {
  const token = localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }

  return response.json();
}

export const authService = {
  signin: (email, password) => fetchAPI('/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signup: (data) => fetchAPI('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: () => fetchAPI('/users/profile'),
  initUser: (data) => fetchAPI('/users/init', { method: 'POST', body: JSON.stringify(data) }),
};

export const userService = {
  searchUsers: (q) => fetchAPI(`/users/search?q=${encodeURIComponent(q)}`),
};

export const friendService = {
  getFriends: () => fetchAPI('/friends'),
  addFriend: (data) => fetchAPI('/friends/add', { method: 'POST', body: JSON.stringify(data) }),
  searchFriends: (prefix) => fetchAPI(`/friends/search?prefix=${encodeURIComponent(prefix)}`),
  sendReminder: (friendId, message) => fetchAPI('/friends/send-reminder', { method: 'POST', body: JSON.stringify({ friendId, message }) }),
};

export const groupService = {
  getGroups: () => fetchAPI('/groups'),
  createGroup: (data) => fetchAPI('/groups', { method: 'POST', body: JSON.stringify(data) }),
  getGroupDetails: (id) => fetchAPI(`/groups/${id}`),
  getGroupExpenses: (id) => fetchAPI(`/groups/${id}/expenses`),
  getGroupMessages: (id) => fetchAPI(`/groups/${id}/messages`),
  postGroupMessage: (id, message) => fetchAPI(`/groups/${id}/messages`, { method: 'POST', body: JSON.stringify({ message }) }),
};

export const expenseService = {
  getHistory: (filters = {}) => {
    const query = new URLSearchParams(filters).toString();
    return fetchAPI(`/expenses/history?${query}`);
  },
  getBalances: () => fetchAPI('/expenses/balances'),
  createExpense: (data) => fetchAPI('/expenses/create', { method: 'POST', body: JSON.stringify(data) }),
  aiSplit: (description, amount) => fetchAPI('/expenses/ai-split', { method: 'POST', body: JSON.stringify({ description, amount }) }),
  payExpense: (id, amount) => fetchAPI(`/expenses/${id}/pay`, { method: 'POST', body: JSON.stringify({ amount }) }),
};

export const analyticsService = {
  getDashboard: () => fetchAPI('/dashboard'),
  getAnalytics: (month, year) => fetchAPI(`/analytics?month=${month || ''}&year=${year || ''}`),
};

export const notificationService = {
  getNotifications: () => fetchAPI('/notifications'),
  acknowledge: (notificationId) => fetchAPI('/notifications/ack', { method: 'POST', body: JSON.stringify({ notificationId }) }),
};

export const billService = {
  uploadOCR: async (file) => {
    const formData = new FormData();
    formData.append('receipt', file);

    const token = localStorage.getItem('token');

    const response = await fetch('/api/bills/ocr/upload', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed: ${response.statusText}`);
    }
    return response.json();
  },
  getBill: (billId) => fetchAPI(`/bills/${billId}`),
  getUserBills: () => fetchAPI('/bills/user/me'),
};

export const parentService = {
  getChildren: () => fetchAPI('/parent/children'),
  addChild: (data) => fetchAPI('/parent/children', { method: 'POST', body: JSON.stringify(data) }),
  updateThreshold: (relationshipId, thresholdAmount) => fetchAPI(`/parent/children/${relationshipId}`, { method: 'PUT', body: JSON.stringify({ thresholdAmount }) }),
  getNotifications: () => fetchAPI('/parent/notifications'),
  getChildAnalytics: (childId) => fetchAPI(`/parent/analytics/${childId}`),
};

export const aiService = {
  parseChat: (message, conversationHistory, pendingConfirmation) =>
    fetchAPI('/ai/parse', { method: 'POST', body: JSON.stringify({ message, conversationHistory, pendingConfirmation }) }),
  categorize: (description, amount) =>
    fetchAPI('/ai/categorize', { method: 'POST', body: JSON.stringify({ description, amount }) }),
};
