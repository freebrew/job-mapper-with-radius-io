const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

/**
 * POST /api/notes
 * Save or update a note for a job.
 * Body: { jobResultId, noteText, isHidden, followUpDate }
 * 
 * The client should pass the jobResultId from the search results.
 * Upserts by (userId, jobResultId).
 */
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { jobResultId, noteText, isHidden, followUpDate } = req.body;

        if (!jobResultId) {
            return res.status(400).json({ error: 'jobResultId is required.' });
        }

        const note = await prisma.userJobNote.upsert({
            where: {
                userId_jobResultId: {
                    userId,
                    jobResultId
                }
            },
            update: {
                noteText: noteText !== undefined ? noteText : undefined,
                isHidden: isHidden !== undefined ? isHidden : undefined,
                followUpDate: followUpDate ? new Date(followUpDate) : undefined
            },
            create: {
                userId,
                jobResultId,
                noteText: noteText || null,
                isHidden: isHidden || false,
                followUpDate: followUpDate ? new Date(followUpDate) : null
            }
        });

        res.json({ success: true, data: note });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/notes
 * Get all job notes for the logged-in user.
 */
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const notes = await prisma.userJobNote.findMany({
            where: { userId },
            include: {
                jobResult: {
                    select: { title: true, company: true, location: true, indeedUrl: true }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.json({ success: true, data: notes });
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/notes/:id/hide
 * Mark a job as hidden for the user.
 */
router.patch('/:id/hide', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const note = await prisma.userJobNote.updateMany({
            where: { id, userId },
            data: { isHidden: true }
        });

        res.json({ success: true, updated: note.count });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
