import { llm } from "./langchainConfig.js";
import { mcpClient } from "../mcp/mcpClient.js";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

export class SpendSavvyMcpAgent {
  constructor() {
    this.maxIterations = 5;
  }

  /**
   * Main entry point to process a conversational user request via MCP Tools
   */
  async processMessage(userMessage, userContext = {}) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    if (!userContext || !userContext.userId) {
      throw new Error('Authenticated user context is required to execute AI Agent.');
    }
    const userId = userContext.userId;
    const userName = userContext.userName || "User";
    const startTime = Date.now();

    console.log(`[AI Agent ${requestId}] Processing query for user "${userName}" (${userId}): "${userMessage}"`);

    // 1. Check for Pending Confirmation (Two-Phase Mutation Protocol)
    // Only execute if there is a pending confirmation AND the user's message is an explicit confirmation (not a modification)
    if (userContext.pendingConfirmation && this.isConfirmationMessage(userMessage)) {
      return this.executeConfirmedAction(userContext.pendingConfirmation, userId, userName);
    }

    try {
      // 2. Load MCP Tools for this authenticated user
      const tools = await mcpClient.getLangChainTools(userId);
      const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

      // Bind tools to Gemini LLM
      const modelWithTools = llm.bindTools(tools);

      // 3. Construct System Prompt with live context
      const systemPrompt = this.buildSystemPrompt(userContext);

      // Build message trajectory
      const messages = [
        new SystemMessage(systemPrompt),
        ...(this.formatHistory(userContext.conversationHistory || [])),
        new HumanMessage(userMessage),
      ];

      let iterations = 0;
      const toolCallsExecuted = [];
      let lastToolName = null;
      let lastToolData = null;

      while (iterations < this.maxIterations) {
        iterations++;
        const aiResponse = await modelWithTools.invoke(messages);
        messages.push(aiResponse);

        // Check if LLM wants to call tools
        if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
          // Final conversational response reached
          const latency = Date.now() - startTime;
          console.log(`[AI Agent ${requestId}] Completed in ${latency}ms across ${iterations} iterations with tools:`, toolCallsExecuted);

          let responseType = "agent_response";
          if (lastToolName === "get_user_balances") responseType = "friend_balances";
          else if (lastToolName === "list_groups") responseType = "list_groups";
          else if (lastToolName === "list_friends" || lastToolName === "search_friends") responseType = "friend_info";
          else if (lastToolName === "get_group_details") responseType = "group_details";
          else if (lastToolName === "settle_up") responseType = "settle_up";
          else if (lastToolName === "create_group") responseType = "create_group";
          else if (lastToolName === "get_spending_by_category" || lastToolName === "get_monthly_summary" || lastToolName === "get_category_spending") responseType = "analytics";
          else if (lastToolName === "list_expenses") responseType = "list_expenses";

          return {
            type: responseType,
            message: aiResponse.content || "I have processed your request.",
            data: lastToolData,
            toolCalls: toolCallsExecuted,
            latency,
          };
        }

        // Execute each requested tool sequentially
        for (const toolCall of aiResponse.tool_calls) {
          const { name, args } = toolCall;
          console.log(`[AI Agent ${requestId}] Tool Request: "${name}" with args:`, JSON.stringify(args));
          toolCallsExecuted.push(name);
          lastToolName = name;

          // Guardrail: Intercept write mutations that require user confirmation
          if (this.requiresConfirmation(name, args, userMessage)) {
            return this.prepareMutationConfirmation(name, args, userId, userName, userMessage);
          }

          const targetTool = toolsByName[name];
          let toolResultStr;
          if (targetTool) {
            try {
              toolResultStr = await targetTool.func(args);
              try {
                lastToolData = JSON.parse(toolResultStr);
              } catch {
                lastToolData = toolResultStr;
              }
            } catch (err) {
              toolResultStr = JSON.stringify({ error: err.message });
              lastToolData = { error: err.message };
            }
          } else {
            toolResultStr = JSON.stringify({ error: `Tool ${name} not found` });
            lastToolData = { error: `Tool ${name} not found` };
          }

          messages.push(
            new ToolMessage({
              content: toolResultStr,
              tool_call_id: toolCall.id || name,
            })
          );
        }
      }

