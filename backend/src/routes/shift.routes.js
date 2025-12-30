const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, isAdmin } = require('../middleware/auth');
const { shiftValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Get all shifts
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { is_active } = req.query;

        let queryText = `
            SELECT s.*, 
                   COUNT(u.id) as employee_count
            FROM shifts s
            LEFT JOIN users u ON u.shift_id = s.id AND u.status = 'ACTIVE'
        `;
        const params = [];

        if (is_active !== undefined) {
            queryText += ` WHERE s.is_active = $1`;
            params.push(is_active === 'true');
        }

        queryText += ` GROUP BY s.id ORDER BY s.start_time`;

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        next(error);
    }
});

// Get shift by ID
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await query('SELECT * FROM shifts WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Shift not found'
            });
        }

        // Get employees in this shift
        const employeesResult = await query(
            `SELECT id, employee_id, first_name, last_name, email, department_id
             FROM users WHERE shift_id = $1 AND status = 'ACTIVE' ORDER BY first_name`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...result.rows[0],
                employees: employeesResult.rows.map(emp => ({
                    ...emp,
                    full_name: `${emp.first_name} ${emp.last_name}`
                }))
            }
        });
    } catch (error) {
        next(error);
    }
});

// Create shift (Admin only)
router.post('/', authenticate, isAdmin, shiftValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { name, code, shift_type, start_time, end_time, grace_period_minutes, half_day_hours, full_day_hours } = req.body;

        const result = await query(
            `INSERT INTO shifts (name, code, shift_type, start_time, end_time, grace_period_minutes, half_day_hours, full_day_hours)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [name, code, shift_type, start_time, end_time, grace_period_minutes || 15, half_day_hours || 4, full_day_hours || 8]
        );

        await createAuditLog(req.user.id, 'CREATE', 'shifts', result.rows[0].id,
            null, { name, code, shift_type }, 'Shift created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Shift created successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Update shift (Admin only)
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, shift_type, start_time, end_time, grace_period_minutes, half_day_hours, full_day_hours, is_active } = req.body;

        // Get current data
        const currentResult = await query('SELECT * FROM shifts WHERE id = $1', [id]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Shift not found'
            });
        }

        const result = await query(
            `UPDATE shifts 
             SET name = COALESCE($1, name),
                 code = COALESCE($2, code),
                 shift_type = COALESCE($3, shift_type),
                 start_time = COALESCE($4, start_time),
                 end_time = COALESCE($5, end_time),
                 grace_period_minutes = COALESCE($6, grace_period_minutes),
                 half_day_hours = COALESCE($7, half_day_hours),
                 full_day_hours = COALESCE($8, full_day_hours),
                 is_active = COALESCE($9, is_active)
             WHERE id = $10
             RETURNING *`,
            [name, code, shift_type, start_time, end_time, grace_period_minutes, half_day_hours, full_day_hours, is_active, id]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'shifts', id,
            currentResult.rows[0], req.body, 'Shift updated', req.ip);

        res.json({
            success: true,
            message: 'Shift updated successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Delete shift (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if shift has employees
        const employeeCheck = await query(
            'SELECT COUNT(*) FROM users WHERE shift_id = $1',
            [id]
        );

        if (parseInt(employeeCheck.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete shift with assigned employees'
            });
        }

        const result = await query(
            'DELETE FROM shifts WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Shift not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'shifts', id,
            result.rows[0], null, 'Shift deleted', req.ip);

        res.json({
            success: true,
            message: 'Shift deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Assign shift to employee
router.post('/assign', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { user_id, shift_id } = req.body;

        if (!user_id || !shift_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Shift ID are required'
            });
        }

        const result = await query(
            `UPDATE users SET shift_id = $1 WHERE id = $2 RETURNING id, employee_id, first_name, last_name, shift_id`,
            [shift_id, user_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'users', user_id,
            null, { shift_id }, 'Shift assigned', req.ip);

        res.json({
            success: true,
            message: 'Shift assigned successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
