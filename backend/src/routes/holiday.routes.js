const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, isAdmin } = require('../middleware/auth');
const { holidayValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Get all holidays
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { year } = req.query;
        const targetYear = year || new Date().getFullYear();

        const result = await query(
            `SELECT h.*, 
                    creator.first_name || ' ' || creator.last_name as created_by_name
             FROM holidays h
             LEFT JOIN users creator ON h.created_by = creator.id
             WHERE h.year = $1
             ORDER BY h.date`,
            [targetYear]
        );

        res.json({
            success: true,
            data: result.rows,
            year: targetYear
        });
    } catch (error) {
        next(error);
    }
});

// Get upcoming holidays
router.get('/upcoming', authenticate, async (req, res, next) => {
    try {
        const result = await query(
            `SELECT * FROM holidays
             WHERE date >= CURRENT_DATE
             ORDER BY date
             LIMIT 10`
        );

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        next(error);
    }
});

// Check if date is holiday
router.get('/check/:date', authenticate, async (req, res, next) => {
    try {
        const { date } = req.params;

        const result = await query(
            'SELECT * FROM holidays WHERE date = $1',
            [date]
        );

        res.json({
            success: true,
            is_holiday: result.rows.length > 0,
            data: result.rows[0] || null
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

        const result = await query(
            `INSERT INTO holidays (name, date, description, is_optional, year, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [name, date, description, is_optional || false, year, req.user.id]
        );

        await createAuditLog(req.user.id, 'CREATE', 'holidays', result.rows[0].id,
            null, { name, date }, 'Holiday created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Holiday created successfully',
            data: result.rows[0]
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
        const currentResult = await query('SELECT * FROM holidays WHERE id = $1', [id]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        const year = date ? new Date(date).getFullYear() : currentResult.rows[0].year;

        const result = await query(
            `UPDATE holidays 
             SET name = COALESCE($1, name),
                 date = COALESCE($2, date),
                 description = COALESCE($3, description),
                 is_optional = COALESCE($4, is_optional),
                 year = $5
             WHERE id = $6
             RETURNING *`,
            [name, date, description, is_optional, year, id]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'holidays', id,
            currentResult.rows[0], req.body, 'Holiday updated', req.ip);

        res.json({
            success: true,
            message: 'Holiday updated successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Delete holiday (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await query(
            'DELETE FROM holidays WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'holidays', id,
            result.rows[0], null, 'Holiday deleted', req.ip);

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
                const result = await query(
                    `INSERT INTO holidays (name, date, description, is_optional, year, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (date) DO UPDATE SET name = $1, description = $3
                     RETURNING *`,
                    [name, date, description, is_optional || false, year, req.user.id]
                );
                results.push({ success: true, data: result.rows[0] });
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
