import { categorizationChain } from '../ai/langchainConfig.js';
import { mcpAgent } from '../ai/mcpAgent.js';

export class GeminiExpenseAssistant {
  async processUserMessage(message, userContext) {
    return mcpAgent.processMessage(message, userContext);
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
