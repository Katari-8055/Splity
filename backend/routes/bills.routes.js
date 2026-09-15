import { Router } from 'express';
import { uploadOCR, getBill, getBillsByUser } from '../controllers/bill.controller.js';
import { upload } from '../middlewares/upload.middleware.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/ocr/upload', upload.single('receipt'), authenticateToken, uploadOCR);
router.post('/upload', upload.single('receipt'), authenticateToken, uploadOCR);

// All bill fetches use authenticated user only — param userId is ignored in controller
router.get('/user/me', authenticateToken, getBillsByUser);
router.get('/user/:userId', authenticateToken, getBillsByUser);
router.get('/:billId', authenticateToken, getBill);

export default router;
