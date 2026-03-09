const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.get('/metrics', requireAuth, async (req, res, next) => {
    // Restrict to admin email
    if (req.user.email !== 'bruno.brottes@gmail.com') {
        return res.status(403).json({ error: 'Unauthorized access' });
    }

    try {
        const now = new Date();
        const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
        const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // ── New Users ──────────────────────────────────────────
        const [usersDay, usersWeek, usersMonth, totalUsers] = await Promise.all([
            prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
            prisma.user.count({ where: { createdAt: { gte: startOfWeek } } }),
            prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
            prisma.user.count(),
        ]);

        // ── Earnings from Payments ─────────────────────────────
        const [earningsDay, earningsWeek, earningsMonth, earningsTotal] = await Promise.all([
            prisma.payment.aggregate({ where: { createdAt: { gte: startOfDay }, status: 'succeeded' }, _sum: { amount: true } }),
            prisma.payment.aggregate({ where: { createdAt: { gte: startOfWeek }, status: 'succeeded' }, _sum: { amount: true } }),
            prisma.payment.aggregate({ where: { createdAt: { gte: startOfMonth }, status: 'succeeded' }, _sum: { amount: true } }),
            prisma.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amount: true } }),
        ]);

        const fmt = (cents) => '$' + ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });

        // ── Memberships by subscription status ────────────────
        const [inactive, dayPass, active, canceled] = await Promise.all([
            prisma.user.count({ where: { subscriptionStatus: 'inactive' } }),
            prisma.user.count({ where: { subscriptionStatus: 'day_pass' } }),
            prisma.user.count({ where: { subscriptionStatus: 'active' } }),
            prisma.user.count({ where: { subscriptionStatus: { in: ['canceled', 'free'] } } }),
        ]);

        // ── Search activity ────────────────────────────────────
        const [searchesToday, searchesWeek] = await Promise.all([
            prisma.searchProfile.count({ where: { createdAt: { gte: startOfDay } } }),
            prisma.searchProfile.count({ where: { createdAt: { gte: startOfWeek } } }),
        ]);

        res.json({
            users: {
                day: usersDay,
                week: usersWeek,
                month: usersMonth,
                total: totalUsers,
            },
            earnings: {
                day: fmt(earningsDay._sum.amount),
                week: fmt(earningsWeek._sum.amount),
                month: fmt(earningsMonth._sum.amount),
                total: fmt(earningsTotal._sum.amount),
            },
            memberships: {
                inactive,
                dayPass,
                active,
                canceled,
            },
            searches: {
                today: searchesToday,
                thisWeek: searchesWeek,
            },
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
