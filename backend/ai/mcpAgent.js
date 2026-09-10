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
          console.log(`[AI Agent ${requestId}] Executing Tool: "${name}" with args:`, JSON.stringify(args));
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

  isConfirmationMessage(text = "") {
    const lower = text.toLowerCase().trim();
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
      lower === "settle" ||
      lower.startsWith("yes") ||
      lower.includes("confirm") ||
      lower.includes("proceed") ||
      lower.includes("save this") ||
      lower.includes("save expense") ||
      lower.includes("confirm and save")
    );
  }

  requiresConfirmation(toolName, args, userMessage) {
    // Expense creation and settlement requires confirmation unless explicitly confirmed
    if (toolName === "create_expense_with_split") {
      return true;
    }
    return false;
  }

  async prepareMutationConfirmation(toolName, args, userId, userName, userMessage) {
    if (toolName === "create_expense_with_split") {
      const amount = parseFloat(args.amount || 0);
      const friendIds = args.friendIds || [];
      const totalParticipants = friendIds.length + 1;
      const perPerson = totalParticipants > 0 ? (amount / totalParticipants).toFixed(2) : amount;
      const description = args.description || "Expense";
      const category = args.category || "General";

      return {
        type: "expense_split",
        needsConfirmation: true,
        pendingConfirmation: {
          action: "create_expense_with_split",
          toolArgs: { ...args, userId },
          amount,
          description,
          category,
          friendIds,
          perPerson,
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

    return null;
  }

  async executeConfirmedAction(pending, userId, userName) {
    const action = pending.action || "create_expense_with_split";
    const toolArgs = pending.toolArgs || {
      userId,
      amount: parseFloat(pending.amount || 0),
      category: pending.category || "Food",
      description: pending.description || "Shared Expense",
      friendIds: pending.friendIds || [],
      splitType: pending.splitType || "equal",
    };

    if (!toolArgs.userId) {
      toolArgs.userId = userId;
    }

    console.log(`[AI Agent] Executing confirmed mutation: ${action}`, JSON.stringify(toolArgs));
    const result = await mcpClient.callTool(action, toolArgs, userId);

    if (result.success) {
      const totalAmount = toolArgs.amount || pending.amount || 0;
      const desc = toolArgs.description || pending.description || "Shared Expense";
      return {
        type: "expense_split",
        needsConfirmation: false,
        saved: true,
        data: result.data,
        message: `✅ **Expense Created Successfully!**\n• Description: "${desc}"\n• Total: $${parseFloat(totalAmount).toFixed(2)}\n• Your records and friend balances have been updated.`,
      };
    } else {
      return {
        type: "error",
        needsConfirmation: false,
        message: `⚠️ Failed to save expense: ${result.error}`,
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
• Authenticated User: ${userContext.userName || "User"} (User ID: ${userContext.userId || "demo-user-id"})
• User Friends: ${friendsSummary}
• User Groups: ${groupsSummary}

CORE OPERATIONAL RULES:
1. ALWAYS use MCP tools to query live financial numbers, balances, groups, expenses, and analytics. NEVER invent, fabricate, or hallucinate numbers.
2. NEVER guess database UUIDs. When a user mentions a friend by name (e.g. "Rahul"), look up their ID in the User Friends list or invoke "search_friends".
3. If multiple friends match a name (ambiguous), ask the user to clarify before taking action.
4. For multi-step queries (e.g. comparing this month vs last month, or checking balance before sending a reminder), sequentially call the necessary MCP tools, synthesize the actual tool results, and explain clearly.
5. Format responses cleanly using markdown (bullet points, bold highlights, dollar values).
6. When answering balance or debt questions, clearly specify who owes whom.
7. Be polite, concise, and helpful.`;
  }

  /**
   * Deterministic Fallback using direct MCP Tool execution on Rate Limit / Failure
   */
  async handleFallback(userMessage, userContext, error) {
    const lower = userMessage.toLowerCase().trim();
    const userId = userContext.userId || "demo-user-id";

    // 1. Balance Query Fallback -> invoke get_user_balances via MCP
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

    // 2. Settle Up Fallback
    if (lower.includes("settle") || lower.includes("paid")) {
      const friends = userContext.friends || [];
      let targetFriend = friends.find((f) => lower.includes(f.name?.toLowerCase()));
      if (targetFriend) {
        const result = await mcpClient.callTool("settle_up", { friendId: targetFriend.id }, userId);
        if (result.success) {
          return {
            type: "settle_up",
            saved: true,
            data: result.data,
            message: `✅ **Settlement Recorded!** You are all settled up with **${targetFriend.name}** ($0.00 balance).`,
          };
        }
      }
    }

    // 3. Expense Split Fallback (Two-Phase Confirmation)
    if (lower.includes("split") || lower.includes("bill") || lower.includes("dinner") || lower.includes("lunch")) {
      const amountMatch = userMessage.match(/[$₹€£]?\s*(\d+(?:\.\d{1,2})?)/);
      const amount = amountMatch ? parseFloat(amountMatch[1]) : 50;

      // Extract friend IDs
      const friends = userContext.friends || [];
      const matchedFriendIds = [];
      for (const f of friends) {
        if (lower.includes(f.name?.toLowerCase())) {
          matchedFriendIds.push(f.id);
        }
      }

      // If no existing friend matched, check for name following 'with' (e.g. "with Balram")
      if (matchedFriendIds.length === 0) {
        const withMatch = userMessage.match(/with\s+([a-zA-Z0-9_\-]+)/i);
        if (withMatch && withMatch[1] && withMatch[1].toLowerCase() !== 'all') {
          const rawName = withMatch[1].trim();
          matchedFriendIds.push(`friend-${rawName.toLowerCase()}`);
        } else if (friends.length > 0) {
          matchedFriendIds.push(friends[0].id);
        }
      }

      const totalPeople = matchedFriendIds.length + 1;
      const perPerson = (amount / totalPeople).toFixed(2);
      let description = "Shared Expense";
      if (lower.includes("dinner")) description = "Dinner";
      else if (lower.includes("lunch")) description = "Lunch";
      else if (lower.includes("hotel")) description = "Hotel";
      else if (lower.includes("cab") || lower.includes("taxi")) description = "Cab Ride";

      return {
        type: "expense_split",
        needsConfirmation: true,
        pendingConfirmation: {
          action: "create_expense_with_split",
          toolArgs: {
            userId,
            amount,
            category: "Food",
            description,
            friendIds: matchedFriendIds,
            splitType: "equal",
          },
          amount,
          description,
          category: "Food",
          friendIds: matchedFriendIds,
          perPerson,
        },
        data: {
          description,
          amount,
          category: "Food",
          splitType: "equal",
          friendIds: matchedFriendIds,
        },
        message: `I've prepared an expense of **$${amount.toFixed(2)}** for "${description}" ($${perPerson} per person among ${totalPeople} people).\n\n**Please confirm to save this to your records.**`,
      };
    }

    // 4. List Groups Fallback
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

    // 5. Monthly Spending Analytics Fallback
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
