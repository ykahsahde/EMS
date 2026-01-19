const prisma = require('../config/prisma');

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

// Helper to normalize IP address for PostgreSQL INET type
const normalizeIpAddress = (ip) => {
    if (!ip) return null;
    // Remove IPv6 prefix for IPv4 addresses
    if (ip.startsWith('::ffff:')) {
        return ip.substring(7);
    }
    // Handle localhost variations
    if (ip === '::1') {
        return '127.0.0.1';
    }
    return ip;
};

// Audit logging function using Prisma
const createAuditLog = async (userId, action, entityType, entityId, oldValues, newValues, reason = null, ipAddress = null) => {
    try {
        const normalizedIp = normalizeIpAddress(ipAddress);
        await prisma.auditLog.create({
            data: {
                userId: userId,
                action: action,
                entityType: entityType,
                entityId: entityId,
                oldValues: oldValues || undefined,
                newValues: newValues || undefined,
                reason: reason,
                ipAddress: normalizedIp
            }
        });
    } catch (error) {
        console.error('Failed to create audit log:', error);
    }
};

module.exports = {
    requestLogger,
    createAuditLog
};
