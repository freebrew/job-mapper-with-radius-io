const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');

/**
 * POST /api/notes
 * Save or update a note for a job.
 * Body: { indeedJobId, noteText }   ← client sends indeedJobId (the scraped key)
 *       OR { jobResultId, noteText } ← direct DB UUID (legacy / future)
 *
 * Looks up the JobResult row by indeedJobId to get the real UUID FK,
 * then upserts the note by (userId, jobResultId).
 */
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { indeedJobId, jobResultId: directId, noteText, isHidden, followUpDate } = req.body;

        // Resolve — a job may appear in multiple search profiles (different JobResult rows).
        // Find ALL matching jobResult IDs so we can search for an existing note across any of them.
        let jobResultId = directId || null;

        if (!jobResultId && indeedJobId) {
            // 1. Find any existing note for this job (across all search profiles)
            const existingNote = await prisma.userJobNote.findFirst({
                where: {
                    userId,
                    jobResult: { indeedJobId }
                },
                select: { jobResultId: true }
            });

            if (existingNote) {
                // Reuse the same jobResultId so the upsert updates the existing note
                jobResultId = existingNote.jobResultId;
            } else {
                // No existing note — find any JobResult to create against
                const jr = await prisma.jobResult.findFirst({
                    where: { indeedJobId },
                    orderBy: { scrapedAt: 'desc' },
                    select: { id: true }
                });
                if (!jr) {
                    return res.status(404).json({ error: `No saved job found for indeedJobId: ${indeedJobId}` });
                }
                jobResultId = jr.id;
            }
        }

        if (!jobResultId) {
            return res.status(400).json({ error: 'indeedJobId or jobResultId is required.' });
        }

        const note = await prisma.userJobNote.upsert({
            where: {
                userId_jobResultId: { userId, jobResultId }
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
 * GET /api/notes/by-job/:indeedJobId
 * Fetch a saved note for a specific job (by its scraped key).
 * Searches across ALL jobResult rows for this indeedJobId (job may appear in multiple searches).
 * Returns { success: true, data: note } or { success: true, data: null } if no note exists.
 */
router.get('/by-job/:indeedJobId', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { indeedJobId } = req.params;

        // Search across all JobResult copies for this indeedJobId
        const note = await prisma.userJobNote.findFirst({
            where: {
                userId,
                jobResult: { indeedJobId }
            }
        });

        res.json({ success: true, data: note || null });
    } catch (err) {
        next(err);
    }
});

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
