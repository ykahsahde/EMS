const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, authorize, isAdmin, isHROrAdmin, isGMOrAdmin, isManagerOrAbove, canAccessEmployee } = require('../middleware/auth');
const { userValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Middleware to allow Admin, HR, GM, or Manager to access user management
const canManageUsers = authorize('ADMIN', 'HR', 'GM', 'MANAGER');

// Get next employee ID for a department (preview)
router.get('/next-employee-id/:departmentId', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { departmentId } = req.params;

        // Get department code
        const dept = await prisma.department.findUnique({
            where: { id: departmentId },
            select: { code: true }
        });

        if (!dept) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        const deptCode = dept.code;

        // Get the highest employee ID number for this department
        const lastUser = await prisma.user.findFirst({
            where: {
                employeeId: { startsWith: deptCode }
            },
            orderBy: { employeeId: 'desc' },
            select: { employeeId: true }
        });

        let nextNumber = 1;
        if (lastUser) {
            const numPart = lastUser.employeeId.replace(deptCode, '');
            nextNumber = parseInt(numPart, 10) + 1;
        }

        const nextEmployeeId = deptCode + nextNumber.toString().padStart(3, '0');

        res.json({
            success: true,
            data: {
                next_employee_id: nextEmployeeId,
                department_code: deptCode
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get all users (Admin, HR, GM see all; Manager sees only their department)
router.get('/', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { department_id, role, status, search, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = {};

        // Manager can only see employees in their department or their direct reports
        if (req.user.role === 'MANAGER') {
            whereClause.OR = [
                { departmentId: req.user.department_id },
                { managerId: req.user.id }
            ];
        } else if (department_id) {
            whereClause.departmentId = department_id;
        }

        if (role) whereClause.role = role;
        if (status) whereClause.status = status;
        if (search) {
            whereClause.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { employeeId: { contains: search, mode: 'insensitive' } }
            ];
        }

        const [users, totalCount] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                include: {
                    department: { select: { name: true } },
                    shift: { select: { name: true } },
                    manager: { select: { firstName: true, lastName: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.user.count({ where: whereClause })
        ]);

        res.json({
            success: true,
            data: users.map(user => ({
                id: user.id,
                employee_id: user.employeeId,
                email: user.email,
                first_name: user.firstName,
                last_name: user.lastName,
                phone: user.phone,
                role: user.role,
                status: user.status,
                date_of_joining: user.dateOfJoining,
                profile_picture_url: user.profilePictureUrl,
                face_registered_at: user.faceRegisteredAt,
                last_login: user.lastLogin,
                created_at: user.createdAt,
                department_id: user.departmentId,
                department_name: user.department?.name,
                shift_name: user.shift?.name,
                manager_name: user.manager ? `${user.manager.firstName} ${user.manager.lastName}` : null,
                manager_id: user.managerId,
                full_name: `${user.firstName} ${user.lastName}`,
                face_registered: !!user.faceRegisteredAt
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

// Get user by ID
router.get('/:id', authenticate, canAccessEmployee, async (req, res, next) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                department: { select: { name: true } },
                shift: { select: { name: true } },
                manager: { select: { firstName: true, lastName: true, email: true } }
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                employee_id: user.employeeId,
                email: user.email,
                first_name: user.firstName,
                last_name: user.lastName,
                phone: user.phone,
                role: user.role,
                status: user.status,
                department_id: user.departmentId,
                shift_id: user.shiftId,
                manager_id: user.managerId,
                date_of_joining: user.dateOfJoining,
                date_of_birth: user.dateOfBirth,
                address: user.address,
                emergency_contact: user.emergencyContact,
                profile_picture_url: user.profilePictureUrl,
                face_registered_at: user.faceRegisteredAt,
                last_login: user.lastLogin,
                created_at: user.createdAt,
                updated_at: user.updatedAt,
                department_name: user.department?.name,
                shift_name: user.shift?.name,
                manager_name: user.manager ? `${user.manager.firstName} ${user.manager.lastName}` : null,
                manager_email: user.manager?.email,
                full_name: `${user.firstName} ${user.lastName}`,
                face_registered: !!user.faceRegisteredAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Create new user (Admin, HR, GM, Manager)
router.post('/', authenticate, canManageUsers, userValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const {
            email, password, first_name, last_name, phone,
            role, department_id, shift_id, manager_id, date_of_joining,
            date_of_birth, address, emergency_contact
        } = req.body;

        // Role-based restrictions
        if (req.user.role === 'HR' && (role === 'ADMIN' || role === 'GM')) {
            return res.status(403).json({
                success: false,
                error: 'HR cannot assign Admin or GM role'
            });
        }

        // Manager can only create EMPLOYEE role and only in their own department
        if (req.user.role === 'MANAGER') {
            if (role && role !== 'EMPLOYEE') {
                return res.status(403).json({
                    success: false,
                    error: 'Manager can only create employees, not other roles'
                });
            }
            if (department_id && department_id !== req.user.department_id) {
                return res.status(403).json({
                    success: false,
                    error: 'Manager can only add employees to their own department'
                });
            }
        }

        // Set department_id for Manager creating employee
        const finalDepartmentId = req.user.role === 'MANAGER' ? req.user.department_id : department_id;

        // Auto-generate employee ID based on department
        let employee_id;
        if (finalDepartmentId) {
            const dept = await prisma.department.findUnique({
                where: { id: finalDepartmentId },
                select: { code: true }
            });

            if (dept) {
                const deptCode = dept.code;
                const lastUser = await prisma.user.findFirst({
                    where: { employeeId: { startsWith: deptCode } },
                    orderBy: { employeeId: 'desc' },
                    select: { employeeId: true }
                });

                let nextNumber = 1;
                if (lastUser) {
                    const numPart = lastUser.employeeId.replace(deptCode, '');
                    nextNumber = parseInt(numPart, 10) + 1;
                }
                employee_id = deptCode + nextNumber.toString().padStart(3, '0');
            } else {
                const lastGeneric = await prisma.user.findFirst({
                    where: { employeeId: { startsWith: 'EMP' } },
                    orderBy: { employeeId: 'desc' },
                    select: { employeeId: true }
                });
                let nextNumber = 1;
                if (lastGeneric) {
                    const numPart = lastGeneric.employeeId.replace('EMP', '');
                    nextNumber = parseInt(numPart, 10) + 1;
                }
                employee_id = 'EMP' + nextNumber.toString().padStart(3, '0');
            }
        } else {
            const lastGeneric = await prisma.user.findFirst({
                where: { employeeId: { startsWith: 'EMP' } },
                orderBy: { employeeId: 'desc' },
                select: { employeeId: true }
            });
            let nextNumber = 1;
            if (lastGeneric) {
                const numPart = lastGeneric.employeeId.replace('EMP', '');
                nextNumber = parseInt(numPart, 10) + 1;
            }
            employee_id = 'EMP' + nextNumber.toString().padStart(3, '0');
        }

        // Default date_of_joining to today if not provided
        const finalDateOfJoining = date_of_joining ? new Date(date_of_joining) : new Date();

        // Hash password
        const password_hash = await bcrypt.hash(password, 12);

        const result = await prisma.$transaction(async (tx) => {
            // Create user
            const newUser = await tx.user.create({
                data: {
                    employeeId: employee_id,
                    email,
                    passwordHash: password_hash,
                    firstName: first_name,
                    lastName: last_name,
                    phone,
                    role: role || 'EMPLOYEE',
                    departmentId: finalDepartmentId || null,
                    shiftId: shift_id || null,
                    managerId: manager_id || (req.user.role === 'MANAGER' ? req.user.id : null),
                    dateOfJoining: finalDateOfJoining,
                    dateOfBirth: date_of_birth ? new Date(date_of_birth) : null,
                    address,
                    emergencyContact: emergency_contact,
                    createdBy: req.user.id
                },
                select: {
                    id: true,
                    employeeId: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    status: true
                }
            });

            // Create leave balance for current year
            await tx.leaveBalance.create({
                data: {
                    userId: newUser.id,
                    year: new Date().getFullYear()
                }
            });

            return newUser;
        });

        await createAuditLog(req.user.id, 'CREATE', 'users', result.id, null,
            { employee_id, email, role: role || 'EMPLOYEE' }, 'New user created', req.ip);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                id: result.id,
                employee_id: result.employeeId,
                email: result.email,
                first_name: result.firstName,
                last_name: result.lastName,
                role: result.role,
                status: result.status
            }
        });
    } catch (error) {
        next(error);
    }
});

// Update user (Admin, HR)
router.put('/:id', authenticate, canManageUsers, userValidation.update, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const updates = req.body;

        // Get current user data for audit
        const currentUser = await prisma.user.findUnique({ where: { id } });
        if (!currentUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // HR cannot change role to Admin
        if (req.user.role === 'HR' && updates.role === 'ADMIN') {
            return res.status(403).json({
                success: false,
                error: 'HR cannot assign Admin role'
            });
        }

        // Build update data
        const updateData = {};
        if (updates.first_name !== undefined) updateData.firstName = updates.first_name;
        if (updates.last_name !== undefined) updateData.lastName = updates.last_name;
        if (updates.phone !== undefined) updateData.phone = updates.phone;
        if (updates.role !== undefined) updateData.role = updates.role;
        if (updates.status !== undefined) updateData.status = updates.status;
        if (updates.department_id !== undefined) updateData.departmentId = updates.department_id;
        if (updates.shift_id !== undefined) updateData.shiftId = updates.shift_id;
        if (updates.manager_id !== undefined) updateData.managerId = updates.manager_id;
        if (updates.address !== undefined) updateData.address = updates.address;
        if (updates.emergency_contact !== undefined) updateData.emergencyContact = updates.emergency_contact;
        if (updates.date_of_birth !== undefined) updateData.dateOfBirth = new Date(updates.date_of_birth);

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                employeeId: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                status: true
            }
        });

        await createAuditLog(req.user.id, 'UPDATE', 'users', id,
            { first_name: currentUser.firstName, last_name: currentUser.lastName, role: currentUser.role, status: currentUser.status },
            updates, 'User updated', req.ip);

        res.json({
            success: true,
            message: 'User updated successfully',
            data: {
                id: user.id,
                employee_id: user.employeeId,
                email: user.email,
                first_name: user.firstName,
                last_name: user.lastName,
                role: user.role,
                status: user.status
            }
        });
    } catch (error) {
        next(error);
    }
});

// Deactivate user (Admin, HR, GM, Manager)
router.patch('/:id/deactivate', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Reason is required for deactivation'
            });
        }

        // Get target user to check permissions
        const target = await prisma.user.findUnique({ where: { id } });
        if (!target) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Cannot deactivate GM
        if (target.role === 'GM') {
            return res.status(403).json({ success: false, error: 'Cannot deactivate the General Manager' });
        }

        // Manager can only deactivate employees in their department
        if (req.user.role === 'MANAGER') {
            if (target.role !== 'EMPLOYEE' || target.departmentId !== req.user.department_id) {
                return res.status(403).json({ success: false, error: 'You can only deactivate employees in your department' });
            }
        }

        const user = await prisma.user.update({
            where: { id },
            data: { status: 'INACTIVE' },
            select: {
                id: true,
                employeeId: true,
                email: true,
                status: true
            }
        });

        await createAuditLog(req.user.id, 'UPDATE', 'users', id,
            { status: 'ACTIVE' }, { status: 'INACTIVE' }, reason, req.ip);

        res.json({
            success: true,
            message: 'User deactivated successfully',
            data: {
                id: user.id,
                employee_id: user.employeeId,
                email: user.email,
                status: user.status
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get team members (for Managers)
router.get('/team/members', authenticate, authorize('MANAGER', 'ADMIN', 'HR'), async (req, res, next) => {
    try {
        let whereClause = { status: 'ACTIVE' };

        if (req.user.role === 'MANAGER') {
            whereClause.managerId = req.user.id;
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            include: {
                department: { select: { name: true } },
                shift: { select: { name: true } }
            },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
        });

        res.json({
            success: true,
            data: users.map(user => ({
                id: user.id,
                employee_id: user.employeeId,
                email: user.email,
                first_name: user.firstName,
                last_name: user.lastName,
                role: user.role,
                status: user.status,
                profile_picture_url: user.profilePictureUrl,
                department_name: user.department?.name,
                shift_name: user.shift?.name,
                full_name: `${user.firstName} ${user.lastName}`
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Delete user (Admin, HR, GM, Manager - with restrictions)
router.delete('/:id', authenticate, canManageUsers, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Cannot delete yourself
        if (id === req.user.id) {
            return res.status(403).json({ success: false, error: 'Cannot delete your own account' });
        }

        // Get target user to check permissions
        const target = await prisma.user.findUnique({ where: { id } });
        if (!target) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Nobody can delete GM (Director)
        if (target.role === 'GM') {
            return res.status(403).json({ success: false, error: 'Cannot delete the General Manager (Director)' });
        }

        // Manager can only delete employees in their department
        if (req.user.role === 'MANAGER') {
            if (target.role !== 'EMPLOYEE') {
                return res.status(403).json({ success: false, error: 'Managers can only delete employees' });
            }
            if (target.departmentId !== req.user.department_id) {
                return res.status(403).json({ success: false, error: 'You can only delete employees in your department' });
            }
        }

        // HR cannot delete Admin or GM
        if (req.user.role === 'HR' && (target.role === 'ADMIN' || target.role === 'GM')) {
            return res.status(403).json({ success: false, error: 'HR cannot delete Admin or GM users' });
        }

        // Delete user
        await prisma.user.delete({ where: { id } });

        await createAuditLog(req.user.id, 'DELETE', 'users', id,
            { employee_id: target.employeeId, email: target.email, role: target.role },
            null, 'User deleted', req.ip);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Reset user password (Admin only)
router.post('/:id/reset-password', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { new_password } = req.body;

        if (!new_password || new_password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters'
            });
        }

        const password_hash = await bcrypt.hash(new_password, 12);

        const user = await prisma.user.update({
            where: { id },
            data: {
                passwordHash: password_hash,
                passwordChangedAt: new Date()
            },
            select: {
                id: true,
                employeeId: true,
                email: true
            }
        }).catch(() => null);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'users', id, null,
            { action: 'password_reset' }, 'Admin password reset', req.ip);

        res.json({
            success: true,
            message: 'Password reset successfully',
            data: {
                id: user.id,
                employee_id: user.employeeId,
                email: user.email
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get organization hierarchy - GM (Director) and Department Managers
router.get('/organization/hierarchy', authenticate, async (req, res, next) => {
    try {
        // Get GM (Director)
        const gm = await prisma.user.findFirst({
            where: { role: 'GM', status: 'ACTIVE' },
            include: {
                department: { select: { name: true } }
            }
        });

        // Get all department managers with their department info
        const managers = await prisma.user.findMany({
            where: { role: 'MANAGER', status: 'ACTIVE' },
            include: {
                department: { select: { id: true, name: true, code: true } }
            },
            orderBy: { department: { name: 'asc' } }
        });

        // Get employee counts per department
        const employeeCounts = await prisma.user.groupBy({
            by: ['departmentId'],
            where: { status: 'ACTIVE' },
            _count: { id: true }
        });
        const countMap = {};
        employeeCounts.forEach(c => {
            if (c.departmentId) countMap[c.departmentId] = c._count.id;
        });

        // Get department heads
        const departments = await prisma.department.findMany({
            where: { isActive: true },
            include: {
                head: {
                    select: { id: true, firstName: true, lastName: true, email: true, role: true }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            success: true,
            data: {
                director: gm ? {
                    id: gm.id,
                    employee_id: gm.employeeId,
                    email: gm.email,
                    first_name: gm.firstName,
                    last_name: gm.lastName,
                    phone: gm.phone,
                    role: gm.role,
                    profile_picture_url: gm.profilePictureUrl,
                    department_name: gm.department?.name,
                    full_name: `${gm.firstName} ${gm.lastName}`,
                    title: 'Director / General Manager'
                } : null,
                department_managers: managers.map(mgr => ({
                    id: mgr.id,
                    employee_id: mgr.employeeId,
                    email: mgr.email,
                    first_name: mgr.firstName,
                    last_name: mgr.lastName,
                    phone: mgr.phone,
                    role: mgr.role,
                    profile_picture_url: mgr.profilePictureUrl,
                    department_id: mgr.departmentId,
                    department_name: mgr.department?.name,
                    department_code: mgr.department?.code,
                    employee_count: countMap[mgr.departmentId] || 0,
                    full_name: `${mgr.firstName} ${mgr.lastName}`
                })),
                departments: departments.map(dept => ({
                    department_id: dept.id,
                    department_name: dept.name,
                    department_code: dept.code,
                    head_id: dept.headId,
                    first_name: dept.head?.firstName,
                    last_name: dept.head?.lastName,
                    email: dept.head?.email,
                    role: dept.head?.role,
                    head_name: dept.head ? `${dept.head.firstName} ${dept.head.lastName}` : null
                }))
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get employees by department (for department managers)
router.get('/department/:departmentId/employees', authenticate, isManagerOrAbove, async (req, res, next) => {
    try {
        const { departmentId } = req.params;

        // Manager can only see their own department
        if (req.user.role === 'MANAGER' && req.user.department_id !== departmentId) {
            return res.status(403).json({
                success: false,
                error: 'You can only view employees in your own department'
            });
        }

        const users = await prisma.user.findMany({
            where: { departmentId, status: 'ACTIVE' },
            include: {
                shift: { select: { name: true } },
                manager: { select: { firstName: true, lastName: true } }
            },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
        });

        res.json({
            success: true,
            data: users.map(user => ({
                id: user.id,
                employee_id: user.employeeId,
                email: user.email,
                first_name: user.firstName,
                last_name: user.lastName,
                phone: user.phone,
                role: user.role,
                status: user.status,
                date_of_joining: user.dateOfJoining,
                profile_picture_url: user.profilePictureUrl,
                shift_name: user.shift?.name,
                manager_name: user.manager ? `${user.manager.firstName} ${user.manager.lastName}` : null,
                full_name: `${user.firstName} ${user.lastName}`
            }))
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
