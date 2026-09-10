import { GeminiExpenseAssistant } from '../services/aiService.js';
import { getUser } from '../services/userService.js';
import { listFriends } from '../services/friendService.js';
import { listGroups } from '../services/groupService.js';

const assistant = new GeminiExpenseAssistant();

export async function categorize(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { description, amount } = req.body;
    if (!description || !amount) {
      return res.status(400).json({ error: 'Description and amount required' });
    }
    const result = await assistant.categorizeExpense(description, amount);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function parseChat(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { message, conversationHistory, pendingConfirmation } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message required' });
    }

    const userContext = {
      userId,
      userName: 'User',
      friends: [],
      groups: [],
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
      pendingConfirmation
    };

    // Fetch user profile, friends, and groups in parallel for maximum speed
    const [userRes, friendsRes, groupsRes] = await Promise.allSettled([
      getUser(userId),
      listFriends(userId),
      listGroups(userId)
    ]);

    if (userRes.status === 'fulfilled' && userRes.value) {
      userContext.userName = userRes.value.name || 'User';
    }
    if (friendsRes.status === 'fulfilled' && friendsRes.value) {
      userContext.friends = friendsRes.value || [];
    }
    if (groupsRes.status === 'fulfilled' && groupsRes.value) {
      userContext.groups = groupsRes.value || [];
    }

    const result = await assistant.processUserMessage(message.trim(), userContext);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
