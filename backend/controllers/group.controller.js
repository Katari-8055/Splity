import { createGroup, getGroup, listGroups, updateGroupMembers, getGroupMembers, getGroupMessages, addGroupMessage } from '../services/groupService.js';
import { getGroupExpenses } from '../services/expenseService.js';

export async function getGroups(req, res, next) {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    const groups = await listGroups(userId);
    res.json(groups);
  } catch (error) {
    next(error);
  }
}

export async function createGroupController(req, res, next) {
  try {
    const { name, members } = req.body;
    const createdBy = req.user?.userId || req.body.createdBy;
    if (!name || !createdBy) {
      return res.status(400).json({ error: 'Group name and createdBy are required' });
    }

    const group = await createGroup({ name, createdBy });
    const allMembers = Array.from(new Set([createdBy, ...(members || [])]));
    await updateGroupMembers(group.id, allMembers);

    res.status(201).json({ group, members: allMembers });
  } catch (error) {
    next(error);
  }
}

export async function getGroupDetails(req, res, next) {
  try {
    const { id } = req.params;
    const group = await getGroup(id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const members = await getGroupMembers(id);
    res.json({ ...group, members });
  } catch (error) {
    next(error);
  }
}

export async function getExpensesForGroup(req, res, next) {
  try {
    const { id } = req.params;
    const expenses = await getGroupExpenses(id);
    res.json(expenses);
  } catch (error) {
    next(error);
  }
}

export async function getMessagesForGroup(req, res, next) {
  try {
    const { id } = req.params;
    const messages = await getGroupMessages(id);
    res.json(messages);
  } catch (error) {
    next(error);
  }
}

export async function postMessageToGroup(req, res, next) {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user?.userId || req.body.userId;

    if (!userId || !message) {
      return res.status(400).json({ error: 'UserId and message are required' });
    }

    const msg = await addGroupMessage(id, userId, message);
    res.status(201).json(msg);
  } catch (error) {
    next(error);
  }
}
