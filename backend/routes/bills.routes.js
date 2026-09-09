import { Router } from 'express';
import { uploadOCR, getBill, getBillsByUser } from '../controllers/bill.controller.js';
import { upload } from '../middlewares/upload.middleware.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/ocr/upload', upload.single('receipt'), optionalAuth, uploadOCR);
router.post('/upload', upload.single('receipt'), optionalAuth, uploadOCR);
router.get('/user/:userId', optionalAuth, getBillsByUser);
router.get('/:billId', optionalAuth, getBill);

// Compatibility aliases
router.get('/bills/user/:userId', optionalAuth, getBillsByUser);
router.get('/bills/:billId', optionalAuth, getBill);

export default router;

