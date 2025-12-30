const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
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
        const result = await query(
            "SELECT config_value FROM attendance_config WHERE config_key = 'location_verification_required'"
        );
        if (result.rows.length > 0) {
            return result.rows[0].config_value === 'true';
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
        // Check if setting exists
        const existsResult = await query(
            "SELECT id FROM attendance_config WHERE config_key = 'location_verification_required'"
        );
        
        if (existsResult.rows.length > 0) {
            // Update existing
            await query(
                `UPDATE attendance_config 
                 SET config_value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE config_key = 'location_verification_required'`,
                [enabled.toString(), userId]
            );
        } else {
            // Insert new
            await query(
                `INSERT INTO attendance_config (config_key, config_value, description, data_type, updated_by)
                 VALUES ('location_verification_required', $1, 'Require location verification for attendance', 'boolean', $2)`,
                [enabled.toString(), userId]
            );
        }
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
        const result = await query(
            `SELECT ac.*, u.first_name || ' ' || u.last_name as updated_by_name
             FROM attendance_config ac
             LEFT JOIN users u ON ac.updated_by = u.id
             ORDER BY ac.config_key`
        );

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        next(error);
    }
});

// Get configuration by key
router.get('/:key', authenticate, async (req, res, next) => {
    try {
        const { key } = req.params;

        const result = await query(
            'SELECT * FROM attendance_config WHERE config_key = $1',
            [key]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Configuration not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
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
        const currentResult = await query(
            'SELECT * FROM attendance_config WHERE config_key = $1',
            [key]
        );

        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Configuration not found'
            });
        }

        const result = await query(
            `UPDATE attendance_config 
             SET config_value = $1, 
                 description = COALESCE($2, description),
                 updated_by = $3
             WHERE config_key = $4
             RETURNING *`,
            [value.toString(), description, req.user.id, key]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'attendance_config', result.rows[0].id,
            { config_key: key, config_value: currentResult.rows[0].config_value },
            { config_key: key, config_value: value },
            'Configuration updated', req.ip);

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            data: result.rows[0]
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

        const result = await query(
            `INSERT INTO attendance_config (config_key, config_value, description, data_type, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [config_key, config_value.toString(), description, data_type || 'string', req.user.id]
        );

        await createAuditLog(req.user.id, 'CREATE', 'attendance_config', result.rows[0].id,
            null, { config_key, config_value }, 'Configuration created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Configuration created successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Delete configuration (Admin only)
router.delete('/:key', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { key } = req.params;

        const result = await query(
            'DELETE FROM attendance_config WHERE config_key = $1 RETURNING *',
            [key]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Configuration not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'attendance_config', result.rows[0].id,
            result.rows[0], null, 'Configuration deleted', req.ip);

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
                // Check if config exists
                const existing = await query(
                    'SELECT * FROM attendance_config WHERE config_key = $1',
                    [key]
                );

                if (existing.rows.length > 0) {
                    // Update existing
                    await query(
                        `UPDATE attendance_config 
                         SET config_value = $1, updated_by = $2
                         WHERE config_key = $3`,
                        [value.toString(), req.user.id, key]
                    );
                    updates.push(key);
                } else {
                    // Create new
                    await query(
                        `INSERT INTO attendance_config (config_key, config_value, updated_by)
                         VALUES ($1, $2, $3)`,
                        [key, value.toString(), req.user.id]
                    );
                    updates.push(key);
                }
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
        const offset = (page - 1) * limit;

        let queryText = `
            SELECT al.*, 
                   u.employee_id, u.first_name, u.last_name
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        if (entity_type) {
            paramCount++;
            queryText += ` AND al.entity_type = $${paramCount}`;
            params.push(entity_type);
        }

        if (user_id) {
            paramCount++;
            queryText += ` AND al.user_id = $${paramCount}`;
            params.push(user_id);
        }

        if (action) {
            paramCount++;
            queryText += ` AND al.action = $${paramCount}`;
            params.push(action);
        }

        if (start_date) {
            paramCount++;
            queryText += ` AND al.created_at >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            queryText += ` AND al.created_at <= $${paramCount}`;
            params.push(end_date);
        }

        // Get count
        const countResult = await query(
            queryText.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM'),
            params
        );
        const totalCount = parseInt(countResult.rows[0].count);

        queryText += ` ORDER BY al.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows.map(log => ({
                ...log,
                user_name: log.first_name ? `${log.first_name} ${log.last_name}` : 'System'
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

module.exports = router;
