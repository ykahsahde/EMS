const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, isAdmin } = require('../middleware/auth');
const { shiftValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Get all shifts
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { is_active } = req.query;

        const whereClause = is_active !== undefined
            ? { isActive: is_active === 'true' }
            : {};

        const shifts = await prisma.shift.findMany({
            where: whereClause,
            include: {
                users: {
                    where: { status: 'ACTIVE' },
                    select: { id: true }
                }
            },
            orderBy: { startTime: 'asc' }
        });

        res.json({
            success: true,
            data: shifts.map(s => ({
                id: s.id,
                name: s.name,
                code: s.code,
                shift_type: s.shiftType,
                start_time: s.startTime,
                end_time: s.endTime,
                grace_period_minutes: s.gracePeriodMinutes,
                half_day_hours: s.halfDayHours,
                full_day_hours: s.fullDayHours,
                is_active: s.isActive,
                created_at: s.createdAt,
                updated_at: s.updatedAt,
                employee_count: s.users.length
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Get shift by ID
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        const shift = await prisma.shift.findUnique({
            where: { id }
        });

        if (!shift) {
            return res.status(404).json({
                success: false,
                error: 'Shift not found'
            });
        }

        // Get employees in this shift
        const employees = await prisma.user.findMany({
            where: { shiftId: id, status: 'ACTIVE' },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                email: true,
                departmentId: true
            },
            orderBy: { firstName: 'asc' }
        });

        res.json({
            success: true,
            data: {
                id: shift.id,
                name: shift.name,
                code: shift.code,
                shift_type: shift.shiftType,
                start_time: shift.startTime,
                end_time: shift.endTime,
                grace_period_minutes: shift.gracePeriodMinutes,
                half_day_hours: shift.halfDayHours,
                full_day_hours: shift.fullDayHours,
                is_active: shift.isActive,
                created_at: shift.createdAt,
                updated_at: shift.updatedAt,
                employees: employees.map(emp => ({
                    id: emp.id,
                    employee_id: emp.employeeId,
                    first_name: emp.firstName,
                    last_name: emp.lastName,
                    email: emp.email,
                    department_id: emp.departmentId,
                    full_name: `${emp.firstName} ${emp.lastName}`
                }))
            }
        });
    } catch (error) {
        next(error);
    }
});

// Create shift (Admin only)
router.post('/', authenticate, isAdmin, shiftValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { name, code, shift_type, start_time, end_time, grace_period_minutes, half_day_hours, full_day_hours } = req.body;

        const shift = await prisma.shift.create({
            data: {
                name,
                code,
                shiftType: shift_type,
                startTime: new Date(`1970-01-01T${start_time}`),
                endTime: new Date(`1970-01-01T${end_time}`),
                gracePeriodMinutes: grace_period_minutes || 15,
                halfDayHours: half_day_hours || 4,
                fullDayHours: full_day_hours || 8
            }
        });

        await createAuditLog(req.user.id, 'CREATE', 'shifts', shift.id,
            null, { name, code, shift_type }, 'Shift created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Shift created successfully',
            data: {
                id: shift.id,
                name: shift.name,
                code: shift.code,
                shift_type: shift.shiftType,
                start_time: shift.startTime,
                end_time: shift.endTime,
                grace_period_minutes: shift.gracePeriodMinutes,
                half_day_hours: shift.halfDayHours,
                full_day_hours: shift.fullDayHours,
                is_active: shift.isActive,
                created_at: shift.createdAt,
                updated_at: shift.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Update shift (Admin only)
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, shift_type, start_time, end_time, grace_period_minutes, half_day_hours, full_day_hours, is_active } = req.body;

        // Get current data
        const currentShift = await prisma.shift.findUnique({ where: { id } });
        if (!currentShift) {
            return res.status(404).json({
                success: false,
                error: 'Shift not found'
            });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (code !== undefined) updateData.code = code;
        if (shift_type !== undefined) updateData.shiftType = shift_type;
        if (start_time !== undefined) updateData.startTime = new Date(`1970-01-01T${start_time}`);
        if (end_time !== undefined) updateData.endTime = new Date(`1970-01-01T${end_time}`);
        if (grace_period_minutes !== undefined) updateData.gracePeriodMinutes = grace_period_minutes;
        if (half_day_hours !== undefined) updateData.halfDayHours = half_day_hours;
        if (full_day_hours !== undefined) updateData.fullDayHours = full_day_hours;
        if (is_active !== undefined) updateData.isActive = is_active;

        const shift = await prisma.shift.update({
            where: { id },
            data: updateData
        });

        await createAuditLog(req.user.id, 'UPDATE', 'shifts', id,
            { name: currentShift.name, code: currentShift.code }, req.body, 'Shift updated', req.ip);

        res.json({
            success: true,
            message: 'Shift updated successfully',
            data: {
                id: shift.id,
                name: shift.name,
                code: shift.code,
                shift_type: shift.shiftType,
                start_time: shift.startTime,
                end_time: shift.endTime,
                grace_period_minutes: shift.gracePeriodMinutes,
                half_day_hours: shift.halfDayHours,
                full_day_hours: shift.fullDayHours,
                is_active: shift.isActive,
                created_at: shift.createdAt,
                updated_at: shift.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Delete shift (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if shift has employees
        const employeeCount = await prisma.user.count({
            where: { shiftId: id }
        });

        if (employeeCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete shift with assigned employees'
            });
        }

        const shift = await prisma.shift.delete({
            where: { id }
        }).catch(() => null);

        if (!shift) {
            return res.status(404).json({
                success: false,
                error: 'Shift not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'shifts', id,
            { name: shift.name, code: shift.code }, null, 'Shift deleted', req.ip);

        res.json({
            success: true,
            message: 'Shift deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Assign shift to employee
router.post('/assign', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { user_id, shift_id } = req.body;

        if (!user_id || !shift_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Shift ID are required'
            });
        }

        const user = await prisma.user.update({
            where: { id: user_id },
            data: { shiftId: shift_id },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                shiftId: true
            }
        }).catch(() => null);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'users', user_id,
            null, { shift_id }, 'Shift assigned', req.ip);

        res.json({
            success: true,
            message: 'Shift assigned successfully',
            data: {
                id: user.id,
                employee_id: user.employeeId,
                first_name: user.firstName,
                last_name: user.lastName,
                shift_id: user.shiftId
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
