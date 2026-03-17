const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const BASE_URL = process.env.FRONTEND_URL || 'https://jobradius.agent-swarm.net';

const REDIRECT_URI = `${BASE_URL}/api/auth/google/callback`;

const googleClient = new OAuth2Client(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    REDIRECT_URI
);

// ── Helper: Upsert user and issue JWT, then redirect to frontend ─────────────
async function upsertAndRedirect(res, email, name) {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        const dummyHash = await bcrypt.hash(Math.random().toString(36), 10);
        user = await prisma.user.create({
            data: { email, name, passwordHash: dummyHash }
        });
    }

    const token = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

    const safeUser = {
        id: user.id, email: user.email, name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        dayPassExpiresAt: user.dayPassExpiresAt
    };

    res.redirect(`/?oauth_token=${encodeURIComponent(token)}&oauth_user=${encodeURIComponent(JSON.stringify(safeUser))}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE OAuth
// ══════════════════════════════════════════════════════════════════════════════

router.get('/google/start', (req, res) => {
    const url = googleClient.generateAuthUrl({
        access_type: 'online',
        scope: ['email', 'profile'],
        prompt: 'select_account',
    });
    res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) return res.redirect('/?auth_error=access_denied');

    try {
        const { tokens } = await googleClient.getToken(code);
        googleClient.setCredentials(tokens);

        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        await upsertAndRedirect(res, payload.email, payload.name || payload.email.split('@')[0]);
    } catch (err) {
        console.error('[Auth/Google/Callback] Error:', err.message);
        res.redirect('/?auth_error=server_error');
    }
});

// POST /api/auth/google — accepts Google ID token credential
router.post('/google', async (req, res, next) => {
    try {
        const { credential } = req.body;
        if (!credential) return res.status(400).json({ error: 'Missing Google credential token' });

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_OAUTH_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const googleEmail = payload.email;
        const googleName = payload.name || googleEmail.split('@')[0];

        let user = await prisma.user.findUnique({ where: { email: googleEmail } });
        if (!user) {
            const dummyHash = await bcrypt.hash(Math.random().toString(36), 10);
            user = await prisma.user.create({
                data: { email: googleEmail, name: googleName, passwordHash: dummyHash }
            });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({
            message: 'Google login successful', token,
            user: { id: user.id, email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus }
        });
    } catch (err) {
        console.error('[Auth/Google] Error:', err.message);
        next(err);
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// FACEBOOK OAuth
// ══════════════════════════════════════════════════════════════════════════════

const FB_REDIRECT_URI = `${BASE_URL}/api/auth/facebook/callback`;

router.get('/facebook/start', (req, res) => {
    const appId = process.env.FACEBOOK_APP_ID;
    if (!appId) return res.redirect('/?auth_error=facebook_not_configured');

    const url = `https://www.facebook.com/v19.0/dialog/oauth?` +
        `client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
        `&scope=email,public_profile` +
        `&response_type=code`;
    res.redirect(url);
});

router.get('/facebook/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) return res.redirect('/?auth_error=access_denied');

    try {
        // Exchange code for access token
        const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?` +
            `client_id=${process.env.FACEBOOK_APP_ID}` +
            `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
            `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
            `&code=${code}`;

        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error.message);

        // Fetch user profile
        const profileRes = await fetch(
            `https://graph.facebook.com/me?fields=email,name&access_token=${tokenData.access_token}`
        );
        const profile = await profileRes.json();
        if (!profile.email) throw new Error('Facebook did not return email');

        await upsertAndRedirect(res, profile.email, profile.name || profile.email.split('@')[0]);
    } catch (err) {
        console.error('[Auth/Facebook/Callback] Error:', err.message);
        res.redirect('/?auth_error=server_error');
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// APPLE Sign In
// ══════════════════════════════════════════════════════════════════════════════

const APPLE_REDIRECT_URI = `${BASE_URL}/api/auth/apple/callback`;

/**
 * Generate Apple client_secret JWT signed with ES256.
 * Apple requires this instead of a static client secret.
 */
function generateAppleClientSecret() {
    const privateKey = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
    const payload = {
        iss: process.env.APPLE_TEAM_ID,
        iat: now,
        exp: now + (86400 * 180), // 6 months
        aud: 'https://appleid.apple.com',
        sub: process.env.APPLE_CLIENT_ID
    };
    return jwt.sign(payload, privateKey, { algorithm: 'ES256', header });
}

router.get('/apple/start', (req, res) => {
    const clientId = process.env.APPLE_CLIENT_ID;
    if (!clientId) return res.redirect('/?auth_error=apple_not_configured');

    const url = `https://appleid.apple.com/auth/authorize?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(APPLE_REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=name email` +
        `&response_mode=form_post`;
    res.redirect(url);
});

// Apple uses form_post — sends a POST to the callback
router.post('/apple/callback', async (req, res) => {
    const { code, error: appleError } = req.body;
    if (appleError || !code) return res.redirect('/?auth_error=access_denied');

    try {
        const clientSecret = generateAppleClientSecret();

        const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.APPLE_CLIENT_ID,
                client_secret: clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: APPLE_REDIRECT_URI
            })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error);

        // Decode Apple's id_token (trusted — received directly from Apple)
        const decoded = jwt.decode(tokenData.id_token);
        const email = decoded.email;
        if (!email) throw new Error('Apple did not return email');

        // Apple only sends user name on FIRST authorization
        const userInfo = req.body.user ? JSON.parse(req.body.user) : {};
        const name = userInfo.name
            ? `${userInfo.name.firstName || ''} ${userInfo.name.lastName || ''}`.trim()
            : email.split('@')[0];

        await upsertAndRedirect(res, email, name);
    } catch (err) {
        console.error('[Auth/Apple/Callback] Error:', err.message);
        res.redirect('/?auth_error=server_error');
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// LINKEDIN OAuth (OpenID Connect)
// ══════════════════════════════════════════════════════════════════════════════

const LI_REDIRECT_URI = `${BASE_URL}/api/auth/linkedin/callback`;

router.get('/linkedin/start', (req, res) => {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) return res.redirect('/?auth_error=linkedin_not_configured');

    const state = crypto.randomBytes(16).toString('hex');
    const url = `https://www.linkedin.com/oauth/v2/authorization?` +
        `response_type=code` +
        `&client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(LI_REDIRECT_URI)}` +
        `&scope=openid profile email` +
        `&state=${state}`;
    res.redirect(url);
});

