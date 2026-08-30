import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listExpenses, createExpenseWithSplit } from '../services/expenseService.js';
import { listFriends } from '../services/friendService.js';
import { createGroup, listGroups } from '../services/groupService.js';
import { getSpendByCategory, getMonthlySummary, getDashboardOverview } from '../services/analyticsService.js';
import { listNotifications, pushNotification } from '../services/notificationService.js';

export const listExpensesTool = tool(
  async ({ userId, category }) => {
    try {
      const expenses = await listExpenses(userId, { category });
      return JSON.stringify(expenses);
    } catch (err) {
      return `Error retrieving expenses: ${err.message}`;
    }
  },
  {
    name: 'list_expenses',
    description: 'List user expenses with optional category filter',
    schema: z.object({
      userId: z.string().describe('User ID'),
      category: z.string().optional().describe('Category filter'),
    }),
  }
);

export const createExpenseTool = tool(
  async ({ userId, amount, category, description, friendIds, splitType }) => {
    try {
      const result = await createExpenseWithSplit(
        userId,
        amount,
        category,
        'General',
        description,
        friendIds || [],
        splitType || 'equal'
      );
      return JSON.stringify(result);
    } catch (err) {
      return `Error creating expense: ${err.message}`;
    }
  },
  {
    name: 'create_expense',
    description: 'Create a new expense and split with friends',
    schema: z.object({
      userId: z.string().describe('User ID paying'),
      amount: z.number().describe('Total amount'),
      category: z.string().describe('Expense category'),
      description: z.string().describe('Expense description'),
      friendIds: z.array(z.string()).optional().describe('Friend IDs to split with'),
      splitType: z.enum(['equal', 'percentage', 'custom']).optional().describe('Splitting method'),
    }),
  }
);

export const listFriendsTool = tool(
  async ({ userId }) => {
    try {
      const friends = await listFriends(userId);
      return JSON.stringify(friends);
    } catch (err) {
      return `Error listing friends: ${err.message}`;
    }
  },
  {
    name: 'list_friends',
    description: 'List all friends for a given user',
    schema: z.object({
      userId: z.string().describe('User ID'),
    }),
  }
);

export const createGroupTool = tool(
  async ({ name, createdBy, members }) => {
    try {
      const group = await createGroup({ name, createdBy });
      return JSON.stringify(group);
    } catch (err) {
      return `Error creating group: ${err.message}`;
    }
  },
  {
    name: 'create_group',
    description: 'Create a new expense group with members',
    schema: z.object({
      name: z.string().describe('Group name'),
      createdBy: z.string().describe('User ID creator'),
      members: z.array(z.string()).optional().describe('Member IDs'),
    }),
  }
);

export const getAnalyticsTool = tool(
  async ({ userId, month, year }) => {
    try {
      const categorySpend = await getSpendByCategory(userId, month || new Date().getMonth() + 1, year || new Date().getFullYear());
      const monthlySummary = await getMonthlySummary(userId);
      return JSON.stringify({ categorySpend, monthlySummary });
    } catch (err) {
      return `Error getting analytics: ${err.message}`;
    }
  },
  {
    name: 'get_analytics',
    description: 'Get category and monthly spending analytics for a user',
    schema: z.object({
      userId: z.string().describe('User ID'),
      month: z.number().optional().describe('Month (1-12)'),
      year: z.number().optional().describe('Year'),
    }),
  }
);

export const aiTools = [
  listExpensesTool,
  createExpenseTool,
  listFriendsTool,
  createGroupTool,
  getAnalyticsTool,
];
