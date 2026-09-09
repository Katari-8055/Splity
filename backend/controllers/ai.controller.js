import { GeminiExpenseAssistant } from '../services/aiService.js';
import { getUser } from '../services/userService.js';
import { listFriends } from '../services/friendService.js';
import { listGroups } from '../services/groupService.js';

const assistant = new GeminiExpenseAssistant();

export async function categorize(req, res, next) {
  try {
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
    const { message, conversationHistory, pendingConfirmation } = req.body;
    const userId = req.user?.userId || req.headers['x-user-id'] || req.body.userId || 'demo-user-id';

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    let userContext = {
      userId: userId || 'demo-user-id',
      userName: 'User',
      friends: [],
      groups: [],
      conversationHistory: conversationHistory || [],
      pendingConfirmation
    };

    if (userId) {
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
    }

    const result = await assistant.processUserMessage(message, userContext);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
