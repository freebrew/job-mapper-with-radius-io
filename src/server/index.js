const fs = require('fs');
const path = require('path');

// Try loading .env from one level above the project root first (e.g. outside public_html)
const parentEnv = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(parentEnv)) {
    require('dotenv').config({ path: parentEnv });
} else {
    // Fall back to standard project root
    require('dotenv').config();
}
// ── Process-level safety net ─────────────────────────────────────────────────
// One bad request must never crash the entire server.
// Log all uncaught exceptions / unhandled rejections and stay alive.
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

// Route Imports
const authRoutes = require('./routes/auth.routes');
const jobsRoutes = require('./routes/jobs.routes');
const notesRoutes = require('./routes/notes.routes');
const paymentRoutes = require('./routes/payment.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const alertsRoutes = require('./routes/alerts.routes');
const adminRoutes = require('./routes/admin.routes');
const buildingsRoutes = require('./routes/buildings.routes');

const app = express();

// Trust the PHP reverse proxy (sets X-Forwarded-For).
// Required for express-rate-limit to identify clients correctly.
app.set('trust proxy', 1);


app.use(helmet());
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? ['https://jobradius.agent-swarm.net', 'https://www.jobradius.agent-swarm.net']
        : '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate Limiting (General API Limit)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/buildings', buildingsRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal Server Error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        }
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`[JobRadius API] Server running on port ${PORT}`);
});
