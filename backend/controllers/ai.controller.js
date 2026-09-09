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
      try {
        const user = await getUser(userId);
        if (user) userContext.userName = user.name;
      } catch (e) {
        console.warn('Could not fetch user details:', e.message);
      }

      try {
        userContext.friends = await listFriends(userId);
      } catch (e) {
        console.warn('Could not fetch friends list:', e.message);
      }

      try {
        userContext.groups = await listGroups(userId);
      } catch (e) {
        console.warn('Could not fetch groups list:', e.message);
      }
    }

    const result = await assistant.processUserMessage(message, userContext);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
