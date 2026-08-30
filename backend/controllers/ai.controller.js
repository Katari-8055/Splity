import { GeminiExpenseAssistant } from '../services/aiService.js';
import { getUser } from '../services/userService.js';
import { listFriends } from '../services/friendService.js';

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
    const userId = req.user?.userId || req.body.userId;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    let userContext = {
      userId: userId || 'anonymous',
      userName: 'User',
      friends: [],
      conversationHistory: conversationHistory || [],
      pendingConfirmation
    };

    if (userId) {
      const user = await getUser(userId);
      if (user) userContext.userName = user.name;
      userContext.friends = await listFriends(userId);
    }

    const result = await assistant.processUserMessage(message, userContext);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
