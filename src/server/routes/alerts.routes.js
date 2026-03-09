const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/alerts
 * Get all unread alerts for the logged-in user.
 */
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const alerts = await prisma.alert.findMany({
            where: { userId },
            include: { searchProfile: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, data: alerts });
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/alerts/:id/read
 * Mark an alert as read.
 */
router.patch('/:id/read', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const alert = await prisma.alert.updateMany({
            where: { id, userId },
            data: { isRead: true }
        });

        res.json({ success: true, updated: alert.count });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/alerts
 * Create a new alert (system use: e.g. when new jobs match a search profile).
 * Body: { searchProfileId, type, message }
 */
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { searchProfileId, type, message } = req.body;

        if (!searchProfileId || !type || !message) {
            return res.status(400).json({ error: 'searchProfileId, type, and message are required.' });
        }

        const alert = await prisma.alert.create({
            data: {
                userId,
                searchProfileId,
                type,
                message
            }
        });

        res.json({ success: true, data: alert });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
