const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, isAdmin } = require('../middleware/auth');
const { createAuditLog } = require('../middleware/logger');

// Raymond office location configuration (can be moved to database config if needed)
// Raymond Borgaon Factory - Chhindwara, Madhya Pradesh (100 acres)
const OFFICE_LOCATION_CONFIG = {
    latitude: 22.14,    // Raymond Borgaon coordinates
    longitude: 78.77,
    radius: 800, // meters - covers 100 acre campus
    name: 'Raymond Borgaon Factory - Chhindwara'
};

// Helper function to get location verification setting from database
async function getLocationVerificationSetting() {
    try {
        const config = await prisma.attendanceConfig.findUnique({
            where: { configKey: 'location_verification_required' }
        });
        if (config) {
            return config.configValue === 'true';
        }
        return true; // Default to true if not found
    } catch (error) {
        console.error('Error fetching location verification setting:', error);
        return true; // Default to true on error
    }
}

// Helper function to update location verification setting in database
async function updateLocationVerificationSetting(enabled, userId) {
    try {
        await prisma.attendanceConfig.upsert({
            where: { configKey: 'location_verification_required' },
            update: {
                configValue: enabled.toString(),
                updatedById: userId
            },
            create: {
                configKey: 'location_verification_required',
                configValue: enabled.toString(),
                description: 'Require location verification for attendance',
                dataType: 'boolean',
                updatedById: userId
            }
        });
        return true;
    } catch (error) {
        console.error('Error updating location verification setting:', error);
        return false;
    }
}