      // Max iterations reached fallback
      const finalMsg = messages[messages.length - 1];
      return {
        type: "agent_response",
        message: finalMsg.content || "I've gathered the information for your request.",
        data: lastToolData,
        toolCalls: toolCallsExecuted,
      };
    } catch (agentError) {
      console.warn(`[AI Agent ${requestId}] Gemini tool execution failed (${agentError.message}). Engaging fallback...`);
      return this.handleFallback(userMessage, userContext, agentError);
    }
  }

  /**
   * Check if a message is an explicit affirmative confirmation,
   * while rejecting messages that attempt to modify arguments (e.g. "actually $70").
   */
  isConfirmationMessage(text = "") {
    const lower = text.toLowerCase().trim();
    
    // If the message contains modification cues, it's not a simple confirmation
    if (
      lower.includes("actually") ||
      lower.includes("change to") ||
      lower.includes("make it") ||
      lower.includes("instead of") ||
      lower.includes("instead") ||
      lower.includes("no,") ||
      lower.startsWith("no ") ||
      lower === "no" ||
      lower === "cancel" ||
      lower.includes("cancel")
    ) {
      return false;
    }

    return (
      lower === "yes" ||
      lower === "y" ||
      lower === "confirm" ||
      lower === "sure" ||
      lower === "ok" ||
      lower === "okay" ||
      lower === "proceed" ||
      lower === "looks good" ||
      lower === "save" ||
      lower === "yes please" ||
      lower === "yes, confirm" ||
      lower === "confirm and save" ||
      lower.startsWith("yes,") ||
      lower.startsWith("yes ") ||
      lower.includes("confirm and save") ||
      lower.includes("save this expense") ||
      lower.includes("confirm this") ||
      lower.includes("proceed with")
    );
  }

  /**
   * Universal Write Gate: Any tool that alters database state requires confirmation.
   */
  requiresConfirmation(toolName, args, userMessage) {
    const mutatingTools = [
      "create_expense_with_split",
      "settle_up",
      "create_group",
      "add_friend",
      "acknowledge_notification",
      "upload_receipt",
      "add_user"
    ];
    return mutatingTools.includes(toolName);
  }

  /**
   * Build strongly-typed pending confirmation payloads for mutating tools.
   */
  async prepareMutationConfirmation(toolName, args, userId, userName, userMessage) {
    const nonce = `act_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    if (toolName === "create_expense_with_split") {
      const amount = parseFloat(args.amount);
      if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
        return {
          type: "agent_response",
          needsConfirmation: false,
          message: "What was the total amount for the expense?",
        };
      }

      const friendIds = Array.isArray(args.friendIds) ? args.friendIds : [];
      if (friendIds.length === 0) {
        return {
          type: "agent_response",
          needsConfirmation: false,
          message: "Who would you like to split this expense with?",
        };
      }

      const totalParticipants = friendIds.length + 1;
      const perPerson = (amount / totalParticipants).toFixed(2);
      const description = (args.description || "Expense").trim();
      const category = (args.category || "General").trim();

      return {
        type: "expense_split",
        needsConfirmation: true,
        pendingConfirmation: {
          nonce,
          action: "create_expense_with_split",
          toolArgs: { ...args, userId, amount, description, category, friendIds },
          userId,
          amount,
          description,
          category,
          friendIds,
          perPerson,
          createdAt: Date.now(),
        },
        data: {
          description,
          amount,
          category,
          splitType: args.splitType || "equal",
          friendIds,
        },
        message: `I've prepared an expense of **$${amount.toFixed(2)}** for "${description}" ($${perPerson} per person among ${totalParticipants} people).\n\n**Please confirm to save this to your records.**`,
      };
    }

    if (toolName === "settle_up") {
      if (!args.friendId) {
        return {
          type: "agent_response",
          needsConfirmation: false,
          message: "Which friend would you like to settle up with?",
        };
      }

      const customAmount = args.amount ? parseFloat(args.amount) : null;
      const amountLabel = customAmount ? `$${customAmount.toFixed(2)}` : "the outstanding balance";

      return {
        type: "settle_up_confirmation",
        needsConfirmation: true,
        pendingConfirmation: {
          nonce,
          action: "settle_up",
          toolArgs: { ...args, userId },
          userId,
          friendId: args.friendId,
          amount: customAmount,
          createdAt: Date.now(),
        },
        message: `I'm ready to record a settlement payment for **${amountLabel}** with your friend. \n\n**Please confirm to execute this payment.**`,
      };
    }

    if (toolName === "create_group") {
      const groupName = (args.name || "").trim();
      if (!groupName) {
        return {
          type: "agent_response",
          needsConfirmation: false,
          message: "What would you like to name the group?",
        };
      }

      const memberCount = (args.members || []).length + 1;

      return {
        type: "create_group_confirmation",
        needsConfirmation: true,
        pendingConfirmation: {
          nonce,
          action: "create_group",
          toolArgs: { ...args, createdBy: userId },
          userId,
          name: groupName,
          members: args.members || [],
          createdAt: Date.now(),
        },
        message: `I'm ready to create the group **"${groupName}"** with ${memberCount} member(s).\n\n**Please confirm to create this group.**`,
      };
    }

    if (toolName === "add_friend") {
      if (!args.friendEmail && !args.friendPhone) {
        return {
          type: "agent_response",
          needsConfirmation: false,
          message: "What is your friend's email address or phone number?",
        };
      }

      const contact = args.friendEmail || args.friendPhone;

      return {
        type: "add_friend_confirmation",
        needsConfirmation: true,
        pendingConfirmation: {
          nonce,
          action: "add_friend",
          toolArgs: { ...args, userId },
          userId,
          contact,
          createdAt: Date.now(),
        },
        message: `I'm ready to add **${contact}** as your friend.\n\n**Please confirm to proceed.**`,
      };
    }

    if (toolName === "acknowledge_notification") {
      return {
        type: "acknowledge_notification_confirmation",
        needsConfirmation: true,
        pendingConfirmation: {
          nonce,
          action: "acknowledge_notification",
          toolArgs: { ...args, userId },
          userId,
          notificationId: args.notificationId,
          createdAt: Date.now(),
        },
        message: `I'm ready to mark notification **${args.notificationId}** as read.\n\n**Please confirm.**`,
      };
    }

    // Default generic confirmation for any unhandled mutating tool
    return {
      type: "generic_confirmation",
      needsConfirmation: true,
      pendingConfirmation: {
        nonce,
        action: toolName,
        toolArgs: { ...args, userId },
        userId,
        createdAt: Date.now(),
      },
      message: `I'm ready to perform **${toolName}**. Please confirm to proceed.`,
    };
  }

  /**
   * Execute the exact confirmed action, enforcing authorization boundary.
   */
  async executeConfirmedAction(pending, userId, userName) {
    if (!pending || typeof pending !== 'object') {
      return {
        type: "error",
        needsConfirmation: false,
        message: "No pending action found to confirm.",
      };
    }

    // Strict Authorization Boundary: Ensure the confirming user owns the pending action
    if (pending.userId && pending.userId !== userId) {
      console.error(`[AI Security] Blocked cross-user confirmation attempt. Pending owner: ${pending.userId}, Executing user: ${userId}`);
      return {
        type: "error",
        needsConfirmation: false,
        message: "⚠️ Authorization Error: You cannot confirm an action initiated by another user.",
      };
    }

    const action = pending.action || "create_expense_with_split";
    const toolArgs = { ...(pending.toolArgs || {}) };

    // Inject trusted authenticated user ID
    toolArgs.userId = userId;
    if ('createdBy' in toolArgs || action === 'create_group') {
      toolArgs.createdBy = userId;
    }

    console.log(`[AI Agent] Executing confirmed mutation: ${action}`, JSON.stringify(toolArgs));
    const result = await mcpClient.callTool(action, toolArgs, userId);

    if (result.success) {
      if (action === "create_expense_with_split") {
        const totalAmount = toolArgs.amount || pending.amount || 0;
        const desc = toolArgs.description || pending.description || "Shared Expense";
        return {
          type: "expense_split",
          needsConfirmation: false,
          saved: true,
          data: result.data,
          message: `✅ **Expense Created Successfully!**\n• Description: "${desc}"\n• Total: $${parseFloat(totalAmount).toFixed(2)}\n• Your records and friend balances have been updated.`,
        };
      }

      if (action === "settle_up") {
        return {
          type: "settle_up",
          needsConfirmation: false,
          saved: true,
          data: result.data,
          message: `✅ **Settlement Payment Recorded!**\nYour balance with your friend has been successfully updated.`,
        };
      }

      if (action === "create_group") {
        return {
          type: "create_group",
          needsConfirmation: false,
          saved: true,
          data: result.data,
          message: `✅ **Group Created Successfully!**\nGroup "${pending.name || toolArgs.name}" has been created.`,
        };
      }

      if (action === "add_friend") {
        return {
          type: "friend_info",
          needsConfirmation: false,
          saved: true,
          data: result.data,
          message: `✅ **Friend Added Successfully!**\nYour friend list has been updated.`,
        };
      }

      return {
        type: "agent_response",
        needsConfirmation: false,
        saved: true,
        data: result.data,
        message: `✅ Operation "${action}" completed successfully.`,
      };
    } else {
      // NEVER return fake success on tool failure!
      return {
        type: "error",
        needsConfirmation: false,
        saved: false,
        message: `⚠️ I couldn't complete the operation because it failed: ${result.error || "Unknown error"}. Please try again.`,
      };
    }
  }

  formatHistory(history = []) {
    return history.slice(-6).map((msg) => {
      if (msg.type === "user") {
        return new HumanMessage(msg.content);
      }
      return new AIMessage(msg.content);
    });
  }

  buildSystemPrompt(userContext) {
    const today = new Date().toISOString().split("T")[0];
    const friendsSummary = (userContext.friends || [])
      .map((f) => `${f.name} (ID: ${f.id})`)
      .join(", ") || "None";
    const groupsSummary = (userContext.groups || [])
      .map((g) => `${g.name} (ID: ${g.id})`)
      .join(", ") || "None";

    return `You are SpendSavvy AI, an intelligent, autonomous financial assistant with direct access to SpendSavvy Model Context Protocol (MCP) tools.

CURRENT RUNTIME CONTEXT:
• Today's Date: ${today}
• Authenticated User: ${userContext.userName || "User"} (User ID: ${userContext.userId})
• User Friends: ${friendsSummary}
• User Groups: ${groupsSummary}

CORE OPERATIONAL RULES:
1. ALWAYS use MCP tools to query live financial numbers, balances, groups, expenses, and analytics. NEVER invent, fabricate, or hallucinate numbers.
2. NEVER invent, default, or guess financial amounts (e.g. defaulting to $50/₹50) or participants. If an amount or participant is missing from a user's expense or split request, ask the user for the missing information before taking action.
3. NEVER guess database UUIDs. When a user mentions a friend by name (e.g. "Rahul"), look up their ID in the User Friends list or invoke "search_friends".
4. If multiple friends match a name (ambiguous), ask the user to clarify before taking action.
5. For multi-step queries (e.g. comparing this month vs last month, or checking balance before sending a reminder), sequentially call the necessary MCP tools, synthesize the actual tool results, and explain clearly.
6. Format responses cleanly using markdown (bullet points, bold highlights, dollar values).
7. When answering balance or debt questions, clearly specify who owes whom.
8. Be polite, concise, and helpful.`;
  }

  /**
   * Deterministic Fallback using direct MCP Tool execution on Rate Limit / Failure
   */
  async handleFallback(userMessage, userContext, error) {
    const lower = userMessage.toLowerCase().trim();
    const userId = userContext.userId;

    // 1. Balance Query Fallback -> invoke get_user_balances via MCP (Read-Only)
    if (
      lower.includes("owe") || 
      lower.includes("balance") || 
      lower.includes("debt") || 
      lower.includes("who owes")
    ) {
      const result = await mcpClient.callTool("get_user_balances", {}, userId);
      if (result.success && result.data) {
        const d = result.data;
        let msg = `💰 **Your Balance Summary:**\n`;
        msg += `• Total You Are Owed: $${(d.totalYouAreOwed || 0).toFixed(2)}\n`;
        msg += `• Total You Owe: $${(d.totalYouOwe || 0).toFixed(2)}\n`;
        msg += `• Net Balance: **${(d.netBalance || 0) >= 0 ? "+" : ""}$${(d.netBalance || 0).toFixed(2)}**\n\n`;

        if (d.balances && d.balances.length > 0) {
          msg += `**Friends Breakdown:**\n`;
          d.balances.forEach((b) => {
            if (b.balance > 0) {
              msg += `• **${b.friendName}** owes you **$${b.balance.toFixed(2)}**\n`;
            } else if (b.balance < 0) {
              msg += `• You owe **${b.friendName}** **$${Math.abs(b.balance).toFixed(2)}**\n`;
            } else {
              msg += `• **${b.friendName}**: Settled up ($0.00)\n`;
            }
          });
        }
        return {
          type: "friend_balances",
          message: msg,
          data: d,
        };
      }
    }

    // 2. Settle Up Fallback -> Prepare confirmation (NEVER execute mutating write directly!)
    if (lower.includes("settle") || lower.includes("paid")) {
      const friends = userContext.friends || [];
      let targetFriend = friends.find((f) => lower.includes(f.name?.toLowerCase()));
      if (targetFriend) {
        return this.prepareMutationConfirmation("settle_up", { friendId: targetFriend.id }, userId, userContext.userName, userMessage);
      } else {
        return {
          type: "agent_response",
          message: "Which friend would you like to settle up with?",
        };
      }
    }

    // 3. Expense Split Fallback (Two-Phase Confirmation with NO ₹50 / friend[0] fallback)
    if (lower.includes("split") || lower.includes("bill") || lower.includes("dinner") || lower.includes("lunch") || lower.includes("expense")) {
      // Look for explicit amounts like $60, ₹500, 60 USD, 60 dollars, etc.
      const amountMatch = userMessage.match(/(?:[$₹€£]\s*(\d+(?:\.\d{1,2})?)|(?:(?:rs|inr|usd)\.?\s*(\d+(?:\.\d{1,2})?))|(\d+(?:\.\d{1,2})?)\s*(?:rs|inr|usd|dollars?|bucks?))/i) ||
                          userMessage.match(/\b(\d+(?:\.\d{1,2})?)\b/);

      const parsedAmountStr = amountMatch ? (amountMatch[1] || amountMatch[2] || amountMatch[3]) : null;
      const amount = parsedAmountStr ? parseFloat(parsedAmountStr) : null;

      // STRICT CHECK: If amount is missing or invalid, NEVER assume 50! Ask the user!
      if (!amount || isNaN(amount) || amount <= 0) {
        return {
          type: "agent_response",
          message: "What was the total amount for the expense?",
        };
      }

      // Extract friend IDs
      const friends = userContext.friends || [];
      const matchedFriendIds = [];
      for (const f of friends) {
        if (lower.includes(f.name?.toLowerCase())) {
          matchedFriendIds.push(f.id);
        }
      }

      // If user said "with all" or "with all my friends"
      if (lower.includes("all my friends") || lower.includes("with all friends") || lower.includes("all friends")) {
        friends.forEach((f) => {
          if (!matchedFriendIds.includes(f.id)) matchedFriendIds.push(f.id);
        });
      }

      // If no friend matched, check for name following 'with' (e.g. "with Balram")
      if (matchedFriendIds.length === 0) {
        const withMatch = userMessage.match(/with\s+([a-zA-Z0-9_\-]+)/i);
        if (withMatch && withMatch[1] && withMatch[1].toLowerCase() !== 'all') {
          const rawName = withMatch[1].trim();
          matchedFriendIds.push(`friend-${rawName.toLowerCase()}`);
        }
      }

      // STRICT CHECK: If no friend or group is specified, NEVER silently pick friends[0]! Ask the user!
      if (matchedFriendIds.length === 0) {
        return {
          type: "agent_response",
          message: "Who would you like to split this expense with?",
        };
      }

      let description = "Shared Expense";
      if (lower.includes("dinner")) description = "Dinner";
      else if (lower.includes("lunch")) description = "Lunch";
      else if (lower.includes("hotel")) description = "Hotel";
      else if (lower.includes("cab") || lower.includes("taxi")) description = "Cab Ride";

      return this.prepareMutationConfirmation("create_expense_with_split", {
        amount,
        category: "Food",
        description,
        friendIds: matchedFriendIds,
        splitType: "equal",
      }, userId, userContext.userName, userMessage);
    }

    // 4. List Groups Fallback (Read-Only)
    if (lower.includes("group")) {
      const result = await mcpClient.callTool("list_groups", {}, userId);
      if (result.success && result.data) {
        const groups = result.data || [];
        return {
          type: "list_groups",
          data: groups,
          message: `📁 You have **${groups.length}** active groups:\n` +
            groups.map((g) => `• **${g.name}** (ID: \`${g.id}\`)`).join("\n"),
        };
      }
    }

    // 5. Monthly Spending Analytics Fallback (Read-Only)
    if (lower.includes("spent") || lower.includes("spending") || lower.includes("analytics")) {
      const result = await mcpClient.callTool("get_monthly_summary", {}, userId);
      if (result.success && result.data) {
        return {
          type: "analytics",
          data: result.data,
          message: `📊 **Monthly Spending Summary:**\n• Total: $${JSON.stringify(result.data)}`,
        };
      }
    }

    // Generic safe response
    return {
      type: "general_chat",
      message: `👋 I can help you with your finances! Try asking:\n• *"How much did I spend this month?"*\n• *"Who owes me money?"*\n• *"Split $60 dinner with Rahul"*\n• *"Show details of Goa Trip group"*`,
    };
  }
}

export const mcpAgent = new SpendSavvyMcpAgent();

