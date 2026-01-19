const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, isAdmin } = require('../middleware/auth');
const { holidayValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Get all holidays
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { year } = req.query;
        const targetYear = parseInt(year) || new Date().getFullYear();

        const holidays = await prisma.holiday.findMany({
            where: { year: targetYear },
            include: {
                createdBy: {
                    select: {
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { date: 'asc' }
        });

        res.json({
            success: true,
            data: holidays.map(h => ({
                id: h.id,
                name: h.name,
                date: h.date,
                description: h.description,
                is_optional: h.isOptional,
                year: h.year,
                created_by: h.createdById,
                created_at: h.createdAt,
                updated_at: h.updatedAt,
                created_by_name: h.createdBy ? `${h.createdBy.firstName} ${h.createdBy.lastName}` : null
            })),
            year: targetYear
        });
    } catch (error) {
        next(error);
    }
});

// Get upcoming holidays
router.get('/upcoming', authenticate, async (req, res, next) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const holidays = await prisma.holiday.findMany({
            where: {
                date: { gte: today }
            },
            orderBy: { date: 'asc' },
            take: 10
        });

        res.json({
            success: true,
            data: holidays.map(h => ({
                id: h.id,
                name: h.name,
                date: h.date,
                description: h.description,
                is_optional: h.isOptional,
                year: h.year,
                created_at: h.createdAt,
                updated_at: h.updatedAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Check if date is holiday
router.get('/check/:date', authenticate, async (req, res, next) => {
    try {
        const { date } = req.params;

        const holiday = await prisma.holiday.findUnique({
            where: { date: new Date(date) }
        });

        res.json({
            success: true,
            is_holiday: !!holiday,
            data: holiday ? {
                id: holiday.id,
                name: holiday.name,
                date: holiday.date,
                description: holiday.description,
                is_optional: holiday.isOptional,
                year: holiday.year
            } : null
        });
    } catch (error) {
        next(error);
    }
});

// Create holiday (Admin only)
router.post('/', authenticate, isAdmin, holidayValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { name, date, description, is_optional } = req.body;
        const year = new Date(date).getFullYear();

        const holiday = await prisma.holiday.create({
            data: {
                name,
                date: new Date(date),
                description,
                isOptional: is_optional || false,
                year,
                createdById: req.user.id
            }
        });

        await createAuditLog(req.user.id, 'CREATE', 'holidays', holiday.id,
            null, { name, date }, 'Holiday created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Holiday created successfully',
            data: {
                id: holiday.id,
                name: holiday.name,
                date: holiday.date,
                description: holiday.description,
                is_optional: holiday.isOptional,
                year: holiday.year,
                created_by: holiday.createdById,
                created_at: holiday.createdAt,
                updated_at: holiday.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Update holiday (Admin only)
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, date, description, is_optional } = req.body;

        // Get current data
        const currentHoliday = await prisma.holiday.findUnique({ where: { id } });
        if (!currentHoliday) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        const year = date ? new Date(date).getFullYear() : currentHoliday.year;

        const updateData = { year };
        if (name !== undefined) updateData.name = name;
        if (date !== undefined) updateData.date = new Date(date);
        if (description !== undefined) updateData.description = description;
        if (is_optional !== undefined) updateData.isOptional = is_optional;

        const holiday = await prisma.holiday.update({
            where: { id },
            data: updateData
        });

        await createAuditLog(req.user.id, 'UPDATE', 'holidays', id,
            { name: currentHoliday.name, date: currentHoliday.date }, req.body, 'Holiday updated', req.ip);

        res.json({
            success: true,
            message: 'Holiday updated successfully',
            data: {
                id: holiday.id,
                name: holiday.name,
                date: holiday.date,
                description: holiday.description,
                is_optional: holiday.isOptional,
                year: holiday.year,
                created_at: holiday.createdAt,
                updated_at: holiday.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Delete holiday (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        const holiday = await prisma.holiday.delete({
            where: { id }
        }).catch(() => null);

        if (!holiday) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'holidays', id,
            { name: holiday.name, date: holiday.date }, null, 'Holiday deleted', req.ip);

        res.json({
            success: true,
            message: 'Holiday deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Bulk create holidays (Admin only)
router.post('/bulk', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { holidays } = req.body;

        if (!Array.isArray(holidays) || holidays.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Holidays array is required'
            });
        }

        const results = [];
        for (const holiday of holidays) {
            const { name, date, description, is_optional } = holiday;
            const year = new Date(date).getFullYear();

            try {
                const result = await prisma.holiday.upsert({
                    where: { date: new Date(date) },
                    update: { name, description },
                    create: {
                        name,
                        date: new Date(date),
                        description,
                        isOptional: is_optional || false,
                        year,
                        createdById: req.user.id
                    }
                });
                results.push({
                    success: true,
                    data: {
                        id: result.id,
                        name: result.name,
                        date: result.date,
                        description: result.description,
                        is_optional: result.isOptional,
                        year: result.year
                    }
                });
            } catch (err) {
                results.push({ success: false, error: err.message, holiday });
            }
        }

        res.json({
            success: true,
            message: `${results.filter(r => r.success).length} holidays processed`,
            data: results
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
