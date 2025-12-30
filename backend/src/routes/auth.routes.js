const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { createAuditLog } = require('../middleware/logger');

// Login
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { email, password } = req.body;

        // Find user
        const result = await query(
            `SELECT u.*, d.name as department_name, s.name as shift_name
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             LEFT JOIN shifts s ON u.shift_id = s.id
             WHERE u.email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const user = result.rows[0];

        // Check if user is active
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                error: 'Account is inactive or suspended. Please contact HR.'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, role: user.role, employeeId: user.employee_id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        // Update last login
        await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

        // Create audit log
        await createAuditLog(user.id, 'LOGIN', 'users', user.id, null, null, 'User login', req.ip);

        // Remove sensitive data
        delete user.password_hash;
        delete user.face_descriptor;

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    employee_id: user.employee_id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    full_name: `${user.first_name} ${user.last_name}`,
                    role: user.role,
                    department: user.department_name,
                    department_id: user.department_id,
                    shift: user.shift_name,
                    shift_id: user.shift_id,
                    profile_picture_url: user.profile_picture_url,
                    face_registered: !!user.face_registered_at
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

// Logout
router.post('/logout', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                await createAuditLog(decoded.userId, 'LOGOUT', 'users', decoded.userId, null, null, 'User logout', req.ip);
            } catch (e) {
                // Token might be invalid, but still allow logout
            }
        }

        res.json({
            success: true,
            message: 'Logout successful'
        });
    } catch (error) {
        next(error);
    }
});

// Change password
router.post('/change-password', [
    body('current_password').notEmpty(),
    body('new_password')
        .isLength({ min: 8 })
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
], async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const { current_password, new_password } = req.body;

        // Get user
        const result = await query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = result.rows[0];

        // Verify current password
        const isValid = await bcrypt.compare(current_password, user.password_hash);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(new_password, 12);

        // Update password
        await query(
            'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2',
            [newPasswordHash, decoded.userId]
        );

        await createAuditLog(decoded.userId, 'UPDATE', 'users', decoded.userId, null, 
            { action: 'password_change' }, 'Password changed', req.ip);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Get current user profile
router.get('/me', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const result = await query(
            `SELECT u.id, u.employee_id, u.email, u.first_name, u.last_name, u.phone, 
                    u.role, u.status, u.date_of_joining, u.date_of_birth, u.address,
                    u.profile_picture_url, u.face_registered_at, u.last_login,
                    d.id as department_id, d.name as department_name,
                    s.id as shift_id, s.name as shift_name, s.start_time, s.end_time,
                    m.first_name || ' ' || m.last_name as manager_name, m.email as manager_email
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             LEFT JOIN shifts s ON u.shift_id = s.id
             LEFT JOIN users m ON u.manager_id = m.id
             WHERE u.id = $1`,
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = result.rows[0];

        // Get leave balance
        const leaveResult = await query(
            `SELECT * FROM leave_balances WHERE user_id = $1 AND year = EXTRACT(YEAR FROM CURRENT_DATE)`,
            [decoded.userId]
        );

        res.json({
            success: true,
            data: {
                ...user,
                full_name: `${user.first_name} ${user.last_name}`,
                face_registered: !!user.face_registered_at,
                leave_balance: leaveResult.rows[0] || null
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
