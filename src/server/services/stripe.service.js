const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../config/db');

/**
 * Create a Stripe Checkout Session for a 24-hour day pass
 * @param {string} userId
 */
const createDayPassCheckoutSession = async (userId) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'JobRadius 24-Hour Day Pass',
                            description: 'Full access to multi-radius job search and transit routing for 24 hours.',
                        },
                        unit_amount: 999, // $9.99
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'https://jobradius.agent-swarm.net'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL || 'https://jobradius.agent-swarm.net'}/payment/cancel`,
            client_reference_id: userId,
            customer_email: user.email,
            metadata: {
                type: 'day_pass',
                userId: userId
            }
        });

        return session;
    } catch (err) {
        console.error('Stripe Service Error (createDayPassCheckoutSession):', err);
        throw err;
    }
};

/**
 * Handle Stripe Webhook to activate user access
 * @param {Object} event Stripe Event Object
 */
const handleWebhookEvent = async (event) => {
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // Fulfill the purchase based on metadata
        if (session.metadata.type === 'day_pass') {
            const userId = session.metadata.userId;

            // Update User status and timer in DB (24 hours from now)
            const twentyFourHoursFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionStatus: 'day_pass',
                    dayPassExpiresAt: twentyFourHoursFromNow
                }
            });

            // Log payment
            await prisma.payment.create({
                data: {
                    userId,
                    stripePaymentId: session.id,
                    amount: session.amount_total,
                    currency: session.currency,
                    status: 'completed',
                    type: 'day_pass'
                }
            });
            console.log(`✅ [Stripe] Day Pass activated for User: ${userId}`);
        }
    }
    return true;
};

/**
 * Directly verify a Stripe Checkout Session and activate the day pass if paid.
 * Called by the frontend immediately on return from Stripe checkout.
 * This is more reliable than webhooks in sandbox/development environments.
 * @param {string} sessionId - The Stripe session ID from the return URL
 * @param {string} userId - The authenticated user's ID (from JWT, prevents spoofing)
 */
const verifyAndActivateSession = async (sessionId, userId) => {
    try {
        // Fetch the session directly from Stripe API
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Security: ensure this session belongs to the authenticated user
        if (session.client_reference_id !== userId) {
            throw new Error('Session does not belong to this user');
        }

        // Only activate if payment is actually complete
        if (session.payment_status !== 'paid') {
            console.warn(`[Stripe] Session ${sessionId} not paid yet (status: ${session.payment_status})`);
            // Return current user state without modifying anything
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, subscriptionStatus: true, dayPassExpiresAt: true } });
            return user;
        }

        // Already activated by webhook? Avoid double-counting.
        const existingPayment = await prisma.payment.findUnique({ where: { stripePaymentId: session.id } });

        if (!existingPayment) {
            // Webhook hasn't fired yet — activate now.
            const twentyFourHoursFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await prisma.user.update({
                where: { id: userId },
                data: { subscriptionStatus: 'day_pass', dayPassExpiresAt: twentyFourHoursFromNow }
            });
            await prisma.payment.create({
                data: {
                    userId,
                    stripePaymentId: session.id,
                    amount: session.amount_total,
                    currency: session.currency,
                    status: 'completed',
                    type: 'day_pass'
                }
            });
            console.log(`✅ [Stripe] Day Pass activated via verify-session for User: ${userId}`);
        } else {
            console.log(`[Stripe] Session ${sessionId} already activated (webhook fired earlier).`);
        }

        // Return fresh user data so frontend can update localStorage
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, name: true, subscriptionStatus: true, dayPassExpiresAt: true }
        });
        return user;
    } catch (err) {
        console.error('Stripe Service Error (verifyAndActivateSession):', err);
        throw err;
    }
};

module.exports = {
    createDayPassCheckoutSession,
    handleWebhookEvent,
    verifyAndActivateSession
};
