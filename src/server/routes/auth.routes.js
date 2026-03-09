const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID);

// POST /api/auth/google
// Accepts a Google ID token credential, verifies it, and returns our app JWT.
router.post('/google', async (req, res, next) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ error: 'Missing Google credential token' });
        }

        // Verify the Google ID token
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_OAUTH_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const googleEmail = payload.email;
        const googleName = payload.name || googleEmail.split('@')[0];

        // Find or create the user
        let user = await prisma.user.findUnique({ where: { email: googleEmail } });
        if (!user) {
            // Create a new user — no password needed for SSO users
            const dummyHash = await bcrypt.hash(Math.random().toString(36), 10);
            user = await prisma.user.create({
                data: {
                    email: googleEmail,
                    name: googleName,
                    passwordHash: dummyHash // placeholder, user won't login with email
                }
            });
        }

        // Issue our application JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Google login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                subscriptionStatus: user.subscriptionStatus
            }
        });
    } catch (err) {
        console.error('[Auth/Google] Error:', err.message);
        next(err);
    }
});

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const user = await prisma.user.create({ data: { email, passwordHash, name } });
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({
            message: 'Registration successful', token,
            user: { id: user.id, email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus }
        });
    } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            message: 'Login successful', token,
            user: { id: user.id, email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus }
        });
    } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, email: true, name: true, subscriptionStatus: true, createdAt: true }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    } catch (err) { next(err); }
});

module.exports = router;
