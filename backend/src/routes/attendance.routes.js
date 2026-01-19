const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, authorize, isHROrAdmin, canAccessEmployee } = require('../middleware/auth');
const { attendanceValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Raymond office location configuration
// Raymond Borgaon Factory - Chhindwara, Madhya Pradesh (100 acres)
const RAYMOND_OFFICE_LOCATION = {
    latitude: 21.55,    // Raymond Borgaon coordinates
    longitude: 78.81,
    radius: 800 // meters - covers 100 acre campus
};

// Function to get location verification setting from database
const getLocationVerificationRequired = async () => {
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

        // Call stored procedure via $queryRaw
        const result = await prisma.$queryRaw`
            SELECT mark_attendance(${req.user.id}::uuid, 'CHECK_IN', ${is_face_verified}::boolean, ${face_score || null}::decimal, ${locationData ? JSON.stringify(locationData) : null}::jsonb) as result
        `;

        const response = result[0].result;

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

        // Call stored procedure via $queryRaw
        const result = await prisma.$queryRaw`
            SELECT mark_attendance(${req.user.id}::uuid, 'CHECK_OUT', false::boolean, null::decimal, ${locationData ? JSON.stringify(locationData) : null}::jsonb) as result
        `;

        const response = result[0].result;

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
    const users = await prisma.user.findMany({
        where: {
            faceDescriptor: { not: null },
            status: 'ACTIVE'
        },
        select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            email: true,
            faceDescriptor: true
        }
    });

    if (users.length === 0) {
        console.log('No users with registered faces found');
        return null;
    }

    // Calculate Euclidean distance to find the best match
    let bestMatch = null;
    let bestDistance = Infinity;
    const THRESHOLD = 0.6; // Face matching threshold (lower is stricter)

    console.log(`Comparing face against ${users.length} registered users...`);

    for (const user of users) {
        // Support multiple descriptor formats:
        // 1. { descriptor: [...] } - single descriptor
        // 2. { face_descriptors: [[...], [...]] } - multiple descriptors (from multi-image registration)
        // 3. Direct array [...] - raw descriptor

        let storedDescriptors = [];

        if (user.faceDescriptor) {
            if (user.faceDescriptor.descriptor) {
                // Format 1: { descriptor: [...] }
                storedDescriptors = [user.faceDescriptor.descriptor];
            } else if (user.faceDescriptor.face_descriptors && Array.isArray(user.faceDescriptor.face_descriptors)) {
                // Format 2: { face_descriptors: [[...], [...]] }
                storedDescriptors = user.faceDescriptor.face_descriptors;
            } else if (Array.isArray(user.faceDescriptor)) {
                // Format 3: Direct array
                storedDescriptors = [user.faceDescriptor];
            }
        }

        if (storedDescriptors.length === 0) {
            console.log(`User ${user.employeeId} has no valid face descriptors`);
            continue;
        }

        console.log(`User ${user.employeeId} has ${storedDescriptors.length} registered face(s)`);

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
                    employee_id: user.employeeId,
                    first_name: user.firstName,
                    last_name: user.lastName,
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

        // Call stored procedure via $queryRaw
        const result = await prisma.$queryRaw`
            SELECT mark_attendance(${matchedUser.id}::uuid, 'CHECK_IN', true::boolean, ${matchedUser.score}::decimal, ${locationData ? JSON.stringify(locationData) : null}::jsonb) as result
        `;

        const response = result[0].result;

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

        // Call stored procedure via $queryRaw
        const result = await prisma.$queryRaw`
            SELECT mark_attendance(${matchedUser.id}::uuid, 'CHECK_OUT', false::boolean, null::decimal, ${locationData ? JSON.stringify(locationData) : null}::jsonb) as result
        `;

        const response = result[0].result;

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await prisma.attendanceRecord.findFirst({
            where: {
                userId: req.user.id,
                date: today
            },
            include: {
                shift: { select: { name: true, startTime: true, endTime: true } }
            }
        });

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: {
                shift: true
            }
        });

        res.json({
            success: true,
            data: {
                attendance: attendance ? {
                    id: attendance.id,
                    user_id: attendance.userId,
                    date: attendance.date,
                    check_in_time: attendance.checkInTime,
                    check_out_time: attendance.checkOutTime,
                    status: attendance.status,
                    total_hours: attendance.totalHours,
                    overtime_hours: attendance.overtimeHours,
                    is_face_verified: attendance.isFaceVerified,
                    is_manual_entry: attendance.isManualEntry,
                    shift_name: attendance.shift?.name,
                    shift_start: attendance.shift?.startTime,
                    shift_end: attendance.shift?.endTime
                } : null,
                shift: user?.shift ? {
                    id: user.shift.id,
                    name: user.shift.name,
                    start_time: user.shift.startTime,
                    end_time: user.shift.endTime,
                    grace_period_minutes: user.shift.gracePeriodMinutes
                } : null,
                can_check_in: !attendance?.checkInTime,
                can_check_out: attendance?.checkInTime && !attendance?.checkOutTime
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
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = {};

        // Role-based filtering
        if (req.user.role === 'EMPLOYEE') {
            whereClause.userId = req.user.id;
        } else if (req.user.role === 'MANAGER') {
            // Manager can only see attendance of their department employees
            whereClause.user = { departmentId: req.user.department_id };
        }

        // Additional filters
        if (start_date) whereClause.date = { ...(whereClause.date || {}), gte: new Date(start_date) };
        if (end_date) whereClause.date = { ...(whereClause.date || {}), lte: new Date(end_date) };

        if (user_id && ['ADMIN', 'HR'].includes(req.user.role)) {
            whereClause.userId = user_id;
        }

        if (department_id && ['ADMIN', 'HR'].includes(req.user.role)) {
            whereClause.user = { ...(whereClause.user || {}), departmentId: department_id };
        }

        if (status) {
            whereClause.status = status;
        }

        const [records, totalCount] = await Promise.all([
            prisma.attendanceRecord.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            employeeId: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            department: { select: { name: true } }
                        }
                    },
                    shift: { select: { name: true } },
                    manualEntryBy: { select: { firstName: true, lastName: true } }
                },
                orderBy: [{ date: 'desc' }, { user: { firstName: 'asc' } }],
                skip,
                take: parseInt(limit)
            }),
            prisma.attendanceRecord.count({ where: whereClause })
        ]);

        res.json({
            success: true,
            data: records.map(record => ({
                id: record.id,
                user_id: record.userId,
                date: record.date,
                check_in_time: record.checkInTime,
                check_out_time: record.checkOutTime,
                status: record.status,
                total_hours: record.totalHours,
                overtime_hours: record.overtimeHours,
                is_face_verified: record.isFaceVerified,
                face_confidence_score: record.faceConfidenceScore,
                location_data: record.locationData,
                is_manual_entry: record.isManualEntry,
                is_locked: record.isLocked,
                notes: record.notes,
                employee_id: record.user.employeeId,
                first_name: record.user.firstName,
                last_name: record.user.lastName,
                email: record.user.email,
                department_name: record.user.department?.name,
                shift_name: record.shift?.name,
                edited_by_name: record.manualEntryBy ? `${record.manualEntryBy.firstName} ${record.manualEntryBy.lastName}` : null,
                employee_name: `${record.user.firstName} ${record.user.lastName}`
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

// Get attendance by user ID
router.get('/user/:userId', authenticate, canAccessEmployee, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { month, year } = req.query;

        const currentDate = new Date();
        const targetMonth = parseInt(month) || currentDate.getMonth() + 1;
        const targetYear = parseInt(year) || currentDate.getFullYear();

        // Calculate date range for the month
        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0);

        const records = await prisma.attendanceRecord.findMany({
            where: {
                userId: userId,
                date: { gte: startDate, lte: endDate }
            },
            include: {
                shift: { select: { name: true } }
            },
            orderBy: { date: 'desc' }
        });

        // Calculate summary
        const summary = {
            present_days: records.filter(r => r.status === 'PRESENT').length,
            absent_days: records.filter(r => r.status === 'ABSENT').length,
            late_days: records.filter(r => r.status === 'LATE').length,
            half_days: records.filter(r => r.status === 'HALF_DAY').length,
            leave_days: records.filter(r => r.status === 'ON_LEAVE').length,
            total_hours: records.reduce((sum, r) => sum + (parseFloat(r.totalHours) || 0), 0),
            overtime_hours: records.reduce((sum, r) => sum + (parseFloat(r.overtimeHours) || 0), 0)
        };

        res.json({
            success: true,
            data: {
                records: records.map(r => ({
                    id: r.id,
                    date: r.date,
                    check_in_time: r.checkInTime,
                    check_out_time: r.checkOutTime,
                    status: r.status,
                    total_hours: r.totalHours,
                    overtime_hours: r.overtimeHours,
                    is_face_verified: r.isFaceVerified,
                    is_manual_entry: r.isManualEntry,
                    shift_name: r.shift?.name
                })),
                summary,
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

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        // Check if record already exists
        const existingRecord = await prisma.attendanceRecord.findUnique({
            where: {
                userId_date: {
                    userId: user_id,
                    date: targetDate
                }
            }
        });

        // Check if attendance is locked
        if (existingRecord?.isLocked) {
            return res.status(400).json({
                success: false,
                error: 'Attendance for this date is locked and cannot be modified'
            });
        }

        const checkInDateTime = new Date(`${date}T${check_in_time}`);
        const checkOutDateTime = check_out_time ? new Date(`${date}T${check_out_time}`) : null;

        // Get user's shift
        const user = await prisma.user.findUnique({
            where: { id: user_id },
            select: { shiftId: true }
        });

        let result;
        if (existingRecord) {
            // Update existing record
            result = await prisma.attendanceRecord.update({
                where: { id: existingRecord.id },
                data: {
                    checkInTime: checkInDateTime,
                    checkOutTime: checkOutDateTime,
                    status: status,
                    isManualEntry: true,
                    manualEntryById: req.user.id
                }
            });

            await createAuditLog(req.user.id, 'ATTENDANCE_EDIT', 'attendance_records',
                existingRecord.id, existingRecord,
                { check_in_time, check_out_time, status }, reason, req.ip);
        } else {
            // Create new record
            result = await prisma.attendanceRecord.create({
                data: {
                    userId: user_id,
                    date: targetDate,
                    checkInTime: checkInDateTime,
                    checkOutTime: checkOutDateTime,
                    status: status,
                    shiftId: user?.shiftId,
                    isManualEntry: true,
                    manualEntryById: req.user.id
                }
            });

            await createAuditLog(req.user.id, 'CREATE', 'attendance_records',
                result.id, null,
                { user_id, date, check_in_time, check_out_time, status }, reason, req.ip);
        }

        res.json({
            success: true,
            message: 'Manual attendance entry recorded successfully',
            data: {
                id: result.id,
                user_id: result.userId,
                date: result.date,
                check_in_time: result.checkInTime,
                check_out_time: result.checkOutTime,
                status: result.status,
                is_manual_entry: result.isManualEntry
            }
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

        // Call stored procedure via $queryRaw
        const result = await prisma.$queryRaw`
            SELECT lock_attendance_for_payroll(${req.user.id}::uuid, ${month}::integer, ${year}::integer) as result
        `;

        res.json({
            success: true,
            message: `Attendance locked for ${month}/${year}`,
            data: result[0].result
        });
    } catch (error) {
        next(error);
    }
});

// Get attendance summary/dashboard
router.get('/summary/dashboard', authenticate, async (req, res, next) => {
    try {
        const currentDate = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();
        const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
        const endOfMonth = new Date(currentYear, currentMonth, 0);

        let whereClause = {
            date: { gte: startOfMonth, lte: endOfMonth }
        };

        let recentWhereClause = {
            date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        };

        if (req.user.role === 'EMPLOYEE') {
            whereClause.userId = req.user.id;
            recentWhereClause.userId = req.user.id;
        } else if (req.user.role === 'MANAGER') {
            whereClause.OR = [
                { userId: req.user.id },
                { user: { managerId: req.user.id } }
            ];
            recentWhereClause.OR = [
                { userId: req.user.id },
                { user: { managerId: req.user.id } }
            ];
        }

        // Get this month's records
        const monthRecords = await prisma.attendanceRecord.findMany({
            where: whereClause,
            select: { userId: true, status: true, date: true }
        });

        // Calculate summary
        const summary = {
            total_employees: new Set(monthRecords.map(r => r.userId)).size,
            present_today: monthRecords.filter(r => r.status === 'PRESENT' && r.date.toDateString() === today.toDateString()).length,
            absent_today: monthRecords.filter(r => r.status === 'ABSENT' && r.date.toDateString() === today.toDateString()).length,
            late_today: monthRecords.filter(r => r.status === 'LATE' && r.date.toDateString() === today.toDateString()).length,
            on_leave_today: monthRecords.filter(r => r.status === 'ON_LEAVE' && r.date.toDateString() === today.toDateString()).length,
            present_this_month: monthRecords.filter(r => r.status === 'PRESENT').length,
            absent_this_month: monthRecords.filter(r => r.status === 'ABSENT').length,
            late_this_month: monthRecords.filter(r => r.status === 'LATE').length
        };

        // Get recent attendance
        const recentRecords = await prisma.attendanceRecord.findMany({
            where: recentWhereClause,
            include: {
                user: {
                    select: { employeeId: true, firstName: true, lastName: true }
                }
            },
            orderBy: [{ date: 'desc' }, { checkInTime: 'desc' }],
            take: 20
        });

        res.json({
            success: true,
            data: {
                summary,
                recent_records: recentRecords.map(r => ({
                    date: r.date,
                    status: r.status,
                    check_in_time: r.checkInTime,
                    check_out_time: r.checkOutTime,
                    total_hours: r.totalHours,
                    employee_id: r.user.employeeId,
                    first_name: r.user.firstName,
                    last_name: r.user.lastName,
                    employee_name: `${r.user.firstName} ${r.user.lastName}`
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

        // Update in database using Prisma
        await prisma.attendanceConfig.upsert({
            where: { configKey: 'location_verification_required' },
            update: {
                configValue: enabled.toString(),
                updatedById: req.user.id
            },
            create: {
                configKey: 'location_verification_required',
                configValue: enabled.toString(),
                description: 'Require location verification for attendance',
                dataType: 'boolean',
                updatedById: req.user.id
            }
        });

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
