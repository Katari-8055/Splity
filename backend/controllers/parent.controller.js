import {
  getChildrenForParent,
  addChildByEmailAndPhone,
  updateChildThreshold,
  getChildTotalSpending,
  getChildSpendingAnalytics,
  getChildSpendingByCategory
} from '../services/parentService.js';
import { listNotifications } from '../services/notificationService.js';

export async function getChildren(req, res, next) {
  try {
    const parentId = req.user?.userId || req.query.parentId;
    if (!parentId) {
      return res.status(400).json({ error: 'Parent ID required' });
    }
    const children = await getChildrenForParent(parentId);
    res.json(children);
  } catch (error) {
    next(error);
  }
}

export async function addChild(req, res, next) {
  try {
    const parentId = req.user?.userId || req.body.parentId;
    const { childEmail, childPhone, thresholdAmount } = req.body;
    if (!parentId || !childEmail || !childPhone) {
      return res.status(400).json({ error: 'ParentId, childEmail, and childPhone are required' });
    }

    const result = await addChildByEmailAndPhone(parentId, childEmail, childPhone, parseFloat(thresholdAmount || 0));
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateThreshold(req, res, next) {
  try {
    const { relationshipId } = req.params;
    const { thresholdAmount } = req.body;
    if (!relationshipId || thresholdAmount === undefined) {
      return res.status(400).json({ error: 'RelationshipId and thresholdAmount are required' });
    }

    const updated = await updateChildThreshold(relationshipId, parseFloat(thresholdAmount));
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function getParentNotifications(req, res, next) {
  try {
    const parentId = req.user?.userId || req.query.parentId;
    if (!parentId) {
      return res.status(400).json({ error: 'Parent ID required' });
    }
    const notifications = await listNotifications(parentId);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
}

export async function getChildAnalytics(req, res, next) {
  try {
    const { childId } = req.params;
    const { startDate, endDate } = req.query;

    const totalSpending = await getChildTotalSpending(childId, startDate, endDate);
    const categoryBreakdown = await getChildSpendingByCategory(childId, startDate, endDate);
    const transactions = await getChildSpendingAnalytics(childId, startDate, endDate);

    res.json({
      totalSpending,
      categoryBreakdown,
      transactions
    });
  } catch (error) {
    next(error);
  }
}
