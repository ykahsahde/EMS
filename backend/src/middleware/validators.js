const { body, param, query: queryValidator } = require('express-validator');

// User validation rules
const userValidation = {
    create: [
        // employee_id is now auto-generated, so it's optional
        body('employee_id')
            .optional()
            .trim()
            .matches(/^[A-Z]{2,5}[0-9]{3,6}$/).withMessage('Invalid employee ID format (e.g., HR001)'),
        body('email')
            .trim()
            .isEmail().withMessage('Valid email is required')
            .normalizeEmail(),
        body('password')
            .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('first_name')
            .trim()
            .notEmpty().withMessage('First name is required')
            .isLength({ max: 100 }),
        body('last_name')
            .trim()
            .notEmpty().withMessage('Last name is required')
            .isLength({ max: 100 }),
        body('phone')
            .optional({ checkFalsy: true })
            .matches(/^\+?[0-9\s-]{10,15}$/).withMessage('Invalid phone number'),
        body('role')
            .optional()
            .isIn(['ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE']).withMessage('Invalid role'),
        body('date_of_joining')
            .optional()
            .isISO8601().withMessage('Valid date of joining is required'),
        body('department_id')
            .optional({ checkFalsy: true })
            .isUUID().withMessage('Invalid department ID'),
        body('shift_id')
            .optional({ checkFalsy: true })
            .isUUID().withMessage('Invalid shift ID'),
        body('manager_id')
            .optional({ checkFalsy: true })
            .isUUID().withMessage('Invalid manager ID')
    ],
    update: [
        param('id').isUUID().withMessage('Invalid user ID'),
        body('first_name').optional().trim().notEmpty(),
        body('last_name').optional().trim().notEmpty(),
        body('phone').optional({ checkFalsy: true }).matches(/^\+?[0-9\s-]{10,15}$/),
        body('role').optional().isIn(['ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE']),
        body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
        body('department_id').optional({ checkFalsy: true }).isUUID(),
        body('shift_id').optional({ checkFalsy: true }).isUUID(),
        body('manager_id').optional({ checkFalsy: true }).isUUID()
    ]
};

// Attendance validation rules
const attendanceValidation = {
    checkIn: [
        body('is_face_verified')
            .optional()
            .isBoolean().withMessage('Face verified must be boolean'),
        body('face_score')
            .optional()
            .isFloat({ min: 0, max: 1 }).withMessage('Face score must be between 0 and 1'),
        body('location')
            .optional()
            .isObject().withMessage('Location must be an object')
    ],
    manualEntry: [
        body('user_id')
            .isUUID().withMessage('Valid user ID is required'),
        body('date')
            .isISO8601().withMessage('Valid date is required'),
        body('check_in_time')
            .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid check-in time is required'),
        body('check_out_time')
            .optional()
            .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid check-out time format'),
        body('status')
            .isIn(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY']).withMessage('Invalid status'),
        body('reason')
            .trim()
            .notEmpty().withMessage('Reason is mandatory for manual entry')
            .isLength({ min: 10, max: 500 }).withMessage('Reason must be 10-500 characters')
    ],
    getRecords: [
        queryValidator('start_date').optional().isISO8601(),
        queryValidator('end_date').optional().isISO8601(),
        queryValidator('user_id').optional().isUUID(),
        queryValidator('department_id').optional().isUUID(),
        queryValidator('status').optional().isIn(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'])
    ]
};

// Leave validation rules
const leaveValidation = {
    apply: [
        body('leave_type')
            .isIn(['CASUAL', 'SICK', 'PAID', 'UNPAID', 'MATERNITY', 'PATERNITY'])
            .withMessage('Invalid leave type'),
        body('start_date')
            .isISO8601().withMessage('Valid start date is required'),
        body('end_date')
            .isISO8601().withMessage('Valid end date is required'),
        body('reason')
            .trim()
            .notEmpty().withMessage('Reason is required')
            .isLength({ min: 10, max: 1000 }).withMessage('Reason must be 10-1000 characters')
    ],
    approve: [
        param('id').isUUID().withMessage('Invalid leave request ID'),
        body('status')
            .isIn(['APPROVED', 'REJECTED']).withMessage('Status must be APPROVED or REJECTED'),
        body('rejection_reason')
            .if(body('status').equals('REJECTED'))
            .notEmpty().withMessage('Rejection reason is required when rejecting')
    ]
};

// Department validation
const departmentValidation = {
    create: [
        body('name')
            .trim()
            .notEmpty().withMessage('Department name is required')
            .isLength({ max: 100 }),
        body('code')
            .trim()
            .notEmpty().withMessage('Department code is required')
            .matches(/^[A-Z]{2,10}$/).withMessage('Code must be 2-10 uppercase letters'),
        body('description').optional().trim(),
        body('head_id').optional().isUUID()
    ]
};

// Shift validation
const shiftValidation = {
    create: [
        body('name')
            .trim()
            .notEmpty().withMessage('Shift name is required'),
        body('code')
            .trim()
            .notEmpty().withMessage('Shift code is required')
            .matches(/^[A-Z]{2,10}$/).withMessage('Code must be 2-10 uppercase letters'),
        body('shift_type')
            .isIn(['DAY', 'NIGHT', 'ROTATIONAL', 'FLEXIBLE']).withMessage('Invalid shift type'),
        body('start_time')
            .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid start time required'),
        body('end_time')
            .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid end time required'),
        body('grace_period_minutes')
            .optional()
            .isInt({ min: 0, max: 60 }).withMessage('Grace period must be 0-60 minutes')
    ]
};

// Holiday validation
const holidayValidation = {
    create: [
        body('name')
            .trim()
            .notEmpty().withMessage('Holiday name is required'),
        body('date')
            .isISO8601().withMessage('Valid date is required'),
        body('is_optional')
            .optional()
            .isBoolean(),
        body('description').optional().trim()
    ]
};

module.exports = {
    userValidation,
    attendanceValidation,
    leaveValidation,
    departmentValidation,
    shiftValidation,
    holidayValidation
};
