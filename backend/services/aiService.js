import { expenseIntentChain, categorizationChain } from '../ai/langchainConfig.js';
import { listExpenses, createExpenseWithSplit, getUserBalances, getFriendBalance, getGroupExpenses } from './expenseService.js';
import { listFriends, addFriend } from './friendService.js';
import { createGroup, listGroups, getGroup, getGroupMembers, updateGroupMembers, addGroupMessage, getGroupMessages } from './groupService.js';
import { getSpendByCategory, getMonthlySummary } from './analyticsService.js';
import { getUserByEmail, searchAllUsers, addUser } from './userService.js';
import { v4 as uuidv4 } from 'uuid';

export class GeminiExpenseAssistant {
  async processUserMessage(message, userContext) {
    const userId = userContext.userId || 'demo-user-id';
    const userFriends = userContext.friends || [];
    const userGroups = userContext.groups || [];
    const userName = userContext.userName || 'User';

    // Helper to map friend names to their real user IDs
    const resolveFriendIds = (friendNamesOrIds = [], participants = [], includeAll = false) => {
      if (includeAll || message.toLowerCase().includes('all my friends') || message.toLowerCase().includes('all friends') || message.toLowerCase().includes('everyone')) {
        return userFriends.map(f => f.id);
      }

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

      // If specific matches found, return them
      if (resolvedIds.length > 0) {
        return resolvedIds;
      }

      // Fallback if user mentions all/everyone
      if (userFriends.length > 0 && (message.toLowerCase().includes('all') || message.toLowerCase().includes('everyone'))) {
        return userFriends.map(f => f.id);
      }

      return resolvedIds;
    };

    // Helper to match group by name or id
    const resolveGroup = async (groupNameOrId) => {
      if (!groupNameOrId) {
        // Check if message contains a UUID
        const uuidMatch = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
          const direct = await getGroup(uuidMatch[0]);
          if (direct) return direct;
        }
        return null;
      }

      // 1. Direct ID/Name DB lookup
      const direct = await getGroup(groupNameOrId);
      if (direct) return direct;

      // 2. Search in user's groups
      let matched = userGroups.find(g => 
        g.id === groupNameOrId || 
        g.name?.toLowerCase().includes(groupNameOrId.toLowerCase()) ||
        groupNameOrId.toLowerCase().includes(g.name?.toLowerCase())
      );
      if (matched) return matched;

      // 3. Try fresh DB lookup
      const freshGroups = await listGroups(userId);
      matched = freshGroups.find(g => 
        g.id === groupNameOrId || 
        g.name?.toLowerCase().includes(groupNameOrId.toLowerCase()) ||
        groupNameOrId.toLowerCase().includes(g.name?.toLowerCase())
      );
      return matched || null;
    };

    // Check if user is confirming a pending action (like an expense split)
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
        const groupId = pending.groupId || null;

