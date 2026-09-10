import {
  createGroup,
  getGroup,
  listGroups,
  updateGroupMembers,
  getGroupMembers,
  getGroupMessages,
  addGroupMessage,
  isUserInGroup
} from '../services/groupService.js';
import { getGroupExpenses } from '../services/expenseService.js';

export async function getGroups(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const groups = await listGroups(userId);
    res.json(groups);
  } catch (error) {
    next(error);
  }
}

export async function createGroupController(req, res, next) {
  try {
    const createdBy = req.user?.userId;
    if (!createdBy) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { name, members } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Valid group name is required' });
    }

    const group = await createGroup({ name: name.trim(), createdBy });
    const allMembers = Array.from(new Set([createdBy, ...(members || [])]));
    await updateGroupMembers(group.id, allMembers);

    res.status(201).json({ group, members: allMembers });
  } catch (error) {
    next(error);
  }
}

export async function getGroupDetails(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const isMember = await isUserInGroup(id, userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden. You are not a member of this group.' });
    }

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
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const isMember = await isUserInGroup(id, userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden. You are not a member of this group.' });
    }

    const expenses = await getGroupExpenses(id);
    res.json(expenses);
  } catch (error) {
    next(error);
  }
}

export async function getMessagesForGroup(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const isMember = await isUserInGroup(id, userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden. You are not a member of this group.' });
    }

    const messages = await getGroupMessages(id);
    res.json(messages);
  } catch (error) {
    next(error);
  }
}

export async function postMessageToGroup(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const isMember = await isUserInGroup(id, userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden. You cannot post messages to a group you do not belong to.' });
    }

    const msg = await addGroupMessage(id, userId, message.trim());
    res.status(201).json(msg);
  } catch (error) {
    next(error);
  }
}
