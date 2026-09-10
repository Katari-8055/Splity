#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });
dotenv.config();

import { v4 as uuidv4 } from 'uuid';

import { addUser, getUser, getUserByEmail, getUserByPhone, searchAllUsers } from '../backend/services/userService.js';
import { addFriend, listFriends, searchFriends } from '../backend/services/friendService.js';
import { createGroup, listGroups, getGroup, getGroupMembers, updateGroupMembers, getGroupMessages } from '../backend/services/groupService.js';
import { createExpenseWithSplit, listExpenses, getUserBalances, getFriendBalance, settleDebt, getGroupExpenses } from '../backend/services/expenseService.js';
import { getSpendByCategory, getMonthlySummary, getFriendContributions, getWeeklySummary, getCategorySpending } from '../backend/services/analyticsService.js';
import { pushNotification, listNotifications, acknowledgeNotification } from '../backend/services/notificationService.js';
import { saveReceipt, getReceiptsByExpense } from '../backend/services/billService.js';
import { initializeDatabase } from '../backend/database/init.js';

class ExpenseSplitterServer {
  constructor() {
    this.server = new Server(
      {
        name: "expense-splitter-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "add_user",
            description: "Add a new user to the system",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "User's name" },
                email: { type: "string", description: "User's email" },
                phone: { type: "string", description: "User's phone number (optional)" },
                balance: { type: "number", description: "Initial balance (optional)" },
              },
              required: ["name", "email"],
            },
          },
          {
            name: "get_user",
            description: "Get user details by ID",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "search_friends",
            description: "Search friends by name prefix for autocomplete",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
                prefix: { type: "string", description: "Name prefix to search" },
              },
              required: ["userId", "prefix"],
            },
          },
          {
            name: "add_friend",
            description: "Add a friend connection between two users",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
                friendEmail: { type: "string", description: "Friend's email (optional)" },
                friendPhone: { type: "string", description: "Friend's phone number (optional)" },
              },
              required: ["userId"],
            },
          },
          {
            name: "search_all_users",
            description: "Search all users by name, email, or phone for adding friends",
            inputSchema: {
              type: "object",
              properties: {
                searchTerm: { type: "string", description: "Search term (name, email, or phone)" },
              },
              required: ["searchTerm"],
            },
          },
          {
            name: "list_friends",
            description: "List all friends for a user",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "create_expense_with_split",
            description: "Create a new expense and split it among friends",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User who paid the expense" },
                amount: { type: "number", description: "Total amount" },
                category: { type: "string", description: "Expense category" },
                subcategory: { type: "string", description: "Expense subcategory" },
                description: { type: "string", description: "Expense description" },
                friendIds: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "Array of friend IDs to split with" 
                },
                splitType: { 
                  type: "string", 
                  enum: ["equal", "custom"],
                  description: "How to split the expense" 
                },
              },
              required: ["userId", "amount", "category", "description", "friendIds"],
            },
          },
          {
            name: "list_expenses",
            description: "List expenses for a user with optional filters",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
                category: { type: "string", description: "Filter by category (optional)" },
                startDate: { type: "string", description: "Start date filter (optional)" },
                endDate: { type: "string", description: "End date filter (optional)" },
              },
              required: ["userId"],
            },
          },
          {
            name: "get_spending_by_category",
            description: "Get spending analysis by category for a specific month/year",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
                month: { type: "number", description: "Month (1-12)" },
                year: { type: "number", description: "Year" },
              },
              required: ["userId", "month", "year"],
            },
          },
          {
            name: "get_monthly_summary",
            description: "Get monthly spending summary for a user",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "get_weekly_summary",
            description: "Get weekly spending summary for a user",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "get_category_spending",
            description: "Get detailed spending for a specific category",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
                category: { type: "string", description: "Category to analyze" },
                startDate: { type: "string", description: "Start date (optional)" },
                endDate: { type: "string", description: "End date (optional)" },
              },
              required: ["userId", "category"],
            },
          },
          {
            name: "create_group",
            description: "Create a new group for expense sharing",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Group name" },
                createdBy: { type: "string", description: "User ID who creates the group" },
                members: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "Array of user IDs to add to group" 
                },
              },
              required: ["name", "createdBy", "members"],
            },
          },
          {
            name: "list_groups",
            description: "List all groups for a user",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "get_friend_contributions",
            description: "Get contribution analysis for a group",
            inputSchema: {
              type: "object",
              properties: {
                groupId: { type: "string", description: "Group ID" },
              },
              required: ["groupId"],
            },
          },
          {
            name: "list_notifications",
            description: "List notifications for a user",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "acknowledge_notification",
            description: "Mark a notification as read",
            inputSchema: {
              type: "object",
              properties: {
                notificationId: { type: "string", description: "Notification ID" },
              },
              required: ["notificationId"],
            },
          },
          {
            name: "upload_receipt",
            description: "Upload a receipt for an expense",
            inputSchema: {
              type: "object",
              properties: {
                expenseId: { type: "string", description: "Expense ID" },
                fileUrl: { type: "string", description: "URL of the uploaded file" },
              },
              required: ["expenseId", "fileUrl"],
            },
          },
          {
            name: "get_receipts",
            description: "Get receipts for an expense",
            inputSchema: {
              type: "object",
              properties: {
                expenseId: { type: "string", description: "Expense ID" },
              },
              required: ["expenseId"],
            },
          },
          {
            name: "get_user_balances",
            description: "Get net balances and breakdown of debts/owed amounts with all friends for a user",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID" },
              },
              required: ["userId"],
            },
          },
          {
            name: "settle_up",
            description: "Settle debts with a friend by recording a settlement payment in PostgreSQL",
            inputSchema: {
              type: "object",
              properties: {
                userId: { type: "string", description: "User ID initiating settlement" },
                friendId: { type: "string", description: "Friend ID to settle with" },
                amount: { type: "number", description: "Custom amount to settle (optional, settles entire debt if omitted)" },
              },
              required: ["userId", "friendId"],
            },
          },
          {
            name: "get_group_details",
            description: "Get detailed information about a group including members, expenses, and total spent",
            inputSchema: {
              type: "object",
              properties: {
                groupId: { type: "string", description: "Group ID" },
                userId: { type: "string", description: "Authenticated User ID" },
              },
              required: ["groupId"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "add_user": {
            const { name: userName, email, phone, balance } = args;
            if (!userName || typeof userName !== 'string' || !userName.trim()) {
              throw new McpError(ErrorCode.InvalidParams, "User name is required");
            }
            if (!email || typeof email !== 'string' || !email.includes('@')) {
              throw new McpError(ErrorCode.InvalidParams, "A valid email address is required");
            }
            const userId = uuidv4();
            const user = await addUser({ id: userId, name: userName.trim(), email: email.trim().toLowerCase(), phone, balance });
            return { content: [{ type: "text", text: `User created successfully: ${JSON.stringify(user)}` }] };
          }
          case "get_user": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const user = await getUser(userId);
            return { content: [{ type: "text", text: user ? JSON.stringify(user) : "User not found" }] };
          }
          case "search_friends": {
            const { userId, prefix } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const friends = await searchFriends(userId, prefix || "");
            return { content: [{ type: "text", text: JSON.stringify(friends) }] };
          }
          case "add_friend": {
            const { userId, friendEmail, friendPhone } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "Authenticated user ID is required");
            let friend;
            if (friendEmail && typeof friendEmail === 'string' && friendEmail.trim()) {
              friend = await getUserByEmail(friendEmail.trim().toLowerCase());
            } else if (friendPhone && typeof friendPhone === 'string' && friendPhone.trim()) {
              friend = await getUserByPhone(friendPhone.trim());
            } else {
              throw new McpError(ErrorCode.InvalidParams, "Either a valid email or phone must be provided");
            }
            if (!friend) {
              throw new McpError(ErrorCode.InvalidParams, "Friend not found with provided contact info");
            }
            if (friend.id === userId) {
              throw new McpError(ErrorCode.InvalidParams, "You cannot add yourself as a friend");
            }
            const friendship = await addFriend(userId, friend.id);
            await addFriend(friend.id, userId);
            return { content: [{ type: "text", text: `Friend added successfully: ${JSON.stringify(friendship)}` }] };
          }
          case "search_all_users": {
            const { searchTerm } = args;
            if (!searchTerm || typeof searchTerm !== 'string') {
              throw new McpError(ErrorCode.InvalidParams, "Search term is required");
            }
            const users = await searchAllUsers(searchTerm.trim());
            return { content: [{ type: "text", text: JSON.stringify(users) }] };
          }
          case "list_friends": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const friends = await listFriends(userId);
            return { content: [{ type: "text", text: JSON.stringify(friends) }] };
          }
          case "create_expense_with_split": {
            const { userId, amount, category, subcategory, description, friendIds, splitType, groupId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "Authenticated user ID is required");
            
            const numAmount = parseFloat(amount);
            if (isNaN(numAmount) || !isFinite(numAmount) || numAmount <= 0) {
              throw new McpError(ErrorCode.InvalidParams, "Expense amount must be a positive number greater than 0");
            }
            if (!description || typeof description !== 'string' || !description.trim()) {
              throw new McpError(ErrorCode.InvalidParams, "Expense description is required");
            }
            if (!category || typeof category !== 'string' || !category.trim()) {
              throw new McpError(ErrorCode.InvalidParams, "Expense category is required");
            }
            if (!friendIds || !Array.isArray(friendIds) || friendIds.length === 0) {
              throw new McpError(ErrorCode.InvalidParams, "At least one participant/friend is required to split an expense");
            }

            // If group is specified, verify user is a member
            if (groupId) {
              const members = await getGroupMembers(groupId);
              const isMember = members.some((m) => m.id === userId || m.user_id === userId);
              if (!isMember) {
                throw new McpError(ErrorCode.InvalidRequest, "User is not a member of the specified group");
              }
            }

            const result = await createExpenseWithSplit(
              userId,
              numAmount,
              category.trim(),
              subcategory ? subcategory.trim() : '',
              description.trim(),
              friendIds,
              splitType || 'equal',
              null,
              groupId || null
            );
            return { content: [{ type: "text", text: `Expense created and split successfully: ${JSON.stringify(result)}` }] };
          }
          case "list_expenses": {
            const { userId, category, startDate, endDate } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const expenses = await listExpenses(userId, { category, startDate, endDate });
            return { content: [{ type: "text", text: JSON.stringify(expenses) }] };
          }
          case "get_spending_by_category": {
            const { userId, month, year } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const spending = await getSpendByCategory(userId, month, year);
            return { content: [{ type: "text", text: JSON.stringify(spending) }] };
          }
          case "get_monthly_summary": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const summary = await getMonthlySummary(userId);
            return { content: [{ type: "text", text: JSON.stringify(summary) }] };
          }
          case "get_weekly_summary": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const summary = await getWeeklySummary(userId);
            return { content: [{ type: "text", text: JSON.stringify(summary) }] };
          }
          case "get_category_spending": {
            const { userId, category, startDate, endDate } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const spending = await getCategorySpending(userId, category, startDate, endDate);
            return { content: [{ type: "text", text: JSON.stringify(spending) }] };
          }
          case "create_group": {
            const { name: groupName, createdBy, members } = args;
            if (!groupName || typeof groupName !== 'string' || !groupName.trim()) {
              throw new McpError(ErrorCode.InvalidParams, "Group name is required");
            }
            if (!createdBy) {
              throw new McpError(ErrorCode.InvalidParams, "CreatedBy user ID is required");
            }
            const groupId = uuidv4();
            const group = await createGroup({ id: groupId, name: groupName.trim(), createdBy });
            const memberList = Array.isArray(members) ? members : [];
            await updateGroupMembers(groupId, [createdBy, ...memberList]);
            for (const memberId of memberList) {
              await pushNotification(memberId, `You have been added to group: ${groupName.trim()}`).catch(() => {});
            }
            return { content: [{ type: "text", text: `Group created successfully: ${JSON.stringify(group)}` }] };
          }
          case "list_groups": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const groups = await listGroups(userId);
            return { content: [{ type: "text", text: JSON.stringify(groups) }] };
          }
          case "get_group_details": {
            const { groupId, userId } = args;
            if (!groupId) throw new McpError(ErrorCode.InvalidParams, "Group ID is required");
            
            const group = await getGroup(groupId);
            if (!group) {
              throw new McpError(ErrorCode.InvalidRequest, "Group not found");
            }

            const members = await getGroupMembers(groupId);
            // Resource authorization: if userId is provided, ensure user is a member
            if (userId) {
              const isMember = members.some((m) => m.id === userId || m.user_id === userId) || group.created_by === userId;
              if (!isMember) {
                throw new McpError(ErrorCode.InvalidRequest, "Access denied: you are not a member of this group");
              }
            }

            const [expenses, messages] = await Promise.all([
              getGroupExpenses(groupId),
              getGroupMessages(groupId)
            ]);
            const totalSpent = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ group, members, expenses, messages, totalSpent })
              }]
            };
          }
          case "get_friend_contributions": {
            const { groupId } = args;
            if (!groupId) throw new McpError(ErrorCode.InvalidParams, "Group ID is required");
            const contributions = await getFriendContributions(groupId);
            return { content: [{ type: "text", text: JSON.stringify(contributions) }] };
          }
          case "get_user_balances": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const balances = await getUserBalances(userId);
            return { content: [{ type: "text", text: JSON.stringify(balances) }] };
          }
          case "settle_up": {
            const { userId, friendId, amount } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "Authenticated user ID is required");
            if (!friendId) throw new McpError(ErrorCode.InvalidParams, "Friend ID is required");
            
            let customAmount = null;
            if (amount !== undefined && amount !== null && amount !== '') {
              const parsed = parseFloat(amount);
              if (isNaN(parsed) || !isFinite(parsed) || parsed <= 0) {
                throw new McpError(ErrorCode.InvalidParams, "Settlement amount must be a positive number");
              }
              customAmount = parsed;
            }

            const settlement = await settleDebt(userId, friendId, customAmount);
            return { content: [{ type: "text", text: JSON.stringify(settlement) }] };
          }
          case "list_notifications": {
            const { userId } = args;
            if (!userId) throw new McpError(ErrorCode.InvalidParams, "User ID is required");
            const notifications = await listNotifications(userId);
            return { content: [{ type: "text", text: JSON.stringify(notifications) }] };
          }
          case "acknowledge_notification": {
            const { notificationId } = args;
            if (!notificationId) throw new McpError(ErrorCode.InvalidParams, "Notification ID is required");
            const notification = await acknowledgeNotification(notificationId);
            return { content: [{ type: "text", text: `Notification acknowledged: ${JSON.stringify(notification)}` }] };
          }
          case "upload_receipt": {
            const { expenseId, fileUrl } = args;
            if (!expenseId || !fileUrl) throw new McpError(ErrorCode.InvalidParams, "Expense ID and File URL are required");
            const receipt = await saveReceipt(expenseId, fileUrl);
            return { content: [{ type: "text", text: `Receipt uploaded successfully: ${JSON.stringify(receipt)}` }] };
          }
          case "get_receipts": {
            const { expenseId } = args;
            if (!expenseId) throw new McpError(ErrorCode.InvalidParams, "Expense ID is required");
            const receipts = await getReceiptsByExpense(expenseId);
            return { content: [{ type: "text", text: JSON.stringify(receipts) }] };
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        // Safe sanitized error handling without exposing SQL or stack traces
        const isMcpError = error instanceof McpError;
        const safeMessage = error.message ? error.message.replace(/(\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|TABLE)\b.*)/gi, 'Database error occurred') : 'Operation failed';
        console.error(`[MCP Tool Error] ${name}:`, error.message);
        
        throw new McpError(
          isMcpError ? error.code : ErrorCode.InternalError,
          safeMessage
        );
      }
    });
  }

  async run() {
    try {
      await initializeDatabase();
      console.error("[MCP Server] Database initialized successfully");
    } catch (error) {
      console.error("[MCP Server] Database initialization warning (proceeding):", error.message);
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP Server] SpendSavvy MCP server running on stdio");
  }
}

const server = new ExpenseSplitterServer();
server.run().catch(console.error);
