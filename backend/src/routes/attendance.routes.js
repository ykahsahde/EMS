const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, authorize, isHROrAdmin, canAccessEmployee } = require('../middleware/auth');
const { attendanceValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Raymond office location configuration
// Raymond Borgaon Factory - Chhindwara, Madhya Pradesh (100 acres)
const RAYMOND_OFFICE_LOCATION = {
    latitude: 22.14,    // Raymond Borgaon coordinates
    longitude: 78.77,
    radius: 800 // meters - covers 100 acre campus
};

// Function to get location verification setting from database
const getLocationVerificationRequired = async () => {
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
};

// Calculate distance between two points using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
};

// Verify if location is within Raymond office
const verifyLocation = (location) => {
    if (!location || !location.latitude || !location.longitude) {
        return { valid: false, message: 'Location data is required', noLocation: true };
    }

    const distance = calculateDistance(
        location.latitude,
        location.longitude,
        RAYMOND_OFFICE_LOCATION.latitude,
        RAYMOND_OFFICE_LOCATION.longitude
    );

    if (distance > RAYMOND_OFFICE_LOCATION.radius) {
        return { 
            valid: false, 
            message: `You are ${Math.round(distance)} meters from Raymond office. Please come within ${RAYMOND_OFFICE_LOCATION.radius} meters to mark attendance.`,
            distance: Math.round(distance)
        };
    }

    return { valid: true, distance: Math.round(distance) };
};

