const express = require('express');
const router = express.Router();
const stripeService = require('../services/stripe.service');
const { requireAuth } = require('../middleware/auth');

// POST /api/stripe/create-checkout-session
router.post('/create-checkout-session', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const session = await stripeService.createDayPassCheckoutSession(userId);
        res.json({ url: session.url });
    } catch (err) {
        next(err);
    }
});

// GET /api/stripe/verify-session?session_id=cs_test_...
// Called by the frontend immediately after returning from Stripe checkout.
// Directly confirms payment status with Stripe, updates the DB, and returns fresh user data.
// This is MORE RELIABLE than webhooks in sandbox/dev environments.
router.get('/verify-session', requireAuth, async (req, res, next) => {
    try {
        const { session_id } = req.query;
        if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

        const user = await stripeService.verifyAndActivateSession(session_id, req.user.id);
        res.json({ success: true, user });
    } catch (err) {
        next(err);
    }
});

// POST /api/stripe/webhook
// This route will handle stripe webhooks. In production, this needs express.raw({type: 'application/json'})
// to properly verify the Stripe signature. For this MVP we accept the parsed JSON and log appropriately.
router.post('/webhook', async (req, res) => {
    try {
        // Assume req.body is already JSON parsed by global middleware
        const event = req.body;

        await stripeService.handleWebhookEvent(event);

        res.status(200).send({ received: true });
    } catch (err) {
        console.error("Webhook Error:", err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
});

module.exports = router;