        const created = await createExpenseWithSplit(
          userId,
          totalAmount,
          category,
          subcategory,
          description,
          friendIds,
          splitType,
          null,
          groupId
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

    const friendsList = userFriends.map(f => `${f.name} (id: ${f.id})`).join(', ') || 'None';
    const groupsList = userGroups.map(g => `${g.name} (id: ${g.id})`).join(', ') || 'None';

    let historyText = 'None';
    if (userContext.conversationHistory && userContext.conversationHistory.length > 0) {
      historyText = userContext.conversationHistory.map(msg => 
        `${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
      ).join('\n');
    }

    try {
      // Execute LangChain Intent & Entity Extraction Chain with Gemini
      const result = await expenseIntentChain.invoke({
        userName,
        friendsList,
        groupsList,
        history: historyText,
        message
      });

      // ==========================================
      // 1. CREATE GROUP INTENT
      // ==========================================
      if (result.type === 'create_group') {
        const rawGroupName = result.groupData?.groupName?.trim() || 'My Trip Group';
        const includeAll = result.groupData?.includeAllFriends || 
                           message.toLowerCase().includes('all my friends') || 
                           message.toLowerCase().includes('all friends') || 
                           message.toLowerCase().includes('everyone');
        
        const memberIds = resolveFriendIds(result.groupData?.memberNamesOrIds || [], [], includeAll);
        const allMembers = Array.from(new Set([userId, ...memberIds]));

        // Create the group in database
        const newGroup = await createGroup({
          name: rawGroupName,
          createdBy: userId
        });

        // Add members
        await updateGroupMembers(newGroup.id, allMembers);
        const membersList = await getGroupMembers(newGroup.id);

        const memberNames = membersList.map(m => m.name || m.email || 'Friend').join(', ');

        return {
          type: 'create_group',
          intent: `Group "${rawGroupName}" created`,
          data: {
            group: newGroup,
            members: membersList,
            memberCount: allMembers.length
          },
          needsConfirmation: false,
          message: `🎉 **Group "${rawGroupName}" has been created successfully!**\n\n` +
                   `• **Group ID**: \`${newGroup.id}\`\n` +
                   `• **Total Members**: ${allMembers.length} (${memberNames})\n` +
                   `• **Created By**: ${userName}\n\n` +
                   `You can now split expenses, post group updates, or check balances in **${rawGroupName}**.`
        };
      }

      // ==========================================
      // 2. GROUP DETAILS INTENT
      // ==========================================
      if (result.type === 'group_details') {
        const searchName = result.groupData?.groupName || result.groupData?.groupId;
        let group = await resolveGroup(searchName);

        if (!group && userGroups.length > 0) {
          // If no specific group match, use the most recent group or list all
          group = userGroups[0];
        }

        if (!group) {
          return {
            type: 'group_details',
            intent: 'Group not found',
            message: `⚠️ I couldn't find a group matching "${searchName || 'your query'}". Ask me to **create a group** or say **"List my groups"** to see your active groups.`
          };
        }

        // Fetch members, expenses, and messages in parallel
        const [members, expenses, messages] = await Promise.all([
          getGroupMembers(group.id),
          getGroupExpenses(group.id),
          getGroupMessages(group.id)
        ]);

        const totalSpent = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

        let msg = `🏔️ **Group Details: ${group.name}**\n\n`;
        msg += `• **Total Expenses**: $${totalSpent.toFixed(2)} (${expenses.length} transactions)\n`;
        msg += `• **Members (${members.length})**: ${members.map(m => m.name).join(', ') || 'None'}\n\n`;

        if (expenses.length > 0) {
          msg += `📋 **Recent Group Expenses:**\n`;
          expenses.slice(0, 4).forEach((e, i) => {
            msg += `${i + 1}. **${e.description || e.category}**: $${parseFloat(e.amount).toFixed(2)} (Paid by ${e.paid_by_name || 'Member'})\n`;
          });
        } else {
          msg += `💡 *No expenses logged in this group yet. You can say: "Add $50 hotel bill to ${group.name}"*\n`;
        }

        return {
          type: 'group_details',
          intent: `Details for ${group.name}`,
          data: {
            group,
            members,
            expenses,
            messages,
            totalSpent
          },
          message: msg
        };
      }

      // ==========================================
      // 3. LIST GROUPS INTENT
      // ==========================================
      if (result.type === 'list_groups') {
        const groups = await listGroups(userId);
        if (!groups || groups.length === 0) {
          return {
            type: 'list_groups',
            intent: 'No groups found',
            message: `You are not in any groups yet. Would you like me to create one? E.g., *"Create a group with all my friends and the group name should be Dargling Trip"*`,
            data: []
          };
        }

        let msg = `👥 **Your Active Groups (${groups.length}):**\n\n`;
        groups.forEach((g, idx) => {
          const memberCount = parseInt(g.member_count || 1);
          const totalSpent = parseFloat(g.total_spent || 0);
          msg += `${idx + 1}. **${g.name}** — ${memberCount} members | $${totalSpent.toFixed(2)} spent\n`;
        });

        msg += `\n💬 *Tip: Say "Show details of ${groups[0].name}" or "Add an expense to ${groups[0].name}"*`;

        return {
          type: 'list_groups',
          intent: 'List of groups',
          message: msg,
          data: groups
        };
      }

      // ==========================================
      // 4. ADD GROUP MEMBER INTENT
      // ==========================================
      if (result.type === 'add_group_member') {
        const group = await resolveGroup(result.groupData?.groupName);
        if (!group) {
          return {
            type: 'add_group_member',
            intent: 'Group not found',
            message: `⚠️ Please specify a valid group name. E.g. *"Add Rahul to Dargling Trip"*.`
          };
        }

        const newMemberIds = resolveFriendIds(result.groupData?.memberNamesOrIds || []);
        if (newMemberIds.length === 0) {
          return {
            type: 'add_group_member',
            intent: 'Friend not found',
            message: `⚠️ Could not find the friend specified. Please ensure they are in your friends list.`
          };
        }

        const existingMembers = await getGroupMembers(group.id);
        const existingIds = existingMembers.map(m => m.id);
        const combinedIds = Array.from(new Set([...existingIds, ...newMemberIds]));

        await updateGroupMembers(group.id, combinedIds);
        const updatedMembers = await getGroupMembers(group.id);

        return {
          type: 'add_group_member',
          intent: `Added members to ${group.name}`,
          data: { group, members: updatedMembers },
          message: `✅ Successfully added new member(s) to **${group.name}**! Total members is now ${updatedMembers.length}.`
        };
      }

      // ==========================================
      // 5. POST GROUP MESSAGE INTENT
      // ==========================================
      if (result.type === 'post_group_message') {
        const group = await resolveGroup(result.groupData?.groupName);
        const msgText = result.groupData?.message || message;

        if (!group) {
          return {
            type: 'post_group_message',
            intent: 'Group not found',
            message: `⚠️ Please specify a valid group name to post a message.`
          };
        }

        const posted = await addGroupMessage(group.id, userId, msgText);
        return {
          type: 'post_group_message',
          intent: `Message posted to ${group.name}`,
          data: posted,
          message: `💬 Posted to **${group.name}**: "${msgText}"`
        };
      }

      // ==========================================
      // 6. ADD FRIEND INTENT
      // ==========================================
      if (result.type === 'add_friend') {
        const friendName = result.friendData?.name || 'Friend';
        const friendEmail = result.friendData?.email || `${friendName.toLowerCase().replace(/\s+/g, '')}@example.com`;
        
        let friendUser = await getUserByEmail(friendEmail);
        if (!friendUser) {
          friendUser = await addUser({
            name: friendName,
            email: friendEmail,
            phone: result.friendData?.phone || null,
            role: 'user'
          });
        }

        await addFriend(userId, friendUser.id);
        await addFriend(friendUser.id, userId);

        return {
          type: 'add_friend',
          intent: `Friend ${friendName} added`,
          data: friendUser,
          message: `🤝 **${friendName}** (${friendEmail}) has been added to your friends list!`
        };
      }

      // ==========================================
      // 7. SETTLE UP INTENT
      // ==========================================
      if (result.type === 'settle_up') {
        const friendName = result.friendData?.name;
        let targetFriend = userFriends.find(f => 
          friendName && f.name.toLowerCase().includes(friendName.toLowerCase())
        );

        if (!targetFriend) {
          const balanceData = await getUserBalances(userId);
          const found = balanceData.balances.find(b => 
            friendName && b.friendName.toLowerCase().includes(friendName.toLowerCase())
          );
          if (found) {
            targetFriend = { id: found.friendId, name: found.friendName, email: found.friendEmail };
          }
        }

        if (!targetFriend && userFriends.length > 0) {
          targetFriend = userFriends[0];
        }

        if (!targetFriend) {
          return {
            type: 'settle_up',
            intent: 'Friend not found for settlement',
            message: `⚠️ Could not find friend to settle up with. Say *"Who owes me money?"* to view your active friends and balances.`
          };
        }

        const currentBalance = await getFriendBalance(userId, targetFriend.id);
        const settleAmount = result.friendData?.amount ? parseFloat(result.friendData.amount) : Math.abs(currentBalance);

        if (Math.abs(currentBalance) < 0.01 && settleAmount === 0) {
          return {
            type: 'settle_up',
            intent: `Already settled with ${targetFriend.name}`,
            saved: true,
            data: { friend: targetFriend, balance: 0, newBalance: 0, isSettled: true },
            message: `✅ You and **${targetFriend.name}** are already completely settled up ($0.00)!`
          };
        }

        const db = await (await import('../config/db.js')).connectToPostgres();
        const expenseId = uuidv4();

        if (currentBalance < 0) {
          // User owes targetFriend -> User pays targetFriend
          await db.query(
            `INSERT INTO expenses (id, user_id, category, subcategory, amount, description, created_at)
             VALUES ($1, $2, 'Settlement', 'Payment', $3, $4, NOW())`,
            [expenseId, userId, settleAmount, `Settlement payment to ${targetFriend.name}`]
          );
          await db.query(
            `INSERT INTO expense_splits (expense_id, user_id, amount)
             VALUES ($1, $2, $3)
             ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
            [expenseId, targetFriend.id, settleAmount]
          );
        } else {
          // targetFriend owes User -> targetFriend pays User
          await db.query(
            `INSERT INTO expenses (id, user_id, category, subcategory, amount, description, created_at)
             VALUES ($1, $2, 'Settlement', 'Payment', $3, $4, NOW())`,
            [expenseId, targetFriend.id, settleAmount, `Settlement payment from ${targetFriend.name}`]
          );
          await db.query(
            `INSERT INTO expense_splits (expense_id, user_id, amount)
             VALUES ($1, $2, $3)
             ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
            [expenseId, userId, settleAmount]
          );
        }

        const newBalance = await getFriendBalance(userId, targetFriend.id);

        let msg = `🤝 **Settlement Completed with ${targetFriend.name}!**\n\n`;
        if (currentBalance < 0) {
          msg += `• **Payment Recorded**: You paid **$${settleAmount.toFixed(2)}** to ${targetFriend.name}.\n`;
        } else {
          msg += `• **Payment Recorded**: Received **$${settleAmount.toFixed(2)}** from ${targetFriend.name}.\n`;
        }
        msg += `• **New Balance**: **$${Math.abs(newBalance).toFixed(2)}** ${Math.abs(newBalance) < 0.01 ? '(All Settled Up ✓)' : ''}\n\n`;
        msg += `💬 *Tip: Say "Who owes me money?" to view all updated balances.*`;

        return {
          type: 'settle_up',
          intent: `Settle up with ${targetFriend.name}`,
          saved: true,
          data: { 
            friend: targetFriend, 
            settleAmount, 
            previousBalance: currentBalance, 
            newBalance, 
            isSettled: Math.abs(newBalance) < 0.01 
          },
          message: msg
        };
      }

      // ==========================================
      // 8. EXPENSE SPLIT INTENT
      // ==========================================
      if (result.type === 'expense_split' && result.data) {
        let resolvedIds = resolveFriendIds(
          result.data.friendIds, 
          result.data.participants,
          result.data.friendIds?.length === 0 && (message.toLowerCase().includes('all') || message.toLowerCase().includes('everyone'))
        );

        // Check if group was mentioned
        let targetGroup = null;
        if (result.data.groupName || result.data.groupId) {
          targetGroup = await resolveGroup(result.data.groupName || result.data.groupId);
          if (targetGroup) {
            result.data.groupId = targetGroup.id;
            const groupMembers = await getGroupMembers(targetGroup.id);
            resolvedIds = groupMembers.map(m => m.id).filter(id => id !== userId);
          }
        }

        result.data.friendIds = resolvedIds;
        
        const amount = parseFloat(result.data.amount || result.data.totalAmount || 0);
        result.data.amount = amount;
        result.data.totalAmount = amount;

        // Generate participant breakdown
        const splitCount = (resolvedIds.length > 0 ? resolvedIds.length : 1) + 1;
        const perPerson = parseFloat((amount / splitCount).toFixed(2));
        
        result.data.participants = [
          { name: userName, amount: perPerson },
          ...resolvedIds.map(fId => {
            const fObj = userFriends.find(f => f.id === fId);
            return { name: fObj?.name || 'Friend', amount: perPerson };
          })
        ];

        result.needsConfirmation = true;
        result.message = targetGroup 
          ? `I've prepared an expense of **$${amount.toFixed(2)}** for "${result.data.description}" in group **${targetGroup.name}** ($${perPerson.toFixed(2)} per person among ${splitCount} members). Please confirm below to save.`
          : `I've prepared an expense split of **$${amount.toFixed(2)}** for "${result.data.description}" ($${perPerson.toFixed(2)} per person among ${splitCount} people). Please confirm below to save.`;

        return result;
      }

      // ==========================================
      // 9. FRIEND BALANCES INTENT
      // ==========================================
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
          msg += `No friend balances recorded yet. Add friends or split a bill to get started!`;
        }

