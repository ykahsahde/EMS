const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { createAuditLog } = require('../middleware/logger');

// Login
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { email, password } = req.body;


        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                department: {
                    select: { name: true }
                },
                shift: {
                    select: { name: true }
                }
            }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if user is active
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                error: 'Account is inactive or suspended. Please contact HR.'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, role: user.role, employeeId: user.employeeId },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Create audit log
        await createAuditLog(user.id, 'LOGIN', 'users', user.id, null, null, 'User login', req.ip);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    employee_id: user.employeeId,
                    email: user.email,
                    first_name: user.firstName,
                    last_name: user.lastName,
                    full_name: `${user.firstName} ${user.lastName}`,
                    role: user.role,
                    department: user.department?.name || null,
                    department_id: user.departmentId,
                    shift: user.shift?.name || null,
                    shift_id: user.shiftId,
                    profile_picture_url: user.profilePictureUrl,
                    face_registered: !!user.faceRegisteredAt
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

// Logout
router.post('/logout', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                await createAuditLog(decoded.userId, 'LOGOUT', 'users', decoded.userId, null, null, 'User logout', req.ip);
            } catch (e) {
                // Token might be invalid, but still allow logout
            }
        }

        res.json({
            success: true,
            message: 'Logout successful'
        });
    } catch (error) {
        next(error);
    }
});

// Change password
router.post('/change-password', [
    body('current_password').notEmpty(),
    body('new_password')
        .isLength({ min: 8 })
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
], async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const { current_password, new_password } = req.body;

        // Get user
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify current password
        const isValid = await bcrypt.compare(current_password, user.passwordHash);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(new_password, 12);

        // Update password
        await prisma.user.update({
            where: { id: decoded.userId },
            data: {
                passwordHash: newPasswordHash,
                passwordChangedAt: new Date()
            }
        });

        await createAuditLog(decoded.userId, 'UPDATE', 'users', decoded.userId, null, 
            { action: 'password_change' }, 'Password changed', req.ip);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        next(error);
    }
});

// Helper function to calculate Euclidean distance for face matching
function calculateEuclideanDistance(descriptor1, descriptor2) {
    if (!Array.isArray(descriptor1) || !Array.isArray(descriptor2)) {
        throw new Error('Invalid descriptors');
    }
    if (descriptor1.length !== descriptor2.length) {
        throw new Error('Descriptor dimensions do not match');
    }
    let sum = 0;
    for (let i = 0; i < descriptor1.length; i++) {
        sum += Math.pow(descriptor1[i] - descriptor2[i], 2);
    }
    return Math.sqrt(sum);
}

// Step 1: Initiate password reset - verify email and check if face is registered
router.post('/forgot-password/initiate', [
    body('email').isEmail().normalizeEmail()
], async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { email } = req.body;

        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                faceRegisteredAt: true,
                faceDescriptor: true
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'No account found with this email address'
            });
        }

        if (user.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                error: 'Account is inactive or suspended. Please contact HR.'
            });
        }

        if (!user.faceRegisteredAt || !user.faceDescriptor) {
            return res.status(400).json({
                success: false,
                error: 'Face recognition is not registered for this account. Please contact HR to reset your password.'
            });
        }

        // Generate a temporary token for the reset session (valid for 10 minutes)
        const resetToken = jwt.sign(
            { userId: user.id, purpose: 'password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
        );

        res.json({
            success: true,
            message: 'Email verified. Please verify your face to reset password.',
            data: {
                reset_token: resetToken,
                user_name: `${user.firstName} ${user.lastName}`,
                employee_id: user.employeeId
            }
        });
    } catch (error) {
        next(error);
    }
});

