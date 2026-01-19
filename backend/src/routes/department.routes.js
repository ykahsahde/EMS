const express = require('express');
const router = express.Router();
const { validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { authenticate, isAdmin, isHROrAdmin } = require('../middleware/auth');
const { departmentValidation } = require('../middleware/validators');
const { createAuditLog } = require('../middleware/logger');

// Get all departments
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { is_active } = req.query;

        const whereClause = is_active !== undefined
            ? { isActive: is_active === 'true' }
            : {};

        const departments = await prisma.department.findMany({
            where: whereClause,
            include: {
                head: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                },
                users: {
                    where: { status: 'ACTIVE' },
                    select: { id: true }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json({
            success: true,
            data: departments.map(d => ({
                id: d.id,
                name: d.name,
                code: d.code,
                description: d.description,
                head_id: d.headId,
                is_active: d.isActive,
                created_at: d.createdAt,
                updated_at: d.updatedAt,
                head_name: d.head ? `${d.head.firstName} ${d.head.lastName}` : null,
                head_email: d.head?.email || null,
                employee_count: d.users.length
            }))
        });
    } catch (error) {
        next(error);
    }
});

// Get department by ID
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        const department = await prisma.department.findUnique({
            where: { id },
            include: {
                head: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            }
        });

        if (!department) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        // Get employees in department
        const employees = await prisma.user.findMany({
            where: { departmentId: id },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                status: true
            },
            orderBy: { firstName: 'asc' }
        });

        res.json({
            success: true,
            data: {
                id: department.id,
                name: department.name,
                code: department.code,
                description: department.description,
                head_id: department.headId,
                is_active: department.isActive,
                created_at: department.createdAt,
                updated_at: department.updatedAt,
                head_name: department.head ? `${department.head.firstName} ${department.head.lastName}` : null,
                head_email: department.head?.email || null,
                employees: employees.map(emp => ({
                    id: emp.id,
                    employee_id: emp.employeeId,
                    first_name: emp.firstName,
                    last_name: emp.lastName,
                    email: emp.email,
                    role: emp.role,
                    status: emp.status,
                    full_name: `${emp.firstName} ${emp.lastName}`
                }))
            }
        });
    } catch (error) {
        next(error);
    }
});

// Create department (Admin only)
router.post('/', authenticate, isAdmin, departmentValidation.create, async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { name, code, description, head_id } = req.body;

        const department = await prisma.department.create({
            data: {
                name,
                code,
                description,
                headId: head_id || null
            }
        });

        await createAuditLog(req.user.id, 'CREATE', 'departments', department.id,
            null, { name, code }, 'Department created', req.ip);

        res.status(201).json({
            success: true,
            message: 'Department created successfully',
            data: {
                id: department.id,
                name: department.name,
                code: department.code,
                description: department.description,
                head_id: department.headId,
                is_active: department.isActive,
                created_at: department.createdAt,
                updated_at: department.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Update department (Admin only)
router.put('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, description, head_id, is_active } = req.body;

        // Get current data
        const currentDept = await prisma.department.findUnique({ where: { id } });
        if (!currentDept) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        const department = await prisma.department.update({
            where: { id },
            data: {
                name: name !== undefined ? name : undefined,
                code: code !== undefined ? code : undefined,
                description: description !== undefined ? description : undefined,
                headId: head_id !== undefined ? head_id : undefined,
                isActive: is_active !== undefined ? is_active : undefined
            }
        });

        await createAuditLog(req.user.id, 'UPDATE', 'departments', id,
            { name: currentDept.name, code: currentDept.code }, req.body, 'Department updated', req.ip);

        res.json({
            success: true,
            message: 'Department updated successfully',
            data: {
                id: department.id,
                name: department.name,
                code: department.code,
                description: department.description,
                head_id: department.headId,
                is_active: department.isActive,
                created_at: department.createdAt,
                updated_at: department.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Delete department (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if department has employees
        const employeeCount = await prisma.user.count({
            where: { departmentId: id }
        });

        if (employeeCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete department with assigned employees'
            });
        }

        const department = await prisma.department.delete({
            where: { id }
        }).catch(() => null);

        if (!department) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        await createAuditLog(req.user.id, 'DELETE', 'departments', id,
            { name: department.name, code: department.code }, null, 'Department deleted', req.ip);

        res.json({
            success: true,
            message: 'Department deleted successfully'
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
