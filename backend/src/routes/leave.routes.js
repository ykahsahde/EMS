const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, authorize, canAccessEmployee } = require('../middleware/auth');
const { leaveValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Apply for leave
router.post('/apply', authenticate, leaveValidation.apply, async (req, res, next) => {
    try {
        console.log('Leave apply request body:', req.body);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log('Validation errors:', errors.array());
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { leave_type, start_date, end_date, reason, attachment_url } = req.body;

        // Calculate total days
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        // Check leave balance
        const balanceResult = await query(
            `SELECT * FROM leave_balances 
             WHERE user_id = $1 AND year = EXTRACT(YEAR FROM $2::date)`,
            [req.user.id, start_date]
        );

        if (balanceResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Leave balance not found for this year'
            });
        }

        const balance = balanceResult.rows[0];
        const leaveTypeColumn = leave_type.toLowerCase();
        
        if (leave_type !== 'UNPAID') {
            const available = balance[`${leaveTypeColumn}_total`] - balance[`${leaveTypeColumn}_used`] - balance[`${leaveTypeColumn}_pending`];
            if (totalDays > available) {
                return res.status(400).json({
                    success: false,
                    error: `Insufficient ${leave_type} leave balance. Available: ${available} days`
                });
            }
        }

        // Check for overlapping leave requests
        const overlapResult = await query(
            `SELECT * FROM leave_requests
             WHERE user_id = $1 
             AND status IN ('PENDING', 'APPROVED')
             AND ((start_date <= $2 AND end_date >= $2) 
                  OR (start_date <= $3 AND end_date >= $3)
                  OR (start_date >= $2 AND end_date <= $3))`,
            [req.user.id, start_date, end_date]
        );

        if (overlapResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'You already have a leave request for overlapping dates'
            });
        }

        const result = await transaction(async (client) => {
            // Create leave request
            const leaveResult = await client.query(
                `INSERT INTO leave_requests 
                 (user_id, leave_type, start_date, end_date, total_days, reason, attachment_url)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [req.user.id, leave_type, start_date, end_date, totalDays, reason, attachment_url]
            );

            // Update pending leave balance
            if (leave_type !== 'UNPAID') {
                await client.query(
                    `UPDATE leave_balances 
                     SET ${leaveTypeColumn}_pending = ${leaveTypeColumn}_pending + $1
                     WHERE user_id = $2 AND year = EXTRACT(YEAR FROM $3::date)`,
                    [totalDays, req.user.id, start_date]
                );
            } else {
                await client.query(
                    `UPDATE leave_balances 
                     SET unpaid_pending = unpaid_pending + $1
                     WHERE user_id = $2 AND year = EXTRACT(YEAR FROM $3::date)`,
                    [totalDays, req.user.id, start_date]
                );
            }

            return leaveResult.rows[0];
        });

        await createAuditLog(req.user.id, 'CREATE', 'leave_requests', result.id, null,
            { leave_type, start_date, end_date, total_days: totalDays }, 'Leave application submitted', req.ip);

        res.status(201).json({
            success: true,
            message: 'Leave request submitted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

// Get my leave requests
router.get('/my-leaves', authenticate, async (req, res, next) => {
    try {
        const { status, year } = req.query;
        const currentYear = year || new Date().getFullYear();

        let queryText = `
            SELECT lr.*, 
                   approver.first_name || ' ' || approver.last_name as approved_by_name
            FROM leave_requests lr
            LEFT JOIN users approver ON lr.approved_by = approver.id
            WHERE lr.user_id = $1
            AND EXTRACT(YEAR FROM lr.start_date) = $2
        `;
        const params = [req.user.id, currentYear];

        if (status) {
            queryText += ` AND lr.status = $3`;
            params.push(status);
        }

        queryText += ` ORDER BY lr.created_at DESC`;

        const result = await query(queryText, params);

        // Get leave balance
        const balanceResult = await query(
            `SELECT * FROM leave_balances WHERE user_id = $1 AND year = $2`,
            [req.user.id, currentYear]
        );

        res.json({
            success: true,
            data: {
                requests: result.rows,
                balance: balanceResult.rows[0] || null
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get pending leave requests (for Manager/GM/Admin)
// HR cannot approve leaves - removed from authorize
router.get('/pending', authenticate, authorize('MANAGER', 'ADMIN', 'GM'), async (req, res, next) => {
    try {
        let queryText = `
            SELECT lr.*, 
                   u.employee_id, u.first_name, u.last_name, u.email, u.role as applicant_role,
                   d.name as department_name
            FROM leave_requests lr
            JOIN users u ON lr.user_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE lr.status = 'PENDING'
            AND lr.user_id != $1
        `;
        const params = [req.user.id]; // Exclude own leave requests (prevent self-approval)

        // Manager can only see pending requests from their department (excluding admin leaves)
        if (req.user.role === 'MANAGER') {
            queryText += ` AND u.department_id = $2 AND u.role NOT IN ('ADMIN', 'GM')`;
            params.push(req.user.department_id);
        }
        // Admin can see all leaves EXCEPT other admin leaves (admin leaves go to GM only)
        else if (req.user.role === 'ADMIN') {
            queryText += ` AND u.role != 'ADMIN'`;
        }
        // GM can see all pending leaves (including admin leaves)

        queryText += ` ORDER BY lr.created_at ASC`;

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows.map(req => ({
                ...req,
                employee_name: `${req.first_name} ${req.last_name}`
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Approve/Reject leave request (Manager, GM, Admin only - HR removed)
router.patch('/:id/approve', authenticate, authorize('MANAGER', 'GM', 'ADMIN'), leaveValidation.approve, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const { status, rejection_reason } = req.body;

        // Get leave request with applicant's role
        const leaveResult = await query(
            `SELECT lr.*, u.manager_id, u.department_id, u.role as applicant_role
             FROM leave_requests lr
             JOIN users u ON lr.user_id = u.id
             WHERE lr.id = $1`,
            [id]
        );

        if (leaveResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        const leaveRequest = leaveResult.rows[0];

        // RULE 1: Prevent self-approval
        if (leaveRequest.user_id === req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'You cannot approve your own leave request'
            });
        }

        // RULE 2: Admin leaves can ONLY be approved by GM
        if (leaveRequest.applicant_role === 'ADMIN' && req.user.role !== 'GM') {
            return res.status(403).json({
                success: false,
                error: 'Admin leave requests can only be approved by GM'
            });
        }

        // RULE 3: Manager can only approve their department's employees (not admin/GM)
        if (req.user.role === 'MANAGER') {
            if (leaveRequest.department_id !== req.user.department_id) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only approve/reject leave requests of your department members'
                });
            }
            if (['ADMIN', 'GM'].includes(leaveRequest.applicant_role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Managers cannot approve Admin or GM leave requests'
                });
            }
        }

        // RULE 4: Admin can approve any leave EXCEPT other admin leaves
        if (req.user.role === 'ADMIN' && leaveRequest.applicant_role === 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'Admin leave requests can only be approved by GM'
            });
        }

        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'This leave request has already been processed'
            });
        }

        const result = await transaction(async (client) => {
            // Update leave request
            const updateResult = await client.query(
                `UPDATE leave_requests 
                 SET status = $1, approved_by = $2, approved_at = NOW(), rejection_reason = $3
                 WHERE id = $4
                 RETURNING *`,
                [status, req.user.id, rejection_reason || null, id]
            );

            const leaveType = leaveRequest.leave_type.toLowerCase();
            const totalDays = leaveRequest.total_days;
            const year = new Date(leaveRequest.start_date).getFullYear();

            if (status === 'APPROVED') {
                // Update leave balance - move from pending to used
                if (leaveRequest.leave_type !== 'UNPAID') {
                    await client.query(
                        `UPDATE leave_balances 
                         SET ${leaveType}_pending = ${leaveType}_pending - $1,
                             ${leaveType}_used = ${leaveType}_used + $1
                         WHERE user_id = $2 AND year = $3`,
                        [totalDays, leaveRequest.user_id, year]
                    );
                } else {
                    await client.query(
                        `UPDATE leave_balances 
                         SET unpaid_pending = unpaid_pending - $1,
                             unpaid_used = unpaid_used + $1
                         WHERE user_id = $2 AND year = $3`,
                        [totalDays, leaveRequest.user_id, year]
                    );
                }

                // Mark attendance as ON_LEAVE for approved dates
                const startDate = new Date(leaveRequest.start_date);
                const endDate = new Date(leaveRequest.end_date);
                
                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    await client.query(
                        `INSERT INTO attendance_records (user_id, date, status, notes)
                         VALUES ($1, $2, 'ON_LEAVE', $3)
                         ON CONFLICT (user_id, date) 
                         DO UPDATE SET status = 'ON_LEAVE', notes = $3`,
                        [leaveRequest.user_id, dateStr, `Leave: ${leaveRequest.leave_type}`]
                    );
                }
            } else {
                // Rejected - remove from pending
                if (leaveRequest.leave_type !== 'UNPAID') {
                    await client.query(
                        `UPDATE leave_balances 
                         SET ${leaveType}_pending = ${leaveType}_pending - $1
                         WHERE user_id = $2 AND year = $3`,
                        [totalDays, leaveRequest.user_id, year]
                    );
                } else {
                    await client.query(
                        `UPDATE leave_balances 
                         SET unpaid_pending = unpaid_pending - $1
                         WHERE user_id = $2 AND year = $3`,
                        [totalDays, leaveRequest.user_id, year]
                    );
                }
            }

            return updateResult.rows[0];
        });

        await createAuditLog(req.user.id, 'UPDATE', 'leave_requests', id,
            { status: 'PENDING' }, { status, rejection_reason },
            `Leave ${status.toLowerCase()}`, req.ip);

        res.json({
            success: true,
            message: `Leave request ${status.toLowerCase()}`,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

// Cancel leave request (by employee)
router.patch('/:id/cancel', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        const leaveResult = await query(
            'SELECT * FROM leave_requests WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (leaveResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        const leaveRequest = leaveResult.rows[0];

        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Only pending leave requests can be cancelled'
            });
        }

        const result = await transaction(async (client) => {
            // Update leave request
            const updateResult = await client.query(
                `UPDATE leave_requests SET status = 'CANCELLED' WHERE id = $1 RETURNING *`,
                [id]
            );

            // Restore leave balance
            const leaveType = leaveRequest.leave_type.toLowerCase();
            const year = new Date(leaveRequest.start_date).getFullYear();

            if (leaveRequest.leave_type !== 'UNPAID') {
                await client.query(
                    `UPDATE leave_balances 
                     SET ${leaveType}_pending = ${leaveType}_pending - $1
                     WHERE user_id = $2 AND year = $3`,
                    [leaveRequest.total_days, req.user.id, year]
                );
            } else {
                await client.query(
                    `UPDATE leave_balances 
                     SET unpaid_pending = unpaid_pending - $1
                     WHERE user_id = $2 AND year = $3`,
                    [leaveRequest.total_days, req.user.id, year]
                );
            }

            return updateResult.rows[0];
        });

        await createAuditLog(req.user.id, 'UPDATE', 'leave_requests', id,
            { status: 'PENDING' }, { status: 'CANCELLED' },
            'Leave request cancelled by employee', req.ip);

        res.json({
            success: true,
            message: 'Leave request cancelled',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

// Get all leave requests (Admin/HR/GM/Manager)
router.get('/', authenticate, authorize('ADMIN', 'HR', 'GM', 'MANAGER'), async (req, res, next) => {
    try {
        const { status, department_id, user_id, start_date, end_date, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let queryText = `
            SELECT lr.*, 
                   u.employee_id, u.first_name, u.last_name, u.email,
                   d.name as department_name,
                   approver.first_name || ' ' || approver.last_name as approved_by_name
            FROM leave_requests lr
            JOIN users u ON lr.user_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN users approver ON lr.approved_by = approver.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        // Manager can only see their department's leave requests
        if (req.user.role === 'MANAGER') {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(req.user.department_id);
        } else if (department_id) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        if (status) {
            paramCount++;
            queryText += ` AND lr.status = $${paramCount}`;
            params.push(status);
        }

        if (user_id) {
            paramCount++;
            queryText += ` AND lr.user_id = $${paramCount}`;
            params.push(user_id);
        }

        if (start_date) {
            paramCount++;
            queryText += ` AND lr.start_date >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            queryText += ` AND lr.end_date <= $${paramCount}`;
            params.push(end_date);
        }

        // Get count
        const countResult = await query(
            queryText.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM'),
            params
        );
        const totalCount = parseInt(countResult.rows[0].count);

        queryText += ` ORDER BY lr.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows.map(req => ({
                ...req,
                employee_name: `${req.first_name} ${req.last_name}`
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                pages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get current user's leave balance
router.get('/balance/me', authenticate, async (req, res, next) => {
    try {
        const year = req.query.year || new Date().getFullYear();

        const result = await query(
            `SELECT lb.*, 
                    u.first_name, u.last_name, u.employee_id
             FROM leave_balances lb
             JOIN users u ON lb.user_id = u.id
             WHERE lb.user_id = $1 AND lb.year = $2`,
            [req.user.id, year]
        );

        if (result.rows.length === 0) {
            // Create leave balance for this year if it doesn't exist
            const createResult = await query(
                `INSERT INTO leave_balances (user_id, year)
                 VALUES ($1, $2)
                 RETURNING *`,
                [req.user.id, year]
            );
            
            const balance = createResult.rows[0];
            return res.json({
                success: true,
                data: {
                    ...balance,
                    casual_available: balance.casual_total - balance.casual_used - balance.casual_pending,
                    sick_available: balance.sick_total - balance.sick_used - balance.sick_pending,
                    paid_available: balance.paid_total - balance.paid_used - balance.paid_pending
                }
            });
        }

        const balance = result.rows[0];

        res.json({
            success: true,
            data: {
                ...balance,
                casual_available: balance.casual_total - balance.casual_used - balance.casual_pending,
                sick_available: balance.sick_total - balance.sick_used - balance.sick_pending,
                paid_available: balance.paid_total - balance.paid_used - balance.paid_pending
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get leave balance for user
router.get('/balance/:userId', authenticate, canAccessEmployee, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const year = req.query.year || new Date().getFullYear();

        const result = await query(
            `SELECT lb.*, 
                    u.first_name, u.last_name, u.employee_id
             FROM leave_balances lb
             JOIN users u ON lb.user_id = u.id
             WHERE lb.user_id = $1 AND lb.year = $2`,
            [userId, year]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave balance not found'
            });
        }

        const balance = result.rows[0];

        res.json({
            success: true,
            data: {
                ...balance,
                casual_available: balance.casual_total - balance.casual_used - balance.casual_pending,
                sick_available: balance.sick_total - balance.sick_used - balance.sick_pending,
                paid_available: balance.paid_total - balance.paid_used - balance.paid_pending
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
