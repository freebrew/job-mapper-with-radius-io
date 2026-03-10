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
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/cancel`,
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

module.exports = {
    createDayPassCheckoutSession,
    handleWebhookEvent
};
