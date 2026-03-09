const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

// GET /api/subscriptions/status
router.get('/status', requireAuth, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { subscriptions: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            status: user.subscriptionStatus,
            subscription: user.subscription
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/subscriptions/cancel
router.post('/cancel', requireAuth, async (req, res, next) => {
    try {
        // Demote user to free tier
        // In a complete implementation, this would also call Stripe API to cancel the recurring product
        await prisma.user.update({
            where: { id: req.user.id },
            data: { subscriptionStatus: 'free' }
        });

        res.json({ success: true, message: 'Subscription canceled. You are now on the Free tier.' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
