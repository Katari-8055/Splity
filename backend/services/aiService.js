import { expenseIntentChain, categorizationChain } from '../ai/langchainConfig.js';
import { listExpenses, createExpenseWithSplit, getUserBalances } from './expenseService.js';
import { listFriends } from './friendService.js';
import { listGroups } from './groupService.js';
import { getSpendByCategory, getMonthlySummary } from './analyticsService.js';

export class GeminiExpenseAssistant {
  async processUserMessage(message, userContext) {
    const userId = userContext.userId || 'demo-user-id';
    const userFriends = userContext.friends || [];

    // Helper to map friend names to their real user IDs
    const resolveFriendIds = (friendNamesOrIds = [], participants = []) => {
      const resolvedIds = [];
      const namesToSearch = [
        ...friendNamesOrIds,
        ...participants.map(p => p.name)
      ].filter(Boolean);

      for (const name of namesToSearch) {
        const matchedFriend = userFriends.find(f => 
          f.id === name || 
          f.name?.toLowerCase().includes(name.toLowerCase()) || 
          name.toLowerCase().includes(f.name?.toLowerCase()) ||
          f.email?.toLowerCase() === name.toLowerCase()
        );
        if (matchedFriend && !resolvedIds.includes(matchedFriend.id)) {
          resolvedIds.push(matchedFriend.id);
        }
      }

      // If user said "all friends" or no specific match found, fallback to all friends
      if (resolvedIds.length === 0 && userFriends.length > 0 && 
         (message.toLowerCase().includes('all') || message.toLowerCase().includes('everyone') || friendNamesOrIds.length === 0)) {
        return userFriends.map(f => f.id);
      }

      return resolvedIds;
    };

    // Check if user is confirming a pending split
    const isConfirmation = userContext.pendingConfirmation && (
      message.toLowerCase().includes('yes') || 
      message.toLowerCase().includes('confirm') ||
      message.toLowerCase().includes('correct') ||
      message.toLowerCase().includes('looks good') ||
      message.toLowerCase().includes('ok') ||
      message.toLowerCase().includes('sure') ||
      message.toLowerCase().includes('save')
    );

    if (isConfirmation) {
      try {
        const pending = userContext.pendingConfirmation;
        const totalAmount = parseFloat(pending.totalAmount || pending.amount || 0);
        const category = pending.category || 'Other';
        const subcategory = pending.subcategory || 'General';
        const description = pending.description || 'Shared Expense';
        const splitType = pending.splitType || 'equal';
        const friendIds = pending.friendIds?.length > 0 ? pending.friendIds : resolveFriendIds(pending.friendIds, pending.participants);

        const created = await createExpenseWithSplit(
          userId,
          totalAmount,
          category,
          subcategory,
          description,
          friendIds,
          splitType
        );

        return {
          type: 'expense_split',
          intent: 'Expense split confirmed and saved',
          data: created,
          needsConfirmation: false,
          saved: true,
          message: `✅ Great! The expense "${description}" for $${totalAmount} has been saved and split among ${friendIds.length + 1} people.`
        };
      } catch (err) {
        console.error('[Expense Save Error]:', err);
        return {
          type: 'expense_split',
          intent: 'Error saving expense',
          needsConfirmation: false,
          message: `⚠️ Could not save expense: ${err.message}`
        };
      }
    }

    const userName = userContext.userName || 'User';
    const friendsList = userFriends.map(f => `${f.name} (id: ${f.id})`).join(', ') || 'None';

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

      // 1. Handle Expense Split Intent
      if (result.type === 'expense_split' && result.data) {
        const resolvedIds = resolveFriendIds(result.data.friendIds, result.data.participants);
        result.data.friendIds = resolvedIds;
        
        // Ensure total amount is formatted
        const amount = parseFloat(result.data.amount || result.data.totalAmount || 0);
        result.data.amount = amount;
        result.data.totalAmount = amount;

        // If participants were generated, map friend names clearly
        if (!result.data.participants || result.data.participants.length === 0) {
          const splitCount = (resolvedIds.length > 0 ? resolvedIds.length : 1) + 1;
          const perPerson = parseFloat((amount / splitCount).toFixed(2));
          result.data.participants = [
            { name: userName, amount: perPerson },
            ...resolvedIds.map(fId => {
              const fObj = userFriends.find(f => f.id === fId);
              return { name: fObj?.name || 'Friend', amount: perPerson };
            })
          ];
        }

        result.needsConfirmation = true;
        return result;
      }

      // 2. Handle Balances & Debts Intent
      if (result.type === 'friend_balances') {
        const balanceData = await getUserBalances(userId);
        let msg = `💰 **Your Balance Summary:**\n`;
        msg += `• Total You Are Owed: $${balanceData.totalYouAreOwed.toFixed(2)}\n`;
        msg += `• Total You Owe: $${balanceData.totalYouOwe.toFixed(2)}\n`;
        msg += `• Net Balance: **${balanceData.netBalance >= 0 ? '+' : ''}$${balanceData.netBalance.toFixed(2)}**\n\n`;

        if (balanceData.balances.length > 0) {
          msg += `**Friends Breakdown:**\n`;
          balanceData.balances.forEach(b => {
            if (b.balance > 0) {
              msg += `• **${b.friendName}** owes you **$${b.balance.toFixed(2)}**\n`;
            } else if (b.balance < 0) {
              msg += `• You owe **${b.friendName}** **$${Math.abs(b.balance).toFixed(2)}**\n`;
            } else {
              msg += `• **${b.friendName}**: Settled up ($0.00)\n`;
            }
          });
        } else {
          msg += `No friend balances recorded yet.`;
        }

        return {
          type: 'friend_balances',
          intent: result.intent,
          message: msg,
          data: balanceData
        };
      }

      // 3. Handle Analytics Intent
      if (result.type === 'analytics') {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const categorySpend = await getSpendByCategory(userId, currentMonth, currentYear);
        const monthlySummary = await getMonthlySummary(userId);

        let totalMonthSpend = 0;
        if (categorySpend && categorySpend.length > 0) {
          totalMonthSpend = categorySpend.reduce(
            (sum, c) => sum + parseFloat(c.total || c.total_amount || 0),
            0
          );
        }

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthLabel = `${monthNames[currentMonth - 1]} ${currentYear}`;

        let msg = `💰 **Total Spent in ${monthLabel}: $${totalMonthSpend.toFixed(2)}**\n\n`;

        if (categorySpend && categorySpend.length > 0) {
          msg += `📊 **Category Breakdown:**\n`;
          categorySpend.forEach(c => {
            const amountVal = parseFloat(c.total || c.total_amount || 0);
            msg += `• **${c.category}**: $${amountVal.toFixed(2)}\n`;
          });
        } else {
          msg += `No expenses recorded for this month yet.\n`;
        }

        return {
          type: 'analytics',
          intent: result.intent,
          message: msg,
          data: { total: totalMonthSpend, categorySpend, monthlySummary }
        };
      }

      // 4. Handle List Expenses Intent
      if (result.type === 'list_expenses') {
        const expenses = await listExpenses(userId);
        let msg = `🧾 **Recent Expenses:**\n`;
        if (expenses && expenses.length > 0) {
          expenses.slice(0, 5).forEach((e, idx) => {
            msg += `${idx + 1}. **${e.description}** — $${parseFloat(e.amount).toFixed(2)} (${e.category}) on ${new Date(e.created_at).toLocaleDateString()}\n`;
          });
        } else {
          msg += `No recent expenses found.`;
        }

        return {
          type: 'list_expenses',
          intent: result.intent,
          message: msg,
          data: expenses
        };
      }

      // 5. Handle Friends Info Intent
      if (result.type === 'friend_info') {
        const friends = await listFriends(userId);
        let msg = `👥 **Your Friends List:**\n`;
        if (friends && friends.length > 0) {
          friends.forEach(f => {
            msg += `• **${f.name}** (${f.email || f.phone || 'No contact'})\n`;
          });
        } else {
          msg += `You haven't added any friends yet. Add friends on the Friends page!`;
        }

        return {
          type: 'friend_info',
          intent: result.intent,
          message: msg,
          data: friends
        };
      }

      // 6. Handle Groups Intent
      if (result.type === 'list_groups') {
        const groups = await listGroups(userId);
        let msg = `👥 **Your Groups:**\n`;
        if (groups && groups.length > 0) {
          groups.forEach(g => {
            msg += `• **${g.name}** (${g.members?.length || 0} members)\n`;
          });
        } else {
          msg += `You are not in any groups yet.`;
        }

        return {
          type: 'list_groups',
          intent: result.intent,
          message: msg,
          data: groups
        };
      }

      return result;
    } catch (error) {
      console.error('[LangChain AI Error] Failed to process message:', error);
      return {
        type: 'general_chat',
        intent: 'General response',
        message: 'I am here to help you split expenses, check balances, view analytics, and manage friends!'
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
