const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticate, isAdmin, isHROrAdmin } = require('../middleware/auth');
const { departmentValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Get all departments
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { is_active } = req.query;

        let queryText = `
            SELECT d.*, 
                   head.first_name || ' ' || head.last_name as head_name,
                   head.email as head_email,
                   COUNT(u.id) as employee_count
            FROM departments d
            LEFT JOIN users head ON d.head_id = head.id
            LEFT JOIN users u ON u.department_id = d.id AND u.status = 'ACTIVE'
        `;
        const params = [];

        if (is_active !== undefined) {
            queryText += ` WHERE d.is_active = $1`;
            params.push(is_active === 'true');
        }

        queryText += ` GROUP BY d.id, head.first_name, head.last_name, head.email ORDER BY d.name`;

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        next(error);
    }
});

// Get department by ID
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT d.*, 
                    head.first_name || ' ' || head.last_name as head_name,
                    head.email as head_email
             FROM departments d
             LEFT JOIN users head ON d.head_id = head.id
             WHERE d.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        // Get employees in department
        const employeesResult = await query(
            `SELECT id, employee_id, first_name, last_name, email, role, status
             FROM users WHERE department_id = $1 ORDER BY first_name`,
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

// Create department (Admin only)
router.post('/', authenticate, isAdmin, departmentValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { name, code, description, head_id } = req.body;

        const result = await query(
            `INSERT INTO departments (name, code, description, head_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [name, code, description, head_id]
        );

        await createAuditLog(req.user.id, 'CREATE', 'departments', result.rows[0].id,
            null, { name, code }, 'Department created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Department created successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Update department (Admin only)
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, description, head_id, is_active } = req.body;

        // Get current data
        const currentResult = await query('SELECT * FROM departments WHERE id = $1', [id]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        const result = await query(
            `UPDATE departments 
             SET name = COALESCE($1, name),
                 code = COALESCE($2, code),
                 description = COALESCE($3, description),
                 head_id = $4,
                 is_active = COALESCE($5, is_active)
             WHERE id = $6
             RETURNING *`,
            [name, code, description, head_id, is_active, id]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'departments', id,
            currentResult.rows[0], req.body, 'Department updated', req.ip);

        res.json({
            success: true,
            message: 'Department updated successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Delete department (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if department has employees
        const employeeCheck = await query(
            'SELECT COUNT(*) FROM users WHERE department_id = $1',
            [id]
        );

        if (parseInt(employeeCheck.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete department with assigned employees'
            });
        }

        const result = await query(
            'DELETE FROM departments WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'departments', id,
            result.rows[0], null, 'Department deleted', req.ip);

        res.json({
            success: true,
            message: 'Department deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