// Step 2: Verify face and reset password
router.post('/forgot-password/reset', [
    body('reset_token').notEmpty(),
    body('face_descriptor').notEmpty(),
    body('new_password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
        .withMessage('Password must contain uppercase, lowercase, number and special character')
], async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { reset_token, face_descriptor, new_password } = req.body;

        // Verify reset token
        let decoded;
        try {
            decoded = jwt.verify(reset_token, process.env.JWT_SECRET);
            if (decoded.purpose !== 'password_reset') {
                throw new Error('Invalid token purpose');
            }
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Reset session expired or invalid. Please start again.'
            });
        }

        // Get user with face data
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                email: true,
                faceDescriptor: true
            }
        });

        if (!user || !user.faceDescriptor) {
            return res.status(400).json({
                success: false,
                error: 'User not found or face not registered'
            });
        }

        // Parse and validate face descriptors
        let inputDescriptor;
        try {
            inputDescriptor = typeof face_descriptor === 'string' 
                ? JSON.parse(face_descriptor) 
                : face_descriptor;
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid face descriptor format'
            });
        }

        // Extract stored descriptors
        const storedFaceData = user.faceDescriptor;
        let storedDescriptors = [];
        
        if (storedFaceData.descriptor) {
            storedDescriptors = [storedFaceData.descriptor];
        } else if (storedFaceData.face_descriptors && Array.isArray(storedFaceData.face_descriptors)) {
            storedDescriptors = storedFaceData.face_descriptors;
        } else if (Array.isArray(storedFaceData)) {
            storedDescriptors = [storedFaceData];
        }

        if (storedDescriptors.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid face registration data. Please contact HR.'
            });
        }

        // Face matching
        const threshold = parseFloat(process.env.FACE_RECOGNITION_THRESHOLD) || 0.6;
        let bestDistance = Infinity;

        for (const storedDescriptor of storedDescriptors) {
            if (!Array.isArray(storedDescriptor) || storedDescriptor.length !== 128) continue;
            const distance = calculateEuclideanDistance(storedDescriptor, inputDescriptor);
            if (distance < bestDistance) {
                bestDistance = distance;
            }
        }

        const isMatch = bestDistance < threshold;
        const confidenceScore = Math.max(0, 1 - bestDistance);

        if (!isMatch) {
            await createAuditLog(user.id, 'UPDATE', 'users', user.id, null,
                { action: 'password_reset_failed', reason: 'face_mismatch', confidence: confidenceScore.toFixed(4) },
                'Password reset failed - face verification failed', req.ip);

            return res.status(401).json({
                success: false,
                error: 'Face verification failed. Please try again or contact HR.',
                data: {
                    confidence_score: confidenceScore.toFixed(4)
                }
            });
        }

        // Face matched - update password
        const newPasswordHash = await bcrypt.hash(new_password, 12);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash: newPasswordHash,
                passwordChangedAt: new Date()
            }
        });

        await createAuditLog(user.id, 'UPDATE', 'users', user.id, null,
            { action: 'password_reset_success', method: 'face_recognition', confidence: confidenceScore.toFixed(4) },
            'Password reset via face recognition', req.ip);

        res.json({
            success: true,
            message: 'Password reset successfully! You can now login with your new password.',
            data: {
                user_name: `${user.firstName} ${user.lastName}`,
                confidence_score: confidenceScore.toFixed(4)
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get current user profile
router.get('/me', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                employeeId: true,
                email: true,
                firstName: true,
                lastName: true,
                phone: true,
                role: true,
                status: true,
                dateOfJoining: true,
                dateOfBirth: true,
                address: true,
                profilePictureUrl: true,
                faceRegisteredAt: true,
                lastLogin: true,
                departmentId: true,
                shiftId: true,
                department: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                shift: {
                    select: {
                        id: true,
                        name: true,
                        startTime: true,
                        endTime: true
                    }
                },
                manager: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Get leave balance
        const currentYear = new Date().getFullYear();
        const leaveBalance = await prisma.leaveBalance.findUnique({
            where: {
                userId_year: {
                    userId: decoded.userId,
                    year: currentYear
                }
            }
        });

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
                date_of_joining: user.dateOfJoining,
                date_of_birth: user.dateOfBirth,
                address: user.address,
                profile_picture_url: user.profilePictureUrl,
                face_registered_at: user.faceRegisteredAt,
                last_login: user.lastLogin,
                department_id: user.department?.id || null,
                department_name: user.department?.name || null,
                shift_id: user.shift?.id || null,
                shift_name: user.shift?.name || null,
                start_time: user.shift?.startTime || null,
                end_time: user.shift?.endTime || null,
                manager_name: user.manager ? `${user.manager.firstName} ${user.manager.lastName}` : null,
                manager_email: user.manager?.email || null,
                full_name: `${user.firstName} ${user.lastName}`,
                face_registered: !!user.faceRegisteredAt,
                leave_balance: leaveBalance || null
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
