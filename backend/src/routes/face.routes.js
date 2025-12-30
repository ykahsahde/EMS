const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
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

        const result = await query(
            `UPDATE users 
             SET face_descriptor = $1, face_registered_at = NOW()
             WHERE id = $2
             RETURNING id, employee_id, first_name, last_name, face_registered_at`,
            [JSON.stringify(descriptorData), req.user.id]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'users', req.user.id,
            null, { action: 'face_registered' }, 'Face registered', req.ip);

        res.json({
            success: true,
            message: 'Face registered successfully',
            data: {
                ...result.rows[0],
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
        const userCheck = await query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const result = await query(
            `UPDATE users 
             SET face_descriptor = $1, face_registered_at = NOW()
             WHERE id = $2
             RETURNING id, employee_id, first_name, last_name, face_registered_at`,
            [JSON.stringify(descriptorData), userId]
        );

        await createAuditLog(req.user.id, 'UPDATE', 'users', userId,
            null, { action: 'face_registered_by_admin' }, 'Face registered by admin/HR', req.ip);

        res.json({
            success: true,
            message: 'Face registered successfully',
            data: result.rows[0]
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
        const userResult = await query(
            'SELECT face_descriptor FROM users WHERE id = $1 AND face_registered_at IS NOT NULL',
            [req.user.id]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].face_descriptor) {
            return res.status(400).json({
                success: false,
                error: 'No registered face found. Please register your face first.'
            });
        }

        const storedFaceData = userResult.rows[0].face_descriptor;
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
        const result = await query(
            'SELECT face_registered_at FROM users WHERE id = $1',
            [req.user.id]
        );

        res.json({
            success: true,
            data: {
                is_registered: !!result.rows[0]?.face_registered_at,
                registered_at: result.rows[0]?.face_registered_at
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

        const result = await query(
            `SELECT id, employee_id, first_name, last_name, face_registered_at
             FROM users WHERE id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                ...result.rows[0],
                is_registered: !!result.rows[0].face_registered_at
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

        const result = await query(
            `UPDATE users 
             SET face_descriptor = NULL, face_registered_at = NULL
             WHERE id = $1
             RETURNING id, employee_id`,
            [userId]
        );

        if (result.rows.length === 0) {
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

        let queryText = `
            SELECT id, employee_id, first_name, last_name, email, 
                   department_id, face_registered_at
            FROM users WHERE status = 'ACTIVE'
        `;

        if (registered === 'true') {
            queryText += ` AND face_registered_at IS NOT NULL`;
        } else if (registered === 'false') {
            queryText += ` AND face_registered_at IS NULL`;
        }

        queryText += ` ORDER BY first_name`;

        const result = await query(queryText);

        res.json({
            success: true,
            data: result.rows.map(u => ({
                ...u,
                full_name: `${u.first_name} ${u.last_name}`,
                is_registered: !!u.face_registered_at
            })),
            summary: {
                total: result.rows.length,
                registered: result.rows.filter(u => u.face_registered_at).length,
                not_registered: result.rows.filter(u => !u.face_registered_at).length
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