        return {
          type: 'friend_balances',
          intent: result.intent,
          message: msg,
          data: balanceData
        };
      }

      // ==========================================
      // 10. ANALYTICS INTENT
      // ==========================================
      if (result.type === 'analytics') {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const [categorySpend, monthlySummary] = await Promise.all([
          getSpendByCategory(userId, currentMonth, currentYear),
          getMonthlySummary(userId)
        ]);

        let totalMonthSpend = 0;
        if (categorySpend && categorySpend.length > 0) {
          totalMonthSpend = categorySpend.reduce(
            (sum, c) => sum + parseFloat(c.total || c.total_amount || 0),
            0
          );
        }

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthLabel = `${monthNames[currentMonth - 1]} ${currentYear}`;

        let msg = `📊 **Spending Insights for ${monthLabel}:**\n`;
        msg += `• **Total Monthly Spend**: **$${totalMonthSpend.toFixed(2)}**\n\n`;

        if (categorySpend && categorySpend.length > 0) {
          msg += `**Category Breakdown:**\n`;
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

      // ==========================================
      // 11. LIST EXPENSES INTENT
      // ==========================================
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

      // ==========================================
      // 12. FRIEND INFO INTENT
      // ==========================================
      if (result.type === 'friend_info') {
        const friends = await listFriends(userId);
        let msg = `👥 **Your Friends List (${friends.length}):**\n`;
        if (friends && friends.length > 0) {
          friends.forEach(f => {
            msg += `• **${f.name}** (${f.email || f.phone || 'No contact'})\n`;
          });
        } else {
          msg += `You haven't added any friends yet. Say *"Add friend Rahul with email rahul@example.com"*!`;
        }

        return {
          type: 'friend_info',
          intent: result.intent,
          message: msg,
          data: friends
        };
      }

      // If LLM returned general_chat or didn't extract intent, check if message is an actionable intent
      if (result.type === 'general_chat' || !result.type) {
        const lower = message.toLowerCase().trim();
        const hasActionKeywords = 
          lower.includes('group') || lower.includes('split') || lower.includes('bill') ||
          lower.includes('friend') || lower.includes('owe') || lower.includes('balance') ||
          lower.includes('spending') || lower.includes('recent') || lower.includes('settle') ||
          /\$?\d+/.test(message);

        if (hasActionKeywords) {
          throw new Error('LLM general_chat fallback to deterministic processor');
        }
      }

      return {
        type: 'general_chat',
        intent: result.intent || 'General chat response',
        message: result.message || `👋 Hello! I am your AI Expense Assistant. I can help you with:
• 🏔️ **Groups**: *"Create a group with all my friends named Goa Trip"*
• 📋 **Group Details**: *"Show details of Goa Trip group"*
• 💸 **Splitting Bills**: *"Split $60 dinner with Rahul and Alice"*
• 💰 **Live Balances**: *"Who owes me money?"* or *"Settle up with Rahul"*
• 📊 **Analytics**: *"Show my spending breakdown"*
• 👥 **Friends**: *"Show my friends"* or *"Add friend Priya"*`
      };

    } catch (error) {
      console.warn('[AI Service] Using smart rule-based intent processor:', error.message);

      const lower = message.toLowerCase().trim();

      // ==========================================
      // 1. CREATE GROUP INTENT (Evaluated FIRST so "create group with all friends" is never matched as list friends)
      // ==========================================
      if (
        (lower.includes('group') && (lower.includes('create') || lower.includes('make') || lower.includes('start') || lower.includes('new'))) ||
        lower.includes('group name should be') ||
        lower.includes('group name is') ||
        lower.includes('group named') ||
        lower.includes('group called')
      ) {
        let groupName = 'Goa Trip';
        
        // Precise regex patterns for group name extraction
        const namePatterns = [
          /(?:group )?name (?:should be|is|to be)?\s*["']?([^"'\n,;]+?)["']?(?:\s+(?:aise|and|with|hai|trip group)|$)/i,
          /(?:named|called)\s*["']?([^"'\n,;]+?)["']?(?:\s+(?:aise|and|with|hai)|$)/i,
          /create (?:a |an )?["']?([^"'\n,;]+?)["']?\s+group/i,
          /group\s+["']?([^"'\n,;]+?)["']?\s+(?:with|for)/i
        ];

        for (const p of namePatterns) {
          const match = message.match(p);
          if (match && match[1]) {
            const candidate = match[1].replace(/["']/g, '').trim();
            if (candidate && !/^(all|my|friends|everyone|the|a|an|want to|in that group)$/i.test(candidate)) {
              groupName = candidate;
              break;
            }
          }
        }

        try {
          // Get all current friends from DB
          let currentFriends = await listFriends(userId);
          
          // If no friends exist yet, seed standard friends for demo user
          if (!currentFriends || currentFriends.length === 0) {
            const db = await (await import('../config/db.js')).connectToPostgres();
            await db.query(`
              INSERT INTO users (id, name, email, role)
              VALUES 
                ('demo-user-id', 'Demo User', 'demo@example.com', 'user'),
                ('friend-rahul', 'Rahul Sharma', 'rahul@example.com', 'user'),
                ('friend-priya', 'Priya Patel', 'priya@example.com', 'user'),
                ('friend-amit', 'Amit Verma', 'amit@example.com', 'user'),
                ('friend-alice', 'Alice Smith', 'alice@example.com', 'user')
              ON CONFLICT (id) DO NOTHING;
              INSERT INTO friends (user_id, friend_id)
              VALUES 
                ('demo-user-id', 'friend-rahul'),
                ('demo-user-id', 'friend-priya'),
                ('demo-user-id', 'friend-amit'),
                ('demo-user-id', 'friend-alice'),
                ('friend-rahul', 'demo-user-id'),
                ('friend-priya', 'demo-user-id'),
                ('friend-amit', 'demo-user-id'),
                ('friend-alice', 'demo-user-id')
              ON CONFLICT DO NOTHING;
            `);
            currentFriends = await listFriends(userId);
          }

          const includeAll = lower.includes('all') || lower.includes('friends') || lower.includes('everyone');
          const memberIds = includeAll 
            ? currentFriends.map(f => f.id)
            : resolveFriendIds([], []);

          const allMembers = Array.from(new Set([userId, ...memberIds]));

          const newGroup = await createGroup({ name: groupName, createdBy: userId });
          await updateGroupMembers(newGroup.id, allMembers);
          const membersList = await getGroupMembers(newGroup.id);

          return {
            type: 'create_group',
            intent: `Group "${groupName}" created`,
            data: { 
              group: newGroup, 
              members: membersList, 
              memberCount: membersList.length || allMembers.length 
            },
            message: `🎉 **Group "${groupName}" has been created successfully!**\n\n` +
                     `• **Total Members**: ${membersList.length || allMembers.length} (${membersList.map(m => m.name).join(', ')})\n` +
                     `• **Created By**: ${userName}\n\n` +
                     `You can now split bills or post updates in **${groupName}**!`
          };
        } catch (dbErr) {
          console.error('[Group Creation Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 2. GROUP DETAILS INTENT
      // ==========================================
      if (lower.includes('detail') || (lower.includes('group') && (lower.includes('about') || lower.includes('info') || lower.includes('show details')))) {
        try {
          let matchedGroup = null;
          for (const g of userGroups) {
            if (lower.includes(g.name.toLowerCase())) {
              matchedGroup = g;
              break;
            }
          }
          if (!matchedGroup) {
            const allDbGroups = await listGroups(userId);
            matchedGroup = allDbGroups.find(g => lower.includes(g.name.toLowerCase())) || allDbGroups[0];
          }

          if (matchedGroup) {
            const [members, expenses] = await Promise.all([
              getGroupMembers(matchedGroup.id),
              getGroupExpenses(matchedGroup.id)
            ]);
            const totalSpent = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
            let msg = `🏔️ **Group Details: ${matchedGroup.name}**\n\n`;
            msg += `• **Total Spent**: $${totalSpent.toFixed(2)} (${expenses.length} transactions)\n`;
            msg += `• **Members (${members.length})**: ${members.map(m => m.name).join(', ')}\n\n`;
            if (expenses.length > 0) {
              msg += `📋 **Recent Expenses:**\n`;
              expenses.slice(0, 4).forEach((e, i) => {
                msg += `${i + 1}. **${e.description}**: $${parseFloat(e.amount).toFixed(2)}\n`;
              });
            } else {
              msg += `💡 *No expenses logged in this group yet. You can say: "Add $50 hotel bill to ${matchedGroup.name}"*`;
            }
            return {
              type: 'group_details',
              intent: `Details for ${matchedGroup.name}`,
              data: { group: matchedGroup, members, expenses, totalSpent },
              message: msg
            };
          }
        } catch (dbErr) {
          console.error('[Group Details Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 3. LIST GROUPS INTENT
      // ==========================================
      if (
        !lower.includes('create') && (
          lower === 'groups' || lower === 'my groups' || lower === 'show groups' || lower === 'list groups' ||
          (lower.includes('group') && (lower.includes('list') || lower.includes('show all') || lower.includes('my groups') || lower.includes('what groups')))
        )
      ) {
        try {
          const groups = await listGroups(userId);
          if (!groups || groups.length === 0) {
            return {
              type: 'list_groups',
              intent: 'No groups found',
              message: `You are not in any groups yet. Say: *"Create a group with all my friends named Goa Trip"* to create one!`,
              data: []
            };
          }
          let msg = `👥 **Your Active Groups (${groups.length}):**\n\n`;
          groups.forEach((g, idx) => {
            const memberCount = parseInt(g.member_count || 1);
            const totalSpent = parseFloat(g.total_spent || 0);
            msg += `${idx + 1}. **${g.name}** — ${memberCount} members | $${totalSpent.toFixed(2)} spent\n`;
          });
          msg += `\n💬 *Tip: Say "Show details of ${groups[0].name}" or "Add $50 bill in ${groups[0].name}"*`;
          return {
            type: 'list_groups',
            intent: 'List groups',
            message: msg,
            data: groups
          };
        } catch (dbErr) {
          console.error('[List Groups Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 4. ADD FRIEND INTENT
      // ==========================================
      if (lower.includes('add friend') || lower.includes('new friend') || (lower.includes('add') && lower.includes('friend') && !lower.includes('group'))) {
        try {
          let friendName = 'Friend';
          const nameMatch = message.match(/friend\s+([A-Za-z]+)/i) || message.match(/named\s+([A-Za-z]+)/i);
          if (nameMatch && nameMatch[1]) friendName = nameMatch[1].trim();

          const friendEmail = `${friendName.toLowerCase()}@example.com`;
          let friendUser = await getUserByEmail(friendEmail);
          if (!friendUser) {
            friendUser = await addUser({ name: friendName, email: friendEmail, role: 'user' });
          }
          await addFriend(userId, friendUser.id);

          return {
            type: 'add_friend',
            intent: `Friend ${friendName} added`,
            data: friendUser,
            message: `🤝 **${friendName}** (${friendEmail}) has been added to your friends list!`
          };
        } catch (dbErr) {
          console.error('[Add Friend Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 5. SHOW / LIST FRIENDS INTENT (Only when user explicitly asks for friends list)
      // ==========================================
      if (
        lower === 'friends' || lower === 'my friends' || lower === 'show friends' || lower === 'show my friends' ||
        lower === 'list friends' || lower === 'friend list' || lower.includes('show my friends') || lower.includes('list my friends') ||
        (lower.includes('friend') && (lower.includes('show') || lower.includes('list') || lower.includes('who are')) && !lower.includes('group') && !lower.includes('split'))
      ) {
        try {
          let friends = await listFriends(userId);
          if (!friends || friends.length === 0) {
            const db = await (await import('../config/db.js')).connectToPostgres();
            await db.query(`
              INSERT INTO users (id, name, email, role)
              VALUES 
                ('demo-user-id', 'Demo User', 'demo@example.com', 'user'),
                ('friend-rahul', 'Rahul Sharma', 'rahul@example.com', 'user'),
                ('friend-priya', 'Priya Patel', 'priya@example.com', 'user'),
                ('friend-amit', 'Amit Verma', 'amit@example.com', 'user'),
                ('friend-alice', 'Alice Smith', 'alice@example.com', 'user')
              ON CONFLICT (id) DO NOTHING;
              INSERT INTO friends (user_id, friend_id)
              VALUES 
                ('demo-user-id', 'friend-rahul'),
                ('demo-user-id', 'friend-priya'),
                ('demo-user-id', 'friend-amit'),
                ('demo-user-id', 'friend-alice')
              ON CONFLICT DO NOTHING;
            `);
            friends = await listFriends(userId);
          }

          let msg = `👥 **Your Friends List (${friends.length}):**\n\n`;
          if (friends && friends.length > 0) {
            friends.forEach((f, idx) => {
              msg += `${idx + 1}. **${f.name}** (${f.email || f.phone || 'No contact'})\n`;
            });
            msg += `\n💬 *Tip: Say "Split $40 for dinner with ${friends[0].name}" or "Create a group with all my friends named Goa Trip"*`;
          } else {
            msg += `You haven't added any friends yet. Say *"Add friend Rahul with email rahul@example.com"* to add one!`;
          }
          return {
            type: 'friend_info',
            intent: 'List friends',
            message: msg,
            data: friends
          };
        } catch (dbErr) {
          console.error('[Friend Info Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 6. SETTLE UP INTENT
      // ==========================================
      if (
        lower.includes('settle') || 
        lower.includes('settled') || 
        lower.includes('paid to') || 
        lower.includes('paid back') || 
        lower.includes('clear balance') ||
        (lower.includes('paid') && (lower.includes('balram') || lower.includes('katari') || lower.includes('rahul') || lower.includes('priya') || lower.includes('amit') || lower.includes('alice')))
      ) {
        try {
          let friendName = null;
          const settleMatch = message.match(/settle(?:\s+up)?(?:\s+with)?\s+([A-Za-z0-9_-]+)/i) ||
                              message.match(/paid\s+(?:\$?\d+\s+to\s+)?([A-Za-z0-9_-]+)/i) ||
                              message.match(/clear\s+balance\s+with\s+([A-Za-z0-9_-]+)/i) ||
                              message.match(/(?:with|to)\s+([A-Za-z0-9_-]+)/i);
          if (settleMatch && settleMatch[1]) {
            const candidate = settleMatch[1].trim();
            if (!/^(up|with|my|the|all|a|an|money|friend|him|her)$/i.test(candidate)) {
              friendName = candidate;
            }
          }

          let targetFriend = null;
          if (friendName) {
            targetFriend = userFriends.find(f => f.name?.toLowerCase().includes(friendName.toLowerCase()));
            if (!targetFriend) {
              const balanceData = await getUserBalances(userId);
              const found = balanceData.balances.find(b => b.friendName?.toLowerCase().includes(friendName.toLowerCase()));
              if (found) {
                targetFriend = { id: found.friendId, name: found.friendName, email: found.friendEmail };
              }
            }
          }

          if (!targetFriend) {
            const balanceData = await getUserBalances(userId);
            const activeDebt = balanceData.balances.find(b => b.balance !== 0);
            if (activeDebt) {
              targetFriend = { id: activeDebt.friendId, name: activeDebt.friendName, email: activeDebt.friendEmail };
            } else if (userFriends.length > 0) {
              targetFriend = userFriends[0];
            }
          }

          if (!targetFriend) {
            return {
              type: 'settle_up',
              intent: 'Friend not found',
              message: `⚠️ Could not find the friend to settle with. Say *"Who owes me money?"* to see your active friends and balances.`
            };
          }

          const currentBalance = await getFriendBalance(userId, targetFriend.id);
          const amountMatch = message.match(/[$₹€£]?\s*(\d+(?:\.\d{1,2})?)/);
          const settleAmount = amountMatch ? parseFloat(amountMatch[1]) : Math.abs(currentBalance);

          if (Math.abs(currentBalance) < 0.01 && settleAmount === 0) {
            return {
              type: 'settle_up',
              intent: `Already settled with ${targetFriend.name}`,
              saved: true,
              data: { friend: targetFriend, balance: 0, newBalance: 0, isSettled: true },
              message: `✅ You and **${targetFriend.name}** are already completely settled up ($0.00)!`
            };
          }

          const db = await (await import('../config/db.js')).connectToPostgres();
          const expenseId = uuidv4();

          if (currentBalance < 0) {
            // User owes targetFriend -> User pays targetFriend
            await db.query(
              `INSERT INTO expenses (id, user_id, category, subcategory, amount, description, created_at)
               VALUES ($1, $2, 'Settlement', 'Payment', $3, $4, NOW())`,
              [expenseId, userId, settleAmount, `Settlement payment to ${targetFriend.name}`]
            );
            await db.query(
              `INSERT INTO expense_splits (expense_id, user_id, amount)
               VALUES ($1, $2, $3)
               ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
              [expenseId, targetFriend.id, settleAmount]
            );
          } else {
            // targetFriend owes User -> targetFriend pays User
            await db.query(
              `INSERT INTO expenses (id, user_id, category, subcategory, amount, description, created_at)
               VALUES ($1, $2, 'Settlement', 'Payment', $3, $4, NOW())`,
              [expenseId, targetFriend.id, settleAmount, `Settlement payment from ${targetFriend.name}`]
            );
            await db.query(
              `INSERT INTO expense_splits (expense_id, user_id, amount)
               VALUES ($1, $2, $3)
               ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
              [expenseId, userId, settleAmount]
            );
          }

          const newBalance = await getFriendBalance(userId, targetFriend.id);

          let msg = `🤝 **Settlement Completed with ${targetFriend.name}!**\n\n`;
          if (currentBalance < 0) {
            msg += `• **Payment Recorded**: You paid **$${settleAmount.toFixed(2)}** to ${targetFriend.name}.\n`;
          } else {
            msg += `• **Payment Recorded**: Received **$${settleAmount.toFixed(2)}** from ${targetFriend.name}.\n`;
          }
          msg += `• **New Balance**: **$${Math.abs(newBalance).toFixed(2)}** ${Math.abs(newBalance) < 0.01 ? '(All Settled Up ✓)' : ''}\n\n`;
          msg += `💬 *Tip: Say "Who owes me money?" to view all updated balances.*`;

          return {
            type: 'settle_up',
            intent: `Settlement recorded with ${targetFriend.name}`,
            saved: true,
            data: { 
              friend: targetFriend, 
              settleAmount, 
              previousBalance: currentBalance, 
              newBalance, 
              isSettled: Math.abs(newBalance) < 0.01 
            },
            message: msg
          };
        } catch (dbErr) {
          console.error('[Settle Up Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 7. BALANCES & DEBTS INTENT
      // ==========================================
      if (lower.includes('owe') || lower.includes('balance') || lower.includes('debt')) {
        try {
          const balanceData = await getUserBalances(userId);
          let msg = `💰 **Your Balance Summary:**\n\n`;
          msg += `• **Total You Are Owed**: $${balanceData.totalYouAreOwed.toFixed(2)}\n`;
          msg += `• **Total You Owe**: $${balanceData.totalYouOwe.toFixed(2)}\n`;
          msg += `• **Net Balance**: **${balanceData.netBalance >= 0 ? '+' : ''}$${balanceData.netBalance.toFixed(2)}**\n\n`;

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
            msg += `No active balances found. Split a bill to get started!`;
          }

          return {
            type: 'friend_balances',
            intent: 'Balance summary',
            message: msg,
            data: balanceData
          };
        } catch (dbErr) {
          console.error('[Balances Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 7. ANALYTICS INTENT
      // ==========================================
      if (lower.includes('spending') || lower.includes('breakdown') || lower.includes('analytics') || lower.includes('expense history') || lower.includes('insights')) {
        try {
          const now = new Date();
          const currentMonth = now.getMonth() + 1;
          const currentYear = now.getFullYear();
          const [categorySpend, monthlySummary] = await Promise.all([
            getSpendByCategory(userId, currentMonth, currentYear),
            getMonthlySummary(userId)
          ]);
          let totalMonthSpend = 0;
          if (categorySpend && categorySpend.length > 0) {
            totalMonthSpend = categorySpend.reduce((sum, c) => sum + parseFloat(c.total || c.total_amount || 0), 0);
          }
          let msg = `📊 **Monthly Spending Breakdown:**\n\n`;
          msg += `• **Total Monthly Spend**: **$${totalMonthSpend.toFixed(2)}**\n\n`;
          if (categorySpend && categorySpend.length > 0) {
            msg += `**Category Breakdown:**\n`;
            categorySpend.forEach(c => {
              msg += `• **${c.category}**: $${parseFloat(c.total || c.total_amount || 0).toFixed(2)}\n`;
            });
          }
          return {
            type: 'analytics',
            intent: 'Spending analytics',
            message: msg,
            data: { total: totalMonthSpend, categorySpend, monthlySummary }
          };
        } catch (dbErr) {
          console.error('[Analytics Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 8. LIST RECENT EXPENSES INTENT
      // ==========================================
      if (lower.includes('recent') || lower.includes('transaction') || lower.includes('my expense') || lower.includes('expenses')) {
        try {
          const expenses = await listExpenses(userId);
          let msg = `🧾 **Recent Expenses (${expenses?.length || 0}):**\n\n`;
          if (expenses && expenses.length > 0) {
            expenses.slice(0, 5).forEach((e, idx) => {
              msg += `${idx + 1}. **${e.description}** — $${parseFloat(e.amount).toFixed(2)} (${e.category})\n`;
            });
          } else {
            msg += `No recent expenses logged yet.`;
          }
          return {
            type: 'list_expenses',
            intent: 'Recent expenses',
            message: msg,
            data: expenses
          };
        } catch (dbErr) {
          console.error('[Expenses Fallback Error]:', dbErr);
        }
      }

      // ==========================================
      // 9. EXPENSE SPLIT INTENT
      // ==========================================
      const splitAmountMatch = message.match(/[$₹€£]?\s*(\d+(?:\.\d{1,2})?)/);
      if (
        (splitAmountMatch && (lower.includes('split') || lower.includes('paid') || lower.includes('bill') || lower.includes('expense') || lower.includes('hotel') || lower.includes('dinner'))) ||
        (lower.includes('split') || lower.includes('add expense') || lower.includes('add bill'))
      ) {
        const amount = splitAmountMatch ? parseFloat(splitAmountMatch[1]) : 50;
        let desc = message.replace(/[$₹€£]?\s*\d+(?:\.\d{1,2})?/, '').replace(/split|add|expense|bill|with|for|in group|group/gi, '').trim() || 'Shared Bill';

        // Check if group is mentioned
        let targetGroup = null;
        for (const g of userGroups) {
          if (lower.includes(g.name.toLowerCase())) {
            targetGroup = g;
            break;
          }
        }
        if (!targetGroup) {
          const allGroups = await listGroups(userId);
          targetGroup = allGroups.find(g => lower.includes(g.name.toLowerCase()));
        }

        let friendIds = [];
        if (targetGroup) {
          const groupMembers = await getGroupMembers(targetGroup.id);
          friendIds = groupMembers.map(m => m.id).filter(id => id !== userId);
        } else {
          friendIds = resolveFriendIds([], [], lower.includes('all') || lower.includes('friends'));
        }

        const splitCount = (friendIds.length > 0 ? friendIds.length : 1) + 1;
        const perPerson = parseFloat((amount / splitCount).toFixed(2));

        const dataObj = {
          amount,
          totalAmount: amount,
          description: desc,
          category: lower.includes('hotel') ? 'Accommodation' : lower.includes('dinner') || lower.includes('food') ? 'Food' : 'General',
          subcategory: 'General',
          splitType: 'equal',
          groupId: targetGroup ? targetGroup.id : null,
          groupName: targetGroup ? targetGroup.name : null,
          friendIds,
          participants: [
            { name: userName, amount: perPerson },
            ...friendIds.map(fId => {
              const f = userFriends.find(fr => fr.id === fId);
              return { name: f?.name || 'Member', amount: perPerson };
            })
          ]
        };

        return {
          type: 'expense_split',
          intent: `Split $${amount.toFixed(2)} for ${desc}`,
          needsConfirmation: true,
          data: dataObj,
          message: targetGroup
            ? `I've prepared an expense of **$${amount.toFixed(2)}** for "${desc}" in group **${targetGroup.name}** ($${perPerson.toFixed(2)} per person among ${splitCount} members). Please confirm below to save.`
            : `I've prepared an expense split of **$${amount.toFixed(2)}** for "${desc}" ($${perPerson.toFixed(2)} per person among ${splitCount} people). Please confirm below to save.`
        };
      }

      return {
        type: 'general_chat',
        intent: 'General response',
        message: `👋 Hello! I am ready to assist you. You can ask me to:
• 👥 **Friends**: *"Show my friends"* or *"Add friend Priya"*
• 🏔️ **Groups**: *"Create a group with all my friends named Goa Trip"*
• 📋 **Group Details**: *"Show details of Goa Trip group"*
• 💸 **Split Expenses**: *"Split $60 dinner with Rahul and Alice"*
• 💰 **Balances**: *"Who owes me money?"* or *"Settle up with Rahul"*
• 📊 **Analytics**: *"Show my spending breakdown"*`
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

