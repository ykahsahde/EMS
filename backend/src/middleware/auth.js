const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// Authentication middleware
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required. Please provide a valid token.'
            });
        }
        
        const token = authHeader.split(' ')[1];
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const result = await query(
            `SELECT u.*, d.name as department_name, s.name as shift_name
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             LEFT JOIN shifts s ON u.shift_id = s.id
             WHERE u.id = $1 AND u.status = 'ACTIVE'`,
            [decoded.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'User not found or inactive'
            });
        }
        
        // Attach user to request
        req.user = result.rows[0];
        req.userId = decoded.userId;
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired. Please login again.'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }
        console.error('Authentication error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication failed'
        });
    }
};

// Role-based authorization middleware
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to perform this action',
                required_roles: allowedRoles,
                your_role: req.user.role
            });
        }
        
        next();
    };
};

// Check if user is Admin
const isAdmin = authorize('ADMIN');

// Check if user is HR or Admin
const isHROrAdmin = authorize('ADMIN', 'HR');

// Check if user is GM or Admin (can manage all departments)
const isGMOrAdmin = authorize('ADMIN', 'GM');

// Check if user is Manager or above
const isManagerOrAbove = authorize('ADMIN', 'HR', 'MANAGER', 'GM');

// Check if user can access specific employee data
const canAccessEmployee = async (req, res, next) => {
    try {
        const targetUserId = req.params.userId || req.params.id;
        const currentUser = req.user;
        
        // Admin, HR, and GM can access all employees
        if (['ADMIN', 'HR', 'GM'].includes(currentUser.role)) {
            return next();
        }
        
        // Users can access their own data
        if (currentUser.id === targetUserId) {
            return next();
        }
        
        // Managers can access their team members
        if (currentUser.role === 'MANAGER') {
            const result = await query(
                'SELECT id FROM users WHERE manager_id = $1 AND id = $2',
                [currentUser.id, targetUserId]
            );
            
            if (result.rows.length > 0) {
                return next();
            }
        }
        
        return res.status(403).json({
            success: false,
            error: 'You do not have permission to access this employee\'s data'
        });
    } catch (error) {
        console.error('Authorization error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authorization check failed'
        });
    }
};

module.exports = {
    authenticate,
    authorize,
    isAdmin,
    isHROrAdmin,
    isGMOrAdmin,
    isManagerOrAbove,
    canAccessEmployee
};
