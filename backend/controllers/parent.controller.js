import {
  getChildrenForParent,
  addChildByEmailAndPhone,
  updateChildThreshold,
  getChildTotalSpending,
  getChildSpendingAnalytics,
  getChildSpendingByCategory,
  verifyParentChild
} from '../services/parentService.js';
import { listNotifications } from '../services/notificationService.js';

export async function getChildren(req, res, next) {
  try {
    const parentId = req.user?.userId;
    if (!parentId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const children = await getChildrenForParent(parentId);
    res.json(children);
  } catch (error) {
    next(error);
  }
}

export async function addChild(req, res, next) {
  try {
    const parentId = req.user?.userId;
    if (!parentId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { childEmail, childPhone, thresholdAmount } = req.body;
    if (!childEmail || !childPhone) {
      return res.status(400).json({ error: 'childEmail and childPhone are required' });
    }

    const result = await addChildByEmailAndPhone(parentId, childEmail, childPhone, parseFloat(thresholdAmount || 0));
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateThreshold(req, res, next) {
  try {
    const parentId = req.user?.userId;
    if (!parentId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { relationshipId } = req.params;
    const { thresholdAmount } = req.body;
    if (!relationshipId || thresholdAmount === undefined) {
      return res.status(400).json({ error: 'RelationshipId and thresholdAmount are required' });
    }

    const updated = await updateChildThreshold(relationshipId, parseFloat(thresholdAmount), parentId);
    if (!updated) {
      return res.status(404).json({ error: 'Relationship not found or access denied' });
    }
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function getParentNotifications(req, res, next) {
  try {
    const parentId = req.user?.userId;
    if (!parentId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const notifications = await listNotifications(parentId);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
}

export async function getChildAnalytics(req, res, next) {
  try {
    const parentId = req.user?.userId;
    if (!parentId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { childId } = req.params;
    const isAuthorized = await verifyParentChild(parentId, childId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Forbidden. You do not have an active parent relationship with this child.' });
    }

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