router.get('/linkedin/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) return res.redirect('/?auth_error=access_denied');

    try {
        // Exchange code for access token
        const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: LI_REDIRECT_URI,
                client_id: process.env.LINKEDIN_CLIENT_ID,
                client_secret: process.env.LINKEDIN_CLIENT_SECRET
            })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

        // Fetch user profile via OpenID Connect userinfo
        const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const profile = await profileRes.json();
        const email = profile.email;
        if (!email) throw new Error('LinkedIn did not return email');

        const name = profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || email.split('@')[0];

        await upsertAndRedirect(res, email, name);
    } catch (err) {
        console.error('[Auth/LinkedIn/Callback] Error:', err.message);
        res.redirect('/?auth_error=server_error');
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL Auth (Register / Login / Me)
// ══════════════════════════════════════════════════════════════════════════════

router.post('/register', async (req, res, next) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ error: 'Email already registered' });
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const user = await prisma.user.create({ data: { email, passwordHash, name } });
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({
            message: 'Registration successful', token,
            user: { id: user.id, email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus, dayPassExpiresAt: user.dayPassExpiresAt }
        });
    } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            message: 'Login successful', token,
            user: { id: user.id, email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus, dayPassExpiresAt: user.dayPassExpiresAt }
        });
    } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, email: true, name: true, subscriptionStatus: true, dayPassExpiresAt: true, createdAt: true }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    } catch (err) { next(err); }
});

module.exports = router;
