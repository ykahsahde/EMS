const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, authorize, canAccessEmployee } = require('../middleware/auth');
const { leaveValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Apply for leave
router.post('/apply', authenticate, leaveValidation.apply, async (req, res, next) => {
    try {
        console.log('Leave apply request body:', req.body);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log('Validation errors:', errors.array());
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { leave_type, start_date, end_date, reason, attachment_url } = req.body;

        // Calculate total days
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        // Check leave balance
        const year = startDate.getFullYear();
        const balance = await prisma.leaveBalance.findUnique({
            where: {
                userId_year: {
                    userId: req.user.id,
                    year: year
                }
            }
        });

        if (!balance) {
            return res.status(400).json({
                success: false,
                error: 'Leave balance not found for this year'
            });
        }

        const leaveTypeColumn = leave_type.toLowerCase();

        if (leave_type !== 'UNPAID') {
            const totalKey = `${leaveTypeColumn}Total`;
            const usedKey = `${leaveTypeColumn}Used`;
            const pendingKey = `${leaveTypeColumn}Pending`;
            const available = (balance[totalKey] || 0) - (balance[usedKey] || 0) - (balance[pendingKey] || 0);
            if (totalDays > available) {
                return res.status(400).json({
                    success: false,
                    error: `Insufficient ${leave_type} leave balance. Available: ${available} days`
                });
            }
        }

        // Check for overlapping leave requests
        const overlapping = await prisma.leaveRequest.findFirst({
            where: {
                userId: req.user.id,
                status: { in: ['PENDING', 'APPROVED'] },
                OR: [
                    { startDate: { lte: startDate }, endDate: { gte: startDate } },
                    { startDate: { lte: endDate }, endDate: { gte: endDate } },
                    { startDate: { gte: startDate }, endDate: { lte: endDate } }
                ]
            }
        });

        if (overlapping) {
            return res.status(400).json({
                success: false,
                error: 'You already have a leave request for overlapping dates'
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Create leave request
            const leaveRequest = await tx.leaveRequest.create({
                data: {
                    userId: req.user.id,
                    leaveType: leave_type,
                    startDate: startDate,
                    endDate: endDate,
                    totalDays: totalDays,
                    reason: reason,
                    attachmentUrl: attachment_url
                }
            });

            // Update pending leave balance
            const updateData = {};
            if (leave_type !== 'UNPAID') {
                const pendingKey = `${leaveTypeColumn}Pending`;
                updateData[pendingKey] = { increment: totalDays };
            } else {
                updateData.unpaidPending = { increment: totalDays };
            }

            await tx.leaveBalance.update({
                where: {
                    userId_year: {
                        userId: req.user.id,
                        year: year
                    }
                },
                data: updateData
            });

            return leaveRequest;
        });

        await createAuditLog(req.user.id, 'CREATE', 'leave_requests', result.id, null,
            { leave_type, start_date, end_date, total_days: totalDays }, 'Leave application submitted', req.ip);

        res.status(201).json({
            success: true,
            message: 'Leave request submitted successfully',
            data: {
                id: result.id,
                user_id: result.userId,
                leave_type: result.leaveType,
                start_date: result.startDate,
                end_date: result.endDate,
                total_days: result.totalDays,
                reason: result.reason,
                status: result.status,
                created_at: result.createdAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get my leave requests
router.get('/my-leaves', authenticate, async (req, res, next) => {
    try {
        const { status, year } = req.query;
        const currentYear = new Date().getFullYear();
        const nextYear = currentYear + 1;

        let whereClause = { userId: req.user.id };

        // If specific year is provided, filter by that year
        if (year) {
            const yearStart = new Date(`${year}-01-01`);
            const yearEnd = new Date(`${year}-12-31`);
            whereClause.startDate = { gte: yearStart, lte: yearEnd };
        } else {
            // Show current year and next year leaves
            const currentYearStart = new Date(`${currentYear}-01-01`);
            const nextYearEnd = new Date(`${nextYear}-12-31`);
            whereClause.startDate = { gte: currentYearStart, lte: nextYearEnd };
        }

        if (status) {
            whereClause.status = status;
        }

        const requests = await prisma.leaveRequest.findMany({
            where: whereClause,
            include: {
                approvedBy: {
                    select: { firstName: true, lastName: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Get leave balance for the specified year or current year
        const balanceYear = parseInt(year) || currentYear;
        const balance = await prisma.leaveBalance.findUnique({
            where: {
                userId_year: {
                    userId: req.user.id,
                    year: balanceYear
                }
            }
        });

        res.json({
            success: true,
            data: {
                requests: requests.map(r => ({
                    id: r.id,
                    user_id: r.userId,
                    leave_type: r.leaveType,
                    start_date: r.startDate,
                    end_date: r.endDate,
                    total_days: r.totalDays,
                    reason: r.reason,
                    status: r.status,
                    approved_by: r.approvedById,
                    approved_at: r.approvedAt,
                    rejection_reason: r.rejectionReason,
                    attachment_url: r.attachmentUrl,
                    created_at: r.createdAt,
                    updated_at: r.updatedAt,
                    approved_by_name: r.approvedBy ? `${r.approvedBy.firstName} ${r.approvedBy.lastName}` : null
                })),
                balance: balance ? {
                    id: balance.id,
                    user_id: balance.userId,
                    year: balance.year,
                    casual_total: balance.casualTotal,
                    casual_used: balance.casualUsed,
                    casual_pending: balance.casualPending,
                    sick_total: balance.sickTotal,
                    sick_used: balance.sickUsed,
                    sick_pending: balance.sickPending,
                    paid_total: balance.paidTotal,
                    paid_used: balance.paidUsed,
                    paid_pending: balance.paidPending,
                    unpaid_used: balance.unpaidUsed,
                    unpaid_pending: balance.unpaidPending
                } : null
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get pending leave requests (for Manager/GM/Admin)
router.get('/pending', authenticate, authorize('MANAGER', 'ADMIN', 'GM'), async (req, res, next) => {
    try {
        let whereClause = {
            status: 'PENDING',
            userId: { not: req.user.id }
        };

        // Manager can only see pending requests from their department EMPLOYEES only
        if (req.user.role === 'MANAGER') {
            whereClause.user = {
                departmentId: req.user.department_id,
                role: 'EMPLOYEE'
            };
        }
        // Admin can see all leaves EXCEPT Admin and Manager leaves
        else if (req.user.role === 'ADMIN') {
            whereClause.user = {
                role: { notIn: ['ADMIN', 'MANAGER', 'GM'] }
            };
        }
        // GM can see all pending leaves

        const requests = await prisma.leaveRequest.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        employeeId: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        role: true,
                        department: { select: { name: true } }
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        res.json({
            success: true,
            data: requests.map(r => ({
                id: r.id,
                user_id: r.userId,
                leave_type: r.leaveType,
                start_date: r.startDate,
                end_date: r.endDate,
                total_days: r.totalDays,
                reason: r.reason,
                status: r.status,
                attachment_url: r.attachmentUrl,
                created_at: r.createdAt,
                employee_id: r.user.employeeId,
                first_name: r.user.firstName,
                last_name: r.user.lastName,
                email: r.user.email,
                applicant_role: r.user.role,
                department_name: r.user.department?.name,
                employee_name: `${r.user.firstName} ${r.user.lastName}`
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Approve/Reject leave request (Manager, GM, Admin only)
router.patch('/:id/approve', authenticate, authorize('MANAGER', 'GM', 'ADMIN'), leaveValidation.approve, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const { status, rejection_reason } = req.body;

        // Get leave request with applicant's role
        const leaveRequest = await prisma.leaveRequest.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        managerId: true,
                        departmentId: true,
                        role: true
                    }
                }
            }
        });

        if (!leaveRequest) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        // RULE 1: Prevent self-approval
        if (leaveRequest.userId === req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'You cannot approve your own leave request'
            });
        }

        // RULE 2: Admin leaves can ONLY be approved by GM
        if (leaveRequest.user.role === 'ADMIN' && req.user.role !== 'GM') {
            return res.status(403).json({
                success: false,
                error: 'Admin leave requests can only be approved by GM'
            });
        }

        // RULE 2.5: Manager leaves can ONLY be approved by GM
        if (leaveRequest.user.role === 'MANAGER' && req.user.role !== 'GM') {
            return res.status(403).json({
                success: false,
                error: 'Manager leave requests can only be approved by GM'
            });
        }

        // RULE 3: Manager can only approve their department's EMPLOYEES
        if (req.user.role === 'MANAGER') {
            if (leaveRequest.user.departmentId !== req.user.department_id) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only approve/reject leave requests of your department members'
                });
            }
            if (['ADMIN', 'GM', 'MANAGER'].includes(leaveRequest.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Managers can only approve Employee leave requests'
                });
            }
        }

        // RULE 4: Admin can approve any leave EXCEPT Admin and Manager leaves
        if (req.user.role === 'ADMIN' && ['ADMIN', 'MANAGER'].includes(leaveRequest.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Admin and Manager leave requests can only be approved by GM'
            });
        }

        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'This leave request has already been processed'
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Update leave request
            const updatedRequest = await tx.leaveRequest.update({
                where: { id },
                data: {
                    status: status,
                    approvedById: req.user.id,
                    approvedAt: new Date(),
                    rejectionReason: rejection_reason || null
                }
            });

            const leaveType = leaveRequest.leaveType.toLowerCase();
            const totalDays = leaveRequest.totalDays;
            const year = new Date(leaveRequest.startDate).getFullYear();

            if (status === 'APPROVED') {
                // Update leave balance - move from pending to used
                const updateData = {};
                if (leaveRequest.leaveType !== 'UNPAID') {
                    const pendingKey = `${leaveType}Pending`;
                    const usedKey = `${leaveType}Used`;
                    updateData[pendingKey] = { decrement: totalDays };
                    updateData[usedKey] = { increment: totalDays };
                } else {
                    updateData.unpaidPending = { decrement: totalDays };
                    updateData.unpaidUsed = { increment: totalDays };
                }

                await tx.leaveBalance.update({
                    where: {
                        userId_year: {
                            userId: leaveRequest.userId,
                            year: year
                        }
                    },
                    data: updateData
                });

                // Mark attendance as ON_LEAVE for approved dates
                const startDate = new Date(leaveRequest.startDate);
                const endDate = new Date(leaveRequest.endDate);

                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    await tx.attendanceRecord.upsert({
                        where: {
                            userId_date: {
                                userId: leaveRequest.userId,
                                date: new Date(dateStr)
                            }
                        },
                        update: {
                            status: 'ON_LEAVE',
                            notes: `Leave: ${leaveRequest.leaveType}`
                        },
                        create: {
                            userId: leaveRequest.userId,
                            date: new Date(dateStr),
                            status: 'ON_LEAVE',
                            notes: `Leave: ${leaveRequest.leaveType}`
                        }
                    });
                }
            } else {
                // Rejected - remove from pending
                const updateData = {};
                if (leaveRequest.leaveType !== 'UNPAID') {
                    const pendingKey = `${leaveType}Pending`;
                    updateData[pendingKey] = { decrement: totalDays };
                } else {
                    updateData.unpaidPending = { decrement: totalDays };
                }

                await tx.leaveBalance.update({
                    where: {
                        userId_year: {
                            userId: leaveRequest.userId,
                            year: year
                        }
                    },
                    data: updateData
                });
            }

            return updatedRequest;
        });

        await createAuditLog(req.user.id, 'UPDATE', 'leave_requests', id,
            { status: 'PENDING' }, { status, rejection_reason },
            `Leave ${status.toLowerCase()}`, req.ip);

        res.json({
            success: true,
            message: `Leave request ${status.toLowerCase()}`,
            data: {
                id: result.id,
                status: result.status,
                approved_by: result.approvedById,
                approved_at: result.approvedAt,
                rejection_reason: result.rejectionReason
            }
        });
    } catch (error) {
        next(error);
    }
});

// Cancel leave request (by employee)
router.patch('/:id/cancel', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        const leaveRequest = await prisma.leaveRequest.findFirst({
            where: { id, userId: req.user.id }
        });

        if (!leaveRequest) {
            return res.status(404).json({
                success: false,
                error: 'Leave request not found'
            });
        }

        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Only pending leave requests can be cancelled'
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Update leave request
            const updated = await tx.leaveRequest.update({
                where: { id },
                data: { status: 'CANCELLED' }
            });

            // Restore leave balance
            const leaveType = leaveRequest.leaveType.toLowerCase();
            const year = new Date(leaveRequest.startDate).getFullYear();
            const updateData = {};

            if (leaveRequest.leaveType !== 'UNPAID') {
                const pendingKey = `${leaveType}Pending`;
                updateData[pendingKey] = { decrement: leaveRequest.totalDays };
            } else {
                updateData.unpaidPending = { decrement: leaveRequest.totalDays };
            }

            await tx.leaveBalance.update({
                where: {
                    userId_year: {
                        userId: req.user.id,
                        year: year
                    }
                },
                data: updateData
            });

            return updated;
        });

        await createAuditLog(req.user.id, 'UPDATE', 'leave_requests', id,
            { status: 'PENDING' }, { status: 'CANCELLED' },
            'Leave request cancelled by employee', req.ip);

        res.json({
            success: true,
            message: 'Leave request cancelled',
            data: {
                id: result.id,
                status: result.status
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get all leave requests (Admin/HR/GM/Manager)
router.get('/', authenticate, authorize('ADMIN', 'HR', 'GM', 'MANAGER'), async (req, res, next) => {
    try {
        const { status, department_id, user_id, start_date, end_date, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = {};

        // Manager can only see their department's leave requests
        if (req.user.role === 'MANAGER') {
            whereClause.user = { departmentId: req.user.department_id };
        } else if (department_id) {
            whereClause.user = { departmentId: department_id };
        }

        if (status) whereClause.status = status;
        if (user_id) whereClause.userId = user_id;
        if (start_date) whereClause.startDate = { gte: new Date(start_date) };
        if (end_date) whereClause.endDate = { lte: new Date(end_date) };

        const [requests, totalCount] = await Promise.all([
            prisma.leaveRequest.findMany({
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
                    approvedBy: {
                        select: { firstName: true, lastName: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.leaveRequest.count({ where: whereClause })
        ]);

        res.json({
            success: true,
            data: requests.map(r => ({
                id: r.id,
                user_id: r.userId,
                leave_type: r.leaveType,
                start_date: r.startDate,
                end_date: r.endDate,
                total_days: r.totalDays,
                reason: r.reason,
                status: r.status,
                approved_by: r.approvedById,
                approved_at: r.approvedAt,
                rejection_reason: r.rejectionReason,
                created_at: r.createdAt,
                updated_at: r.updatedAt,
                employee_id: r.user.employeeId,
                first_name: r.user.firstName,
                last_name: r.user.lastName,
                email: r.user.email,
                department_name: r.user.department?.name,
                approved_by_name: r.approvedBy ? `${r.approvedBy.firstName} ${r.approvedBy.lastName}` : null,
                employee_name: `${r.user.firstName} ${r.user.lastName}`
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

// Get current user's leave balance
router.get('/balance/me', authenticate, async (req, res, next) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();

        let balance = await prisma.leaveBalance.findUnique({
            where: {
                userId_year: {
                    userId: req.user.id,
                    year: year
                }
            },
            include: {
                user: {
                    select: { firstName: true, lastName: true, employeeId: true }
                }
            }
        });

        if (!balance) {
            // Create leave balance for this year if it doesn't exist
            balance = await prisma.leaveBalance.create({
                data: {
                    userId: req.user.id,
                    year: year
                }
            });
        }

        res.json({
            success: true,
            data: {
                id: balance.id,
                user_id: balance.userId,
                year: balance.year,
                casual_total: balance.casualTotal,
                casual_used: balance.casualUsed,
                casual_pending: balance.casualPending,
                sick_total: balance.sickTotal,
                sick_used: balance.sickUsed,
                sick_pending: balance.sickPending,
                paid_total: balance.paidTotal,
                paid_used: balance.paidUsed,
                paid_pending: balance.paidPending,
                unpaid_used: balance.unpaidUsed,
                unpaid_pending: balance.unpaidPending,
                casual_available: (balance.casualTotal || 0) - (balance.casualUsed || 0) - (balance.casualPending || 0),
                sick_available: (balance.sickTotal || 0) - (balance.sickUsed || 0) - (balance.sickPending || 0),
                paid_available: (balance.paidTotal || 0) - (balance.paidUsed || 0) - (balance.paidPending || 0),
                first_name: balance.user?.firstName,
                last_name: balance.user?.lastName,
                employee_id: balance.user?.employeeId
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get leave balance for user
router.get('/balance/:userId', authenticate, canAccessEmployee, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const balance = await prisma.leaveBalance.findUnique({
            where: {
                userId_year: {
                    userId: userId,
                    year: year
                }
            },
            include: {
                user: {
                    select: { firstName: true, lastName: true, employeeId: true }
                }
            }
        });

        if (!balance) {
            return res.status(404).json({
                success: false,
                error: 'Leave balance not found'
            });
        }

        res.json({
            success: true,
            data: {
                id: balance.id,
                user_id: balance.userId,
                year: balance.year,
                casual_total: balance.casualTotal,
                casual_used: balance.casualUsed,
                casual_pending: balance.casualPending,
                sick_total: balance.sickTotal,
                sick_used: balance.sickUsed,
                sick_pending: balance.sickPending,
                paid_total: balance.paidTotal,
                paid_used: balance.paidUsed,
                paid_pending: balance.paidPending,
                unpaid_used: balance.unpaidUsed,
                unpaid_pending: balance.unpaidPending,
                casual_available: (balance.casualTotal || 0) - (balance.casualUsed || 0) - (balance.casualPending || 0),
                sick_available: (balance.sickTotal || 0) - (balance.sickUsed || 0) - (balance.sickPending || 0),
                paid_available: (balance.paidTotal || 0) - (balance.paidUsed || 0) - (balance.paidPending || 0),
                first_name: balance.user?.firstName,
                last_name: balance.user?.lastName,
                employee_id: balance.user?.employeeId
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
