import { expenseIntentChain, categorizationChain } from '../ai/langchainConfig.js';
import { listExpensesTool, getAnalyticsTool, listFriendsTool } from '../ai/tools.js';

export class GeminiExpenseAssistant {
  async processUserMessage(message, userContext) {
    if (userContext.pendingConfirmation && (
      message.toLowerCase().includes('yes') || 
      message.toLowerCase().includes('confirm') ||
      message.toLowerCase().includes('correct') ||
      message.toLowerCase().includes('looks good') ||
      message.toLowerCase().includes('ok') ||
      message.toLowerCase().includes('sure')
    )) {
      return {
        type: 'expense_split',
        intent: 'User confirmed the expense split',
        data: userContext.pendingConfirmation,
        needsConfirmation: false
      };
    }

    const userName = userContext.userName || 'User';
    const friendsList = (userContext.friends || []).map(f => f.name).join(', ') || 'None';

    let historyText = 'None';
    if (userContext.conversationHistory && userContext.conversationHistory.length > 0) {
      historyText = userContext.conversationHistory.map(msg => 
        `${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
      ).join('\n');
    }

    try {
      // Execute LangChain Expense Intent Runnable Chain with structured Zod output
      const result = await expenseIntentChain.invoke({
        userName,
        friendsList,
        history: historyText,
        message
      });

      // Handle Intent routing to tools if needed
      if (result.type === 'analytics') {
        const toolOutput = await getAnalyticsTool.invoke({ userId: userContext.userId });
        return {
          type: 'analytics',
          intent: result.intent,
          message: `Here is your spending analysis: ${toolOutput}`
        };
      }

      if (result.type === 'friend_info') {
        const friends = await listFriendsTool.invoke({ userId: userContext.userId });
        return {
          type: 'friend_info',
          intent: result.intent,
          message: `Your friends list: ${friends}`
        };
      }

      return result;
    } catch (error) {
      console.error('[LangChain AI Error] Failed to process message:', error);
      return {
        type: 'general_chat',
        intent: 'General response',
        message: 'I am here to help you split expenses, upload bills, and track your spending!'
      };
    }
  }

  async categorizeExpense(description, amount) {
    try {
      const result = await categorizationChain.invoke({
        description,
        amount: parseFloat(amount)
      });
      return result;
    } catch (error) {
      console.error('[LangChain Categorization Error]:', error);
      return { category: 'Other', subcategory: 'General', confidence: 0.5 };
    }
  }
}