// Get office location configuration (PUBLIC endpoint - no auth required for attendance marking)
router.get('/office-location', async (req, res, next) => {
    try {
        const locationVerificationRequired = await getLocationVerificationSetting();
        res.json({
            success: true,
            data: {
                ...OFFICE_LOCATION_CONFIG,
                location_verification_required: locationVerificationRequired
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get location verification setting (PUBLIC)
router.get('/location-verification-status', async (req, res, next) => {
    try {
        const locationVerificationRequired = await getLocationVerificationSetting();
        res.json({
            success: true,
            data: {
                location_verification_required: locationVerificationRequired
            }
        });
    } catch (error) {
        next(error);
    }
});

// Update location verification setting (Admin only)
router.put('/location-verification', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'enabled must be a boolean value'
            });
        }

        const success = await updateLocationVerificationSetting(enabled, req.user.id);

        if (!success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update setting'
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'system_config', null,
            { location_verification_required: !enabled },
            { location_verification_required: enabled },
            `Location verification ${enabled ? 'enabled' : 'disabled'} by admin`, req.ip);

        res.json({
            success: true,
            message: `Location verification ${enabled ? 'enabled' : 'disabled'} successfully`,
            data: {
                location_verification_required: enabled
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get all configuration
router.get('/', authenticate, async (req, res, next) => {
    try {
        const configs = await prisma.attendanceConfig.findMany({
            include: {
                updatedBy: {
                    select: {
                        firstName: true,
                        lastName: true
                    }
                }
            },
            orderBy: { configKey: 'asc' }
        });

        res.json({
            success: true,
            data: configs.map(c => ({
                id: c.id,
                config_key: c.configKey,
                config_value: c.configValue,
                description: c.description,
                data_type: c.dataType,
                updated_by: c.updatedById,
                created_at: c.createdAt,
                updated_at: c.updatedAt,
                updated_by_name: c.updatedBy ? `${c.updatedBy.firstName} ${c.updatedBy.lastName}` : null
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Get configuration by key
router.get('/:key', authenticate, async (req, res, next) => {
    try {
        const { key } = req.params;

        const config = await prisma.attendanceConfig.findUnique({
            where: { configKey: key }
        });

        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Configuration not found'
            });
        }

        res.json({
            success: true,
            data: {
                id: config.id,
                config_key: config.configKey,
                config_value: config.configValue,
                description: config.description,
                data_type: config.dataType,
                updated_by: config.updatedById,
                created_at: config.createdAt,
                updated_at: config.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Update configuration (Admin only)
router.put('/:key', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { key } = req.params;
        const { value, description } = req.body;

        if (value === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Value is required'
            });
        }

        // Get current value for audit
        const currentConfig = await prisma.attendanceConfig.findUnique({
            where: { configKey: key }
        });

        if (!currentConfig) {
            return res.status(404).json({
                success: false,
                error: 'Configuration not found'
            });
        }

        const config = await prisma.attendanceConfig.update({
            where: { configKey: key },
            data: {
                configValue: value.toString(),
                description: description !== undefined ? description : undefined,
                updatedById: req.user.id
            }
        });

        await createAuditLog(req.user.id, 'UPDATE', 'attendance_config', config.id,
            { config_key: key, config_value: currentConfig.configValue },
            { config_key: key, config_value: value },
            'Configuration updated', req.ip);

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            data: {
                id: config.id,
                config_key: config.configKey,
                config_value: config.configValue,
                description: config.description,
                data_type: config.dataType,
                updated_by: config.updatedById,
                created_at: config.createdAt,
                updated_at: config.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Create new configuration (Admin only)
router.post('/', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { config_key, config_value, description, data_type } = req.body;

        if (!config_key || config_value === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Config key and value are required'
            });
        }

        const config = await prisma.attendanceConfig.create({
            data: {
                configKey: config_key,
                configValue: config_value.toString(),
                description,
                dataType: data_type || 'string',
                updatedById: req.user.id
            }
        });

        await createAuditLog(req.user.id, 'CREATE', 'attendance_config', config.id,
            null, { config_key, config_value }, 'Configuration created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Configuration created successfully',
            data: {
                id: config.id,
                config_key: config.configKey,
                config_value: config.configValue,
                description: config.description,
                data_type: config.dataType,
                updated_by: config.updatedById,
                created_at: config.createdAt,
                updated_at: config.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Delete configuration (Admin only)
router.delete('/:key', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { key } = req.params;

        const config = await prisma.attendanceConfig.delete({
            where: { configKey: key }
        }).catch(() => null);

        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Configuration not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'attendance_config', config.id,
            { config_key: config.configKey, config_value: config.configValue }, null, 'Configuration deleted', req.ip);

        res.json({
            success: true,
            message: 'Configuration deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Bulk update configuration (Admin only) - for Settings page
router.put('/', authenticate, isAdmin, async (req, res, next) => {
    try {
        const configData = req.body;

        if (!configData || typeof configData !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Configuration data is required'
            });
        }

        const updates = [];
        const errors = [];

        for (const [key, value] of Object.entries(configData)) {
            try {
                await prisma.attendanceConfig.upsert({
                    where: { configKey: key },
                    update: {
                        configValue: value.toString(),
                        updatedById: req.user.id
                    },
                    create: {
                        configKey: key,
                        configValue: value.toString(),
                        updatedById: req.user.id
                    }
                });
                updates.push(key);
            } catch (err) {
                errors.push({ key, error: err.message });
            }
        }

        await createAuditLog(req.user.id, 'UPDATE', 'attendance_config', null,
            null, { updated_keys: updates }, 'Bulk configuration update', req.ip);

        res.json({
            success: true,
            message: `Updated ${updates.length} configuration(s)`,
            data: { updated: updates, errors }
        });
    } catch (error) {
        next(error);
    }
});

// Get audit logs (Admin only)
router.get('/audit/logs', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { entity_type, user_id, action, start_date, end_date, page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const whereClause = {};

        if (entity_type) whereClause.entityType = entity_type;
        if (user_id) whereClause.userId = user_id;
        if (action) whereClause.action = action;
        if (start_date || end_date) {
            whereClause.createdAt = {};
            if (start_date) whereClause.createdAt.gte = new Date(start_date);
            if (end_date) whereClause.createdAt.lte = new Date(end_date);
        }

        const [logs, totalCount] = await Promise.all([
            prisma.auditLog.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            employeeId: true,
                            firstName: true,
                            lastName: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.auditLog.count({ where: whereClause })
        ]);

        res.json({
            success: true,
            data: logs.map(log => ({
                id: log.id,
                user_id: log.userId,
                action: log.action,
                entity_type: log.entityType,
                entity_id: log.entityId,
                old_values: log.oldValues,
                new_values: log.newValues,
                reason: log.reason,
                ip_address: log.ipAddress,
                created_at: log.createdAt,
                employee_id: log.user?.employeeId,
                first_name: log.user?.firstName,
                last_name: log.user?.lastName,
                user_name: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                pages: Math.ceil(totalCount / parseInt(limit))
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
