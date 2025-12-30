const { query } = require('../config/database');

// Request logging middleware
const requestLogger = async (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            userId: req.userId || null
        };
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`[${new Date().toISOString()}]`, JSON.stringify(logData));
        }
    });
    
    next();
};

// Audit logging function
const createAuditLog = async (userId, action, entityType, entityId, oldValues, newValues, reason = null, ipAddress = null) => {
    try {
        await query(
            `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, reason, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [userId, action, entityType, entityId, 
             oldValues ? JSON.stringify(oldValues) : null,
             newValues ? JSON.stringify(newValues) : null,
             reason, ipAddress]
        );
    } catch (error) {
        console.error('Failed to create audit log:', error);
    }
};

module.exports = {
    requestLogger,
    createAuditLog
};
