import { addFriend, listFriends, searchFriends } from '../services/friendService.js';
import { getUserByEmail, getUserByPhone } from '../services/userService.js';
import { pushNotification } from '../services/notificationService.js';

export async function getFriendsList(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const friends = await listFriends(userId);
    res.json(friends);
  } catch (error) {
    next(error);
  }
}

export async function addFriendController(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { friendEmail, friendPhone, friendId } = req.body;

    let targetFriendId = friendId;
    if (!targetFriendId) {
      if (friendEmail) {
        const friend = await getUserByEmail(friendEmail);
        if (friend) targetFriendId = friend.id;
      } else if (friendPhone) {
        const friend = await getUserByPhone(friendPhone);
        if (friend) targetFriendId = friend.id;
      }
    }

    if (!targetFriendId) {
      return res.status(404).json({ error: 'Friend user not found' });
    }

    if (targetFriendId === userId) {
      return res.status(400).json({ error: 'Cannot add yourself as a friend' });
    }

    const friendship = await addFriend(userId, targetFriendId);
    await addFriend(targetFriendId, userId); // Reciprocal

    res.json({ message: 'Friend added successfully', friendship });
  } catch (error) {
    next(error);
  }
}

export async function searchFriendsController(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const prefix = req.query.prefix || req.query.q || '';
    const friends = await searchFriends(userId, prefix);
    res.json(friends);
  } catch (error) {
    next(error);
  }
}

export async function sendReminderController(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { friendId, message } = req.body;
    if (!friendId) {
      return res.status(400).json({ error: 'Friend ID is required' });
    }
    const reminderMsg = message || `Reminder from your friend regarding shared expenses.`;
    await pushNotification(friendId, reminderMsg, 'reminder', { fromUserId: userId });
    res.json({ success: true, message: 'Reminder sent successfully' });
  } catch (error) {
    next(error);
  }
}
