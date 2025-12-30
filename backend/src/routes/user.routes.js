const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, authorize, isAdmin, isHROrAdmin, isGMOrAdmin, isManagerOrAbove, canAccessEmployee } = require('../middleware/auth');
const { userValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Middleware to allow Admin, HR, GM, or Manager to access user management
const canManageUsers = authorize('ADMIN', 'HR', 'GM', 'MANAGER');

// Get next employee ID for a department (preview)
router.get('/next-employee-id/:departmentId', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { departmentId } = req.params;
        
        // Get department code
        const deptResult = await query(
            'SELECT code FROM departments WHERE id = $1',
            [departmentId]
        );
        
        if (deptResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }
        
        const deptCode = deptResult.rows[0].code;
        
        // Get the highest employee ID number for this department
        const maxIdResult = await query(
            `SELECT employee_id FROM users 
             WHERE employee_id LIKE $1 
             ORDER BY employee_id DESC LIMIT 1`,
            [deptCode + '%']
        );
        
        let nextNumber = 1;
        if (maxIdResult.rows.length > 0) {
            const lastId = maxIdResult.rows[0].employee_id;
            const numPart = lastId.replace(deptCode, '');
            nextNumber = parseInt(numPart, 10) + 1;
        }
        
        const nextEmployeeId = deptCode + nextNumber.toString().padStart(3, '0');
        
        res.json({
            success: true,
            data: {
                next_employee_id: nextEmployeeId,
                department_code: deptCode
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get all users (Admin, HR, GM see all; Manager sees only their department)
router.get('/', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { department_id, role, status, search, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        
        let queryText = `
            SELECT u.id, u.employee_id, u.email, u.first_name, u.last_name, u.phone,
                   u.role, u.status, u.date_of_joining, u.profile_picture_url,
                   u.face_registered_at, u.last_login, u.created_at, u.department_id,
                   d.name as department_name, s.name as shift_name,
                   m.first_name || ' ' || m.last_name as manager_name, u.manager_id
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN shifts s ON u.shift_id = s.id
            LEFT JOIN users m ON u.manager_id = m.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        // Manager can only see employees in their department or their direct reports
        if (req.user.role === 'MANAGER') {
            paramCount++;
            queryText += ` AND (u.department_id = $${paramCount} OR u.manager_id = $${paramCount + 1})`;
            params.push(req.user.department_id, req.user.id);
            paramCount++;
        } else if (department_id) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        if (role) {
            paramCount++;
            queryText += ` AND u.role = $${paramCount}`;
            params.push(role);
        }

        if (status) {
            paramCount++;
            queryText += ` AND u.status = $${paramCount}`;
            params.push(status);
        }

        if (search) {
            paramCount++;
            queryText += ` AND (u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount} 
                          OR u.email ILIKE $${paramCount} OR u.employee_id ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        // Get total count
        const countResult = await query(
            queryText.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM'),
            params
        );
        const totalCount = parseInt(countResult.rows[0].count);

        // Add pagination
        queryText += ` ORDER BY u.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows.map(user => ({
                ...user,
                full_name: `${user.first_name} ${user.last_name}`,
                face_registered: !!user.face_registered_at
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

// Get user by ID
router.get('/:id', authenticate, canAccessEmployee, async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT u.*, d.name as department_name, s.name as shift_name,
                    m.first_name || ' ' || m.last_name as manager_name, m.email as manager_email
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             LEFT JOIN shifts s ON u.shift_id = s.id
             LEFT JOIN users m ON u.manager_id = m.id
             WHERE u.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = result.rows[0];
        delete user.password_hash;
        delete user.face_descriptor;

        res.json({
            success: true,
            data: {
                ...user,
                full_name: `${user.first_name} ${user.last_name}`,
                face_registered: !!user.face_registered_at
            }
        });
    } catch (error) {
        next(error);
    }
});

// Create new user (Admin, HR, GM, Manager)
router.post('/', authenticate, canManageUsers, userValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const {
            email, password, first_name, last_name, phone,
            role, department_id, shift_id, manager_id, date_of_joining,
            date_of_birth, address, emergency_contact
        } = req.body;

        // Role-based restrictions
        if (req.user.role === 'HR' && (role === 'ADMIN' || role === 'GM')) {
            return res.status(403).json({
                success: false,
                error: 'HR cannot assign Admin or GM role'
            });
        }

        // Manager can only create EMPLOYEE role and only in their own department
        if (req.user.role === 'MANAGER') {
            if (role && role !== 'EMPLOYEE') {
                return res.status(403).json({
                    success: false,
                    error: 'Manager can only create employees, not other roles'
                });
            }
            if (department_id && department_id !== req.user.department_id) {
                return res.status(403).json({
                    success: false,
                    error: 'Manager can only add employees to their own department'
                });
            }
        }

        // Set department_id for Manager creating employee
        const finalDepartmentId = req.user.role === 'MANAGER' ? req.user.department_id : department_id;

        // Auto-generate employee ID based on department
        let employee_id;
        if (finalDepartmentId) {
            // Get department code
            const deptResult = await query(
                'SELECT code FROM departments WHERE id = $1',
                [finalDepartmentId]
            );
            
            if (deptResult.rows.length > 0) {
                const deptCode = deptResult.rows[0].code;
                
                // Get the highest employee ID number for this department
                const maxIdResult = await query(
                    `SELECT employee_id FROM users 
                     WHERE employee_id LIKE $1 
                     ORDER BY employee_id DESC LIMIT 1`,
                    [deptCode + '%']
                );
                
                let nextNumber = 1;
                if (maxIdResult.rows.length > 0) {
                    const lastId = maxIdResult.rows[0].employee_id;
                    // Extract the number part (e.g., from HR005, extract 5)
                    const numPart = lastId.replace(deptCode, '');
                    nextNumber = parseInt(numPart, 10) + 1;
                }
                
                // Generate new employee ID with 3 digits padding (e.g., HR001, IT002)
                employee_id = deptCode + nextNumber.toString().padStart(3, '0');
            } else {
                // Fallback if department not found - use generic ID
                const maxGenericResult = await query(
                    `SELECT employee_id FROM users 
                     WHERE employee_id LIKE 'EMP%' 
                     ORDER BY employee_id DESC LIMIT 1`
                );
                let nextNumber = 1;
                if (maxGenericResult.rows.length > 0) {
                    const lastId = maxGenericResult.rows[0].employee_id;
                    const numPart = lastId.replace('EMP', '');
                    nextNumber = parseInt(numPart, 10) + 1;
                }
                employee_id = 'EMP' + nextNumber.toString().padStart(3, '0');
            }
        } else {
            // No department - use generic EMP prefix
            const maxGenericResult = await query(
                `SELECT employee_id FROM users 
                 WHERE employee_id LIKE 'EMP%' 
                 ORDER BY employee_id DESC LIMIT 1`
            );
            let nextNumber = 1;
            if (maxGenericResult.rows.length > 0) {
                const lastId = maxGenericResult.rows[0].employee_id;
                const numPart = lastId.replace('EMP', '');
                nextNumber = parseInt(numPart, 10) + 1;
            }
            employee_id = 'EMP' + nextNumber.toString().padStart(3, '0');
        }

        // Default date_of_joining to today if not provided
        const finalDateOfJoining = date_of_joining || new Date().toISOString().split('T')[0];

        // Hash password
        const password_hash = await bcrypt.hash(password, 12);

        const result = await transaction(async (client) => {
            // Create user
            const userResult = await client.query(
                `INSERT INTO users (employee_id, email, password_hash, first_name, last_name, phone,
                                   role, department_id, shift_id, manager_id, date_of_joining,
                                   date_of_birth, address, emergency_contact, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                 RETURNING id, employee_id, email, first_name, last_name, role, status`,
                [employee_id, email, password_hash, first_name, last_name, phone,
                 role || 'EMPLOYEE', finalDepartmentId, shift_id, manager_id || (req.user.role === 'MANAGER' ? req.user.id : null), finalDateOfJoining,
                 date_of_birth, address, emergency_contact, req.user.id]
            );

            const newUser = userResult.rows[0];

            // Create leave balance for current year
            await client.query(
                `INSERT INTO leave_balances (user_id, year) VALUES ($1, EXTRACT(YEAR FROM CURRENT_DATE))`,
                [newUser.id]
            );

            return newUser;
        });

        await createAuditLog(req.user.id, 'CREATE', 'users', result.id, null, 
            { employee_id, email, role: role || 'EMPLOYEE' }, 'New user created', req.ip);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

// Update user (Admin, HR)
router.put('/:id', authenticate, canManageUsers, userValidation.update, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const updates = req.body;

        // Get current user data for audit
        const currentResult = await query('SELECT * FROM users WHERE id = $1', [id]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const currentUser = currentResult.rows[0];

        // HR cannot change role to Admin
        if (req.user.role === 'HR' && updates.role === 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'HR cannot assign Admin role'
            });
        }

        // Build update query
        const allowedFields = ['first_name', 'last_name', 'phone', 'role', 'status',
                              'department_id', 'shift_id', 'manager_id', 'address',
                              'emergency_contact', 'date_of_birth'];
        
        const updateFields = [];
        const values = [];
        let paramCount = 0;

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                paramCount++;
                updateFields.push(`${field} = $${paramCount}`);
                values.push(updates[field]);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        paramCount++;
        values.push(id);

        const result = await query(
            `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW()
             WHERE id = $${paramCount}
             RETURNING id, employee_id, email, first_name, last_name, role, status`,
            values
        );

        await createAuditLog(req.user.id, 'UPDATE', 'users', id, 
            { first_name: currentUser.first_name, last_name: currentUser.last_name, role: currentUser.role, status: currentUser.status },
            updates, 'User updated', req.ip);

        res.json({
            success: true,
            message: 'User updated successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Deactivate user (Admin, HR, GM, Manager)
router.patch('/:id/deactivate', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Reason is required for deactivation'
            });
        }

        // Get target user to check permissions
        const targetUser = await query('SELECT * FROM users WHERE id = $1', [id]);
        if (targetUser.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const target = targetUser.rows[0];

        // Cannot deactivate GM
        if (target.role === 'GM') {
            return res.status(403).json({ success: false, error: 'Cannot deactivate the General Manager' });
        }

        // Manager can only deactivate employees in their department
        if (req.user.role === 'MANAGER') {
            if (target.role !== 'EMPLOYEE' || target.department_id !== req.user.department_id) {
                return res.status(403).json({ success: false, error: 'You can only deactivate employees in your department' });
            }
        }

        const result = await query(
            `UPDATE users SET status = 'INACTIVE', updated_at = NOW() WHERE id = $1
             RETURNING id, employee_id, email, status`,
            [id]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'users', id, 
            { status: 'ACTIVE' }, { status: 'INACTIVE' }, reason, req.ip);

        res.json({
            success: true,
            message: 'User deactivated successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Get team members (for Managers)
router.get('/team/members', authenticate, authorize('MANAGER', 'ADMIN', 'HR'), async (req, res, next) => {
    try {
        let queryText = `
            SELECT u.id, u.employee_id, u.email, u.first_name, u.last_name,
                   u.role, u.status, u.profile_picture_url,
                   d.name as department_name, s.name as shift_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN shifts s ON u.shift_id = s.id
            WHERE u.status = 'ACTIVE'
        `;
        const params = [];

        if (req.user.role === 'MANAGER') {
            queryText += ` AND u.manager_id = $1`;
            params.push(req.user.id);
        }

        queryText += ` ORDER BY u.first_name, u.last_name`;

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows.map(user => ({
                ...user,
                full_name: `${user.first_name} ${user.last_name}`
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Delete user (Admin, HR, GM, Manager - with restrictions)
router.delete('/:id', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Cannot delete yourself
        if (id === req.user.id) {
            return res.status(403).json({ success: false, error: 'Cannot delete your own account' });
        }

        // Get target user to check permissions
        const targetUser = await query('SELECT * FROM users WHERE id = $1', [id]);
        if (targetUser.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const target = targetUser.rows[0];

        // Nobody can delete GM (Director)
        if (target.role === 'GM') {
            return res.status(403).json({ success: false, error: 'Cannot delete the General Manager (Director)' });
        }

        // Manager can only delete employees in their department
        if (req.user.role === 'MANAGER') {
            if (target.role !== 'EMPLOYEE') {
                return res.status(403).json({ success: false, error: 'Managers can only delete employees' });
            }
            if (target.department_id !== req.user.department_id) {
                return res.status(403).json({ success: false, error: 'You can only delete employees in your department' });
            }
        }

        // HR cannot delete Admin or GM
        if (req.user.role === 'HR' && (target.role === 'ADMIN' || target.role === 'GM')) {
            return res.status(403).json({ success: false, error: 'HR cannot delete Admin or GM users' });
        }

        // Delete user
        await query('DELETE FROM users WHERE id = $1', [id]);

        await createAuditLog(req.user.id, 'DELETE', 'users', id, 
            { employee_id: target.employee_id, email: target.email, role: target.role }, 
            null, 'User deleted', req.ip);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Reset user password (Admin only)
router.post('/:id/reset-password', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { new_password } = req.body;

        if (!new_password || new_password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters'
            });
        }

        const password_hash = await bcrypt.hash(new_password, 12);

        const result = await query(
            `UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2
             RETURNING id, employee_id, email`,
            [password_hash, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'users', id, null, 
            { action: 'password_reset' }, 'Admin password reset', req.ip);

        res.json({
            success: true,
            message: 'Password reset successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Get organization hierarchy - GM (Director) and Department Managers
router.get('/organization/hierarchy', authenticate, async (req, res, next) => {
    try {
        // Get GM (Director)
        const gmResult = await query(
            `SELECT u.id, u.employee_id, u.email, u.first_name, u.last_name, u.phone,
                    u.role, u.profile_picture_url, d.name as department_name
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             WHERE u.role = 'GM' AND u.status = 'ACTIVE'
             LIMIT 1`
        );

        // Get all department managers with their department info
        const managersResult = await query(
            `SELECT u.id, u.employee_id, u.email, u.first_name, u.last_name, u.phone,
                    u.role, u.profile_picture_url, u.department_id,
                    d.name as department_name, d.code as department_code,
                    (SELECT COUNT(*) FROM users WHERE department_id = u.department_id AND status = 'ACTIVE') as employee_count
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             WHERE u.role = 'MANAGER' AND u.status = 'ACTIVE'
             ORDER BY d.name`
        );

        // Get department heads (from departments table)
        const deptHeadsResult = await query(
            `SELECT d.id as department_id, d.name as department_name, d.code as department_code,
                    u.id as head_id, u.first_name, u.last_name, u.email, u.role
             FROM departments d
             LEFT JOIN users u ON d.head_id = u.id
             WHERE d.is_active = true
             ORDER BY d.name`
        );

        res.json({
            success: true,
            data: {
                director: gmResult.rows[0] ? {
                    ...gmResult.rows[0],
                    full_name: `${gmResult.rows[0].first_name} ${gmResult.rows[0].last_name}`,
                    title: 'Director / General Manager'
                } : null,
                department_managers: managersResult.rows.map(mgr => ({
                    ...mgr,
                    full_name: `${mgr.first_name} ${mgr.last_name}`
                })),
                departments: deptHeadsResult.rows.map(dept => ({
                    ...dept,
                    head_name: dept.first_name ? `${dept.first_name} ${dept.last_name}` : null
                }))
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get employees by department (for department managers)
router.get('/department/:departmentId/employees', authenticate, isManagerOrAbove, async (req, res, next) => {
    try {
        const { departmentId } = req.params;

        // Manager can only see their own department
        if (req.user.role === 'MANAGER' && req.user.department_id !== departmentId) {
            return res.status(403).json({
                success: false,
                error: 'You can only view employees in your own department'
            });
        }

        const result = await query(
            `SELECT u.id, u.employee_id, u.email, u.first_name, u.last_name, u.phone,
                    u.role, u.status, u.date_of_joining, u.profile_picture_url,
                    s.name as shift_name,
                    m.first_name || ' ' || m.last_name as manager_name
             FROM users u
             LEFT JOIN shifts s ON u.shift_id = s.id
             LEFT JOIN users m ON u.manager_id = m.id
             WHERE u.department_id = $1 AND u.status = 'ACTIVE'
             ORDER BY u.first_name, u.last_name`,
            [departmentId]
        );

        res.json({
            success: true,
            data: result.rows.map(user => ({
                ...user,
                full_name: `${user.first_name} ${user.last_name}`
            }))
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
