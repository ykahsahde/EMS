const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/prisma');
const { authenticate, isHROrAdmin } = require('../middleware/auth');
const { createAuditLog } = require('../middleware/logger');

// Configure multer for face image upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../face_data/uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only JPEG and PNG images are allowed'));
    }
});

// Register face (Employee registers their own face)
router.post('/register', authenticate, upload.single('face_image'), async (req, res, next) => {
    try {
        const { face_descriptor } = req.body;

        if (!face_descriptor) {
            return res.status(400).json({
                success: false,
                error: 'Face descriptor is required'
            });
        }

        let descriptorData;
        try {
            descriptorData = typeof face_descriptor === 'string'
                ? JSON.parse(face_descriptor)
                : face_descriptor;
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid face descriptor format'
            });
        }

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                faceDescriptor: descriptorData,
                faceRegisteredAt: new Date()
            },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                faceRegisteredAt: true
            }
        });

        await createAuditLog(req.user.id, 'UPDATE', 'users', req.user.id,
            null, { action: 'face_registered' }, 'Face registered', req.ip);

        res.json({
            success: true,
            message: 'Face registered successfully',
            data: {
                id: user.id,
                employee_id: user.employeeId,
                first_name: user.firstName,
                last_name: user.lastName,
                face_registered_at: user.faceRegisteredAt,
                face_image_path: req.file?.filename
            }
        });
    } catch (error) {
        next(error);
    }
});

// Register face for employee (Admin/HR)
router.post('/register/:userId', authenticate, isHROrAdmin, upload.single('face_image'), async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { face_descriptor } = req.body;

        if (!face_descriptor) {
            return res.status(400).json({
                success: false,
                error: 'Face descriptor is required'
            });
        }

        let descriptorData;
        try {
            descriptorData = typeof face_descriptor === 'string'
                ? JSON.parse(face_descriptor)
                : face_descriptor;
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid face descriptor format'
            });
        }

        // Verify user exists
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true }
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: {
                faceDescriptor: descriptorData,
                faceRegisteredAt: new Date()
            },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                faceRegisteredAt: true
            }
        });

        await createAuditLog(req.user.id, 'UPDATE', 'users', userId,
            null, { action: 'face_registered_by_admin' }, 'Face registered by admin/HR', req.ip);

        res.json({
            success: true,
            message: 'Face registered successfully',
            data: {
                id: user.id,
                employee_id: user.employeeId,
                first_name: user.firstName,
                last_name: user.lastName,
                face_registered_at: user.faceRegisteredAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Verify face for attendance
router.post('/verify', authenticate, async (req, res, next) => {
    try {
        const { face_descriptor } = req.body;

        if (!face_descriptor) {
            return res.status(400).json({
                success: false,
                error: 'Face descriptor is required'
            });
        }

        // Get user's registered face
        const user = await prisma.user.findFirst({
            where: {
                id: req.user.id,
                faceRegisteredAt: { not: null }
            },
            select: { faceDescriptor: true }
        });

        if (!user || !user.faceDescriptor) {
            return res.status(400).json({
                success: false,
                error: 'No registered face found. Please register your face first.'
            });
        }

        const storedFaceData = user.faceDescriptor;
        const inputDescriptor = typeof face_descriptor === 'string'
            ? JSON.parse(face_descriptor)
            : face_descriptor;

        // Extract stored descriptors - support multiple formats
        let storedDescriptors = [];
        if (storedFaceData.descriptor) {
            // Format: { descriptor: [...] }
            storedDescriptors = [storedFaceData.descriptor];
        } else if (storedFaceData.face_descriptors && Array.isArray(storedFaceData.face_descriptors)) {
            // Format: { face_descriptors: [[...], [...]] }
            storedDescriptors = storedFaceData.face_descriptors;
        } else if (Array.isArray(storedFaceData)) {
            // Format: Direct array [...]
            storedDescriptors = [storedFaceData];
        }

        if (storedDescriptors.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid face registration data. Please re-register your face.'
            });
        }

        // Calculate Euclidean distance against all stored descriptors
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

        res.json({
            success: true,
            data: {
                verified: isMatch,
                is_verified: isMatch, // backward compatibility
                confidence_score: confidenceScore.toFixed(4),
                score: confidenceScore, // backward compatibility
                distance: bestDistance.toFixed(4),
                threshold
            }
        });
    } catch (error) {
        next(error);
    }
});

// Check if face is registered
router.get('/status', authenticate, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { faceRegisteredAt: true }
        });

        res.json({
            success: true,
            data: {
                is_registered: !!user?.faceRegisteredAt,
                registered_at: user?.faceRegisteredAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get face registration status for user (Admin/HR)
router.get('/status/:userId', authenticate, isHROrAdmin, async (req, res, next) => {
    try {
        const { userId } = req.params;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                faceRegisteredAt: true
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
                first_name: user.firstName,
                last_name: user.lastName,
                face_registered_at: user.faceRegisteredAt,
                is_registered: !!user.faceRegisteredAt
            }
        });
    } catch (error) {
        next(error);
    }
});

// Delete face registration (Admin only)
router.delete('/register/:userId', authenticate, isHROrAdmin, async (req, res, next) => {
    try {
        const { userId } = req.params;

        const user = await prisma.user.update({
            where: { id: userId },
            data: {
                faceDescriptor: null,
                faceRegisteredAt: null
            },
            select: {
                id: true,
                employeeId: true
            }
        }).catch(() => null);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        await createAuditLog(req.user.id, 'UPDATE', 'users', userId,
            { face_registered: true }, { face_registered: false },
            'Face registration removed', req.ip);

        res.json({
            success: true,
            message: 'Face registration removed'
        });
    } catch (error) {
        next(error);
    }
});

// Get all users with face registration status (Admin/HR)
router.get('/registered-users', authenticate, isHROrAdmin, async (req, res, next) => {
    try {
        const { registered } = req.query;

        let whereClause = { status: 'ACTIVE' };

        if (registered === 'true') {
            whereClause.faceRegisteredAt = { not: null };
        } else if (registered === 'false') {
            whereClause.faceRegisteredAt = null;
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                email: true,
                departmentId: true,
                faceRegisteredAt: true
            },
            orderBy: { firstName: 'asc' }
        });

        const registeredCount = users.filter(u => u.faceRegisteredAt).length;

        res.json({
            success: true,
            data: users.map(u => ({
                id: u.id,
                employee_id: u.employeeId,
                first_name: u.firstName,
                last_name: u.lastName,
                email: u.email,
                department_id: u.departmentId,
                face_registered_at: u.faceRegisteredAt,
                full_name: `${u.firstName} ${u.lastName}`,
                is_registered: !!u.faceRegisteredAt
            })),
            summary: {
                total: users.length,
                registered: registeredCount,
                not_registered: users.length - registeredCount
            }
        });
    } catch (error) {
        next(error);
    }
});

// Helper function to calculate Euclidean distance
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

module.exports = router;