// Check-in (Requires Face + Location verification based on admin setting)
router.post('/check-in', authenticate, async (req, res, next) => {
    try {
        const { is_face_verified, face_score, location, location_verified } = req.body;

        // Validate face verification - always required
        if (!is_face_verified) {
            return res.status(400).json({
                success: false,
                error: 'Face verification is required to mark attendance'
            });
        }

        // Get location verification setting from database
        const locationVerificationRequired = await getLocationVerificationRequired();

        // Check if location verification is required (admin setting)
        let locationData = null;
        let locationCheck = { valid: true, distance: null };
        
        if (locationVerificationRequired) {
            // Location verification is mandatory
            locationCheck = verifyLocation(location);
            if (!locationCheck.valid) {
                return res.status(400).json({
                    success: false,
                    error: locationCheck.message,
                    location_error: true
                });
            }
            locationData = {
                ...location,
                verified: true,
                distance_from_office: locationCheck.distance,
                verified_at: new Date().toISOString()
            };
        } else {
            // Location verification disabled - still capture location if provided
            if (location && location.latitude && location.longitude) {
                const distance = calculateDistance(
                    location.latitude,
                    location.longitude,
                    RAYMOND_OFFICE_LOCATION.latitude,
                    RAYMOND_OFFICE_LOCATION.longitude
                );
                locationData = {
                    ...location,
                    verified: false,
                    verification_disabled: true,
                    distance_from_office: Math.round(distance),
                    verified_at: new Date().toISOString()
                };
            }
        }

        const result = await query(
            `SELECT mark_attendance($1, 'CHECK_IN', $2, $3, $4) as result`,
            [req.user.id, is_face_verified, face_score || null, locationData ? JSON.stringify(locationData) : null]
        );

        const response = result.rows[0].result;

        if (!response.success) {
            return res.status(400).json({
                success: false,
                error: response.message
            });
        }

        await createAuditLog(req.user.id, 'CREATE', 'attendance_records', null, null,
            { action: 'CHECK_IN', is_face_verified, location_verified: locationVerificationRequired, distance: locationData?.distance_from_office }, 'Employee check-in with face verification', req.ip);

        res.json({
            success: true,
            message: response.message,
            data: {
                check_in_time: response.check_in_time,
                status: response.status,
                verification: {
                    face_verified: true,
                    location_verified: true,
                    distance_from_office: locationCheck.distance
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

// Check-out (Location verification based on admin setting)
router.post('/check-out', authenticate, async (req, res, next) => {
    try {
        const { location, location_verified } = req.body;

        // Get location verification setting from database
        const locationVerificationRequired = await getLocationVerificationRequired();

        // Check if location verification is required (admin setting)
        let locationData = null;
        
        if (locationVerificationRequired) {
            // Location verification is mandatory
            const locationCheck = verifyLocation(location);
            if (!locationCheck.valid) {
                return res.status(400).json({
                    success: false,
                    error: locationCheck.message,
                    location_error: true
                });
            }
            locationData = {
                ...location,
                verified: true,
                distance_from_office: locationCheck.distance,
                verified_at: new Date().toISOString()
            };
        } else {
            // Location verification disabled - still capture location if provided
            if (location && location.latitude && location.longitude) {
                const distance = calculateDistance(
                    location.latitude,
                    location.longitude,
                    RAYMOND_OFFICE_LOCATION.latitude,
                    RAYMOND_OFFICE_LOCATION.longitude
                );
                locationData = {
                    ...location,
                    verified: false,
                    verification_disabled: true,
                    distance_from_office: Math.round(distance),
                    verified_at: new Date().toISOString()
                };
            }
        }

        const result = await query(
            `SELECT mark_attendance($1, 'CHECK_OUT', false, null, $2) as result`,
            [req.user.id, locationData ? JSON.stringify(locationData) : null]
        );

        const response = result.rows[0].result;

        if (!response.success) {
            return res.status(400).json({
                success: false,
                error: response.message
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'attendance_records', null, null,
            { action: 'CHECK_OUT', total_hours: response.total_hours, location_verified: locationVerificationRequired }, 'Employee check-out', req.ip);

        res.json({
            success: true,
            message: response.message,
            data: {
                check_out_time: response.check_out_time,
                total_hours: response.total_hours,
                verification: {
                    location_verified: locationVerificationRequired,
                    distance_from_office: locationData?.distance_from_office
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

// ==========================================
// PUBLIC ATTENDANCE ENDPOINTS (No Auth Required)
// Employees can mark attendance using face recognition without logging in
// ==========================================

// Helper function to find user by face descriptor
const findUserByFaceDescriptor = async (faceDescriptor) => {
    // Get all users with registered face
    const result = await query(
        `SELECT id, employee_id, first_name, last_name, email, face_descriptor 
         FROM users 
         WHERE face_descriptor IS NOT NULL AND status = 'ACTIVE'`
    );

    if (result.rows.length === 0) {
        console.log('No users with registered faces found');
        return null;
    }

    // Calculate Euclidean distance to find the best match
    let bestMatch = null;
    let bestDistance = Infinity;
    const THRESHOLD = 0.6; // Face matching threshold (lower is stricter)

    console.log(`Comparing face against ${result.rows.length} registered users...`);

    for (const user of result.rows) {
        // Support multiple descriptor formats:
        // 1. { descriptor: [...] } - single descriptor
        // 2. { face_descriptors: [[...], [...]] } - multiple descriptors (from multi-image registration)
        // 3. Direct array [...] - raw descriptor
        
        let storedDescriptors = [];
        
        if (user.face_descriptor) {
            if (user.face_descriptor.descriptor) {
                // Format 1: { descriptor: [...] }
                storedDescriptors = [user.face_descriptor.descriptor];
            } else if (user.face_descriptor.face_descriptors && Array.isArray(user.face_descriptor.face_descriptors)) {
                // Format 2: { face_descriptors: [[...], [...]] }
                storedDescriptors = user.face_descriptor.face_descriptors;
            } else if (Array.isArray(user.face_descriptor)) {
                // Format 3: Direct array
                storedDescriptors = [user.face_descriptor];
            }
        }

        if (storedDescriptors.length === 0) {
            console.log(`User ${user.employee_id} has no valid face descriptors`);
            continue;
        }

        console.log(`User ${user.employee_id} has ${storedDescriptors.length} registered face(s)`);

        // Compare against all stored descriptors for this user
        for (let j = 0; j < storedDescriptors.length; j++) {
            const storedDescriptor = storedDescriptors[j];
            
            if (!Array.isArray(storedDescriptor) || storedDescriptor.length !== 128) {
                console.log(`  Descriptor ${j + 1} invalid (not 128-length array)`);
                continue;
            }
            
            // Calculate Euclidean distance
            let distance = 0;
            for (let i = 0; i < faceDescriptor.length; i++) {
                const diff = faceDescriptor[i] - storedDescriptor[i];
                distance += diff * diff;
            }
            distance = Math.sqrt(distance);

            console.log(`  Distance to descriptor ${j + 1}: ${distance.toFixed(4)} (threshold: ${THRESHOLD})`);

            if (distance < bestDistance && distance < THRESHOLD) {
                bestDistance = distance;
                bestMatch = {
                    id: user.id,
                    employee_id: user.employee_id,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    email: user.email,
                    score: 1 - distance // Convert distance to similarity score
                };
            }
        }
    }

    if (bestMatch) {
        console.log(`Best match: ${bestMatch.employee_id} with distance ${bestDistance.toFixed(4)}`);
    } else {
        console.log(`No match found. Best distance was ${bestDistance === Infinity ? 'N/A' : bestDistance.toFixed(4)}`);
    }

    return bestMatch;
};

// Public Check-in (Face + Location verification based on admin setting, no login required)
router.post('/public/check-in', async (req, res, next) => {
    try {
        const { face_descriptor, location } = req.body;

        // Validate face descriptor - always required
        if (!face_descriptor || !Array.isArray(face_descriptor)) {
            return res.status(400).json({
                success: false,
                error: 'Face scan is required for attendance'
            });
        }

        // Get location verification setting from database
        const locationVerificationRequired = await getLocationVerificationRequired();

        // Check location verification based on admin setting
        let locationData = null;
        let locationCheck = { valid: true, distance: null };

        if (locationVerificationRequired) {
            // Location verification is mandatory
            locationCheck = verifyLocation(location);
            if (!locationCheck.valid) {
                return res.status(400).json({
                    success: false,
                    error: locationCheck.message,
                    location_error: true
                });
            }
            locationData = {
                ...location,
                verified: true,
                distance_from_office: locationCheck.distance,
                verified_at: new Date().toISOString()
            };
        } else {
            // Location verification disabled
            if (location && location.latitude && location.longitude) {
                const distance = calculateDistance(
                    location.latitude,
                    location.longitude,
                    RAYMOND_OFFICE_LOCATION.latitude,
                    RAYMOND_OFFICE_LOCATION.longitude
                );
                locationData = {
                    ...location,
                    verified: false,
                    verification_disabled: true,
                    distance_from_office: Math.round(distance),
                    verified_at: new Date().toISOString()
                };
            }
        }

        // Find user by face
        const matchedUser = await findUserByFaceDescriptor(face_descriptor);

        if (!matchedUser) {
            return res.status(401).json({
                success: false,
                error: 'Face not recognized. Please register your face first or contact HR.'
            });
        }

        const result = await query(
            `SELECT mark_attendance($1, 'CHECK_IN', $2, $3, $4) as result`,
            [matchedUser.id, true, matchedUser.score, locationData ? JSON.stringify(locationData) : null]
        );

        const response = result.rows[0].result;

        if (!response.success) {
            return res.status(400).json({
                success: false,
                error: response.message
            });
        }

        await createAuditLog(matchedUser.id, 'CREATE', 'attendance_records', null, null,
            { action: 'PUBLIC_CHECK_IN', face_verified: true, face_score: matchedUser.score, location_verified: locationVerificationRequired }, 
            'Employee public check-in via face recognition', req.ip);

        res.json({
            success: true,
            message: `${matchedUser.first_name} ${matchedUser.last_name} checked in successfully!`,
            data: {
                employee_id: matchedUser.employee_id,
                employee_name: `${matchedUser.first_name} ${matchedUser.last_name}`,
                check_in_time: response.check_in_time,
                status: response.status,
                verification: {
                    face_verified: true,
                    face_score: matchedUser.score,
                    location_verified: locationVerificationRequired,
                    distance_from_office: locationData?.distance_from_office
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

// Public Check-out (Face + Location verification based on admin setting, no login required)
router.post('/public/check-out', async (req, res, next) => {
    try {
        const { face_descriptor, location } = req.body;

        // Validate face descriptor - always required
        if (!face_descriptor || !Array.isArray(face_descriptor)) {
            return res.status(400).json({
                success: false,
                error: 'Face scan is required for attendance'
            });
        }

        // Get location verification setting from database
        const locationVerificationRequired = await getLocationVerificationRequired();

        // Check location verification based on admin setting
        let locationData = null;

        if (locationVerificationRequired) {
            // Location verification is mandatory
            const locationCheck = verifyLocation(location);
            if (!locationCheck.valid) {
                return res.status(400).json({
                    success: false,
                    error: locationCheck.message,
                    location_error: true
                });
            }
            locationData = {
                ...location,
                verified: true,
                distance_from_office: locationCheck.distance,
                verified_at: new Date().toISOString()
            };
        } else {
            // Location verification disabled
            if (location && location.latitude && location.longitude) {
                const distance = calculateDistance(
                    location.latitude,
                    location.longitude,
                    RAYMOND_OFFICE_LOCATION.latitude,
                    RAYMOND_OFFICE_LOCATION.longitude
                );
                locationData = {
                    ...location,
                    verified: false,
                    verification_disabled: true,
                    distance_from_office: Math.round(distance),
                    verified_at: new Date().toISOString()
                };
            }
        }

        // Find user by face
        const matchedUser = await findUserByFaceDescriptor(face_descriptor);

        if (!matchedUser) {
            return res.status(401).json({
                success: false,
                error: 'Face not recognized. Please register your face first or contact HR.'
            });
        }

        const result = await query(
            `SELECT mark_attendance($1, 'CHECK_OUT', false, null, $2) as result`,
            [matchedUser.id, locationData ? JSON.stringify(locationData) : null]
        );

        const response = result.rows[0].result;

        if (!response.success) {
            return res.status(400).json({
                success: false,
                error: response.message
            });
        }

        await createAuditLog(matchedUser.id, 'UPDATE', 'attendance_records', null, null,
            { action: 'PUBLIC_CHECK_OUT', face_verified: true, location_verified: locationVerificationRequired, total_hours: response.total_hours }, 
            'Employee public check-out via face recognition', req.ip);

        res.json({
            success: true,
            message: `${matchedUser.first_name} ${matchedUser.last_name} checked out successfully!`,
            data: {
                employee_id: matchedUser.employee_id,
                employee_name: `${matchedUser.first_name} ${matchedUser.last_name}`,
                check_out_time: response.check_out_time,
                total_hours: response.total_hours,
                verification: {
                    face_verified: true,
                    location_verified: locationVerificationRequired,
                    distance_from_office: locationData?.distance_from_office
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get today's attendance status
router.get('/today', authenticate, async (req, res, next) => {
    try {
        const result = await query(
            `SELECT ar.*, s.name as shift_name, s.start_time as shift_start, s.end_time as shift_end
             FROM attendance_records ar
             LEFT JOIN shifts s ON ar.shift_id = s.id
             WHERE ar.user_id = $1 AND ar.date = CURRENT_DATE`,
            [req.user.id]
        );

        const shiftResult = await query(
            `SELECT s.* FROM shifts s
             JOIN users u ON u.shift_id = s.id
             WHERE u.id = $1`,
            [req.user.id]
        );

        res.json({
            success: true,
            data: {
                attendance: result.rows[0] || null,
                shift: shiftResult.rows[0] || null,
                can_check_in: !result.rows[0]?.check_in_time,
                can_check_out: result.rows[0]?.check_in_time && !result.rows[0]?.check_out_time
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get attendance records (filtered)
router.get('/', authenticate, attendanceValidation.getRecords, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { start_date, end_date, user_id, department_id, status, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        // Build base query based on role
        let queryText = `
            SELECT ar.*, 
                   u.employee_id, u.first_name, u.last_name, u.email,
                   d.name as department_name, s.name as shift_name,
                   editor.first_name || ' ' || editor.last_name as edited_by_name
            FROM attendance_records ar
            JOIN users u ON ar.user_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN shifts s ON ar.shift_id = s.id
            LEFT JOIN users editor ON ar.manual_entry_by = editor.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        // Role-based filtering
        if (req.user.role === 'EMPLOYEE') {
            paramCount++;
            queryText += ` AND ar.user_id = $${paramCount}`;
            params.push(req.user.id);
        } else if (req.user.role === 'MANAGER') {
            // Manager can only see attendance of their department employees
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(req.user.department_id);
        }

        // Additional filters
        if (start_date) {
            paramCount++;
            queryText += ` AND ar.date >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            queryText += ` AND ar.date <= $${paramCount}`;
            params.push(end_date);
        }

        if (user_id && ['ADMIN', 'HR'].includes(req.user.role)) {
            paramCount++;
            queryText += ` AND ar.user_id = $${paramCount}`;
            params.push(user_id);
        }

        if (department_id && ['ADMIN', 'HR'].includes(req.user.role)) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        if (status) {
            paramCount++;
            queryText += ` AND ar.status = $${paramCount}`;
            params.push(status);
        }

        // Get total count
        const countQuery = queryText.replace(/SELECT .* FROM/, 'SELECT COUNT(*) FROM');
        const countResult = await query(countQuery, params);
        const totalCount = parseInt(countResult.rows[0].count);

        // Add ordering and pagination
        queryText += ` ORDER BY ar.date DESC, u.first_name`;
        queryText += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const result = await query(queryText, params);

        res.json({
            success: true,
            data: result.rows.map(record => ({
                ...record,
                employee_name: `${record.first_name} ${record.last_name}`
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

// Get attendance by user ID
router.get('/user/:userId', authenticate, canAccessEmployee, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { month, year } = req.query;

        const currentDate = new Date();
        const targetMonth = month || currentDate.getMonth() + 1;
        const targetYear = year || currentDate.getFullYear();

        const result = await query(
            `SELECT ar.*, s.name as shift_name
             FROM attendance_records ar
             LEFT JOIN shifts s ON ar.shift_id = s.id
             WHERE ar.user_id = $1 
             AND EXTRACT(MONTH FROM ar.date) = $2
             AND EXTRACT(YEAR FROM ar.date) = $3
             ORDER BY ar.date DESC`,
            [userId, targetMonth, targetYear]
        );

        // Get summary
        const summaryResult = await query(
            `SELECT 
                COUNT(CASE WHEN status = 'PRESENT' THEN 1 END) as present_days,
                COUNT(CASE WHEN status = 'ABSENT' THEN 1 END) as absent_days,
                COUNT(CASE WHEN status = 'LATE' THEN 1 END) as late_days,
                COUNT(CASE WHEN status = 'HALF_DAY' THEN 1 END) as half_days,
                COUNT(CASE WHEN status = 'ON_LEAVE' THEN 1 END) as leave_days,
                COALESCE(SUM(total_hours), 0) as total_hours,
                COALESCE(SUM(overtime_hours), 0) as overtime_hours
             FROM attendance_records
             WHERE user_id = $1 
             AND EXTRACT(MONTH FROM date) = $2
             AND EXTRACT(YEAR FROM date) = $3`,
            [userId, targetMonth, targetYear]
        );

        res.json({
            success: true,
            data: {
                records: result.rows,
                summary: summaryResult.rows[0],
                month: targetMonth,
                year: targetYear
            }
        });
    } catch (error) {
        next(error);
    }
});

// Manual attendance entry (HR only)
router.post('/manual', authenticate, isHROrAdmin, attendanceValidation.manualEntry, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { user_id, date, check_in_time, check_out_time, status, reason } = req.body;

        // Check if record already exists
        const existingRecord = await query(
            'SELECT * FROM attendance_records WHERE user_id = $1 AND date = $2',
            [user_id, date]
        );

        // Check if attendance is locked
        if (existingRecord.rows[0]?.is_locked) {
            return res.status(400).json({
                success: false,
                error: 'Attendance for this date is locked and cannot be modified'
            });
        }

        const dateObj = new Date(date);
        const checkInDateTime = new Date(`${date}T${check_in_time}`);
        const checkOutDateTime = check_out_time ? new Date(`${date}T${check_out_time}`) : null;

        // Get user's shift
        const shiftResult = await query(
            'SELECT shift_id FROM users WHERE id = $1',
            [user_id]
        );
        const shiftId = shiftResult.rows[0]?.shift_id;

        let result;
        if (existingRecord.rows.length > 0) {
            // Update existing record
            result = await query(
                `UPDATE attendance_records 
                 SET check_in_time = $1, check_out_time = $2, status = $3, 
                     is_manual_entry = TRUE, manual_entry_by = $4
                 WHERE user_id = $5 AND date = $6
                 RETURNING *`,
                [checkInDateTime, checkOutDateTime, status, req.user.id, user_id, date]
            );

            await createAuditLog(req.user.id, 'ATTENDANCE_EDIT', 'attendance_records', 
                existingRecord.rows[0].id, existingRecord.rows[0],
                { check_in_time, check_out_time, status }, reason, req.ip);
        } else {
            // Create new record
            result = await query(
                `INSERT INTO attendance_records 
                 (user_id, date, check_in_time, check_out_time, status, shift_id,
                  is_manual_entry, manual_entry_by)
                 VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
                 RETURNING *`,
                [user_id, date, checkInDateTime, checkOutDateTime, status, shiftId, req.user.id]
            );

            await createAuditLog(req.user.id, 'CREATE', 'attendance_records', 
                result.rows[0].id, null,
                { user_id, date, check_in_time, check_out_time, status }, reason, req.ip);
        }

        res.json({
            success: true,
            message: 'Manual attendance entry recorded successfully',
            data: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

// Lock attendance for payroll (Admin only)
router.post('/lock', authenticate, authorize('ADMIN'), async (req, res, next) => {
    try {
        const { month, year } = req.body;

        if (!month || !year) {
            return res.status(400).json({
                success: false,
                error: 'Month and year are required'
            });
        }

        const result = await query(
            `SELECT lock_attendance_for_payroll($1, $2, $3) as result`,
            [req.user.id, month, year]
        );

        res.json({
            success: true,
            message: `Attendance locked for ${month}/${year}`,
            data: result.rows[0].result
        });
    } catch (error) {
        next(error);
    }
});

// Get attendance summary/dashboard
router.get('/summary/dashboard', authenticate, async (req, res, next) => {
    try {
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        let userFilter = '';
        let recentUserFilter = '';
        const params = [currentMonth, currentYear];
        const recentParams = [];

        if (req.user.role === 'EMPLOYEE') {
            userFilter = ' AND ar.user_id = $3';
            recentUserFilter = ' AND ar.user_id = $1';
            params.push(req.user.id);
            recentParams.push(req.user.id);
        } else if (req.user.role === 'MANAGER') {
            userFilter = ' AND (ar.user_id = $3 OR u.manager_id = $3)';
            recentUserFilter = ' AND (ar.user_id = $1 OR u.manager_id = $1)';
            params.push(req.user.id);
            recentParams.push(req.user.id);
        }

        // Get this month's summary
        const summaryResult = await query(
            `SELECT 
                COUNT(DISTINCT ar.user_id) as total_employees,
                COUNT(CASE WHEN ar.status = 'PRESENT' AND ar.date = CURRENT_DATE THEN 1 END) as present_today,
                COUNT(CASE WHEN ar.status = 'ABSENT' AND ar.date = CURRENT_DATE THEN 1 END) as absent_today,
                COUNT(CASE WHEN ar.status = 'LATE' AND ar.date = CURRENT_DATE THEN 1 END) as late_today,
                COUNT(CASE WHEN ar.status = 'ON_LEAVE' AND ar.date = CURRENT_DATE THEN 1 END) as on_leave_today,
                COUNT(CASE WHEN ar.status = 'PRESENT' THEN 1 END) as present_this_month,
                COUNT(CASE WHEN ar.status = 'ABSENT' THEN 1 END) as absent_this_month,
                COUNT(CASE WHEN ar.status = 'LATE' THEN 1 END) as late_this_month
             FROM attendance_records ar
             JOIN users u ON ar.user_id = u.id
             WHERE EXTRACT(MONTH FROM ar.date) = $1
             AND EXTRACT(YEAR FROM ar.date) = $2
             ${userFilter}`,
            params
        );

        // Get recent attendance
        let recentQuery = `SELECT ar.date, ar.status, ar.check_in_time, ar.check_out_time, ar.total_hours,
                    u.employee_id, u.first_name, u.last_name
             FROM attendance_records ar
             JOIN users u ON ar.user_id = u.id
             WHERE ar.date >= CURRENT_DATE - INTERVAL '7 days'
             ${recentUserFilter}
             ORDER BY ar.date DESC, ar.check_in_time DESC
             LIMIT 20`;

        const recentResult = await query(recentQuery, recentParams);

        res.json({
            success: true,
            data: {
                summary: summaryResult.rows[0],
                recent_records: recentResult.rows.map(r => ({
                    ...r,
                    employee_name: `${r.first_name} ${r.last_name}`
                })),
                month: currentMonth,
                year: currentYear
            }
        });
    } catch (error) {
        next(error);
    }
});

// ==========================================
// LOCATION VERIFICATION ADMIN ENDPOINTS
// ==========================================

// Get location verification status (public - for attendance UI)
router.get('/location-verification-status', async (req, res, next) => {
    try {
        const locationVerificationRequired = await getLocationVerificationRequired();
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

// Update location verification setting (Admin only) - Uses config.routes.js endpoint now
// This endpoint is deprecated - use PUT /api/config/location-verification instead
router.put('/location-verification', authenticate, async (req, res, next) => {
    try {
        // Only admin can change this setting
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'Only administrators can change this setting'
            });
        }

        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'enabled must be a boolean value'
            });
        }

        // Update in database
        const existsResult = await query(
            "SELECT id FROM attendance_config WHERE config_key = 'location_verification_required'"
        );
        
        if (existsResult.rows.length > 0) {
            await query(
                `UPDATE attendance_config 
                 SET config_value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE config_key = 'location_verification_required'`,
                [enabled.toString(), req.user.id]
            );
        } else {
            await query(
                `INSERT INTO attendance_config (config_key, config_value, description, data_type, updated_by)
                 VALUES ('location_verification_required', $1, 'Require location verification for attendance', 'boolean', $2)`,
                [enabled.toString(), req.user.id]
            );
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

module.exports = router;
