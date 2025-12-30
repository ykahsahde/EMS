const errorHandler = (err, req, res, next) => {
    console.error('Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    // Validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: err.details || err.message
        });
    }

    // Duplicate key error (PostgreSQL)
    if (err.code === '23505') {
        return res.status(409).json({
            success: false,
            error: 'Duplicate entry',
            details: 'A record with this information already exists'
        });
    }

    // Foreign key violation
    if (err.code === '23503') {
        return res.status(400).json({
            success: false,
            error: 'Reference error',
            details: 'Referenced record does not exist'
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            error: 'Invalid token'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            error: 'Token expired'
        });
    }

    // File upload errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            error: 'File too large',
            details: 'Maximum file size is 5MB'
        });
    }

    // Default server error
    const statusCode = err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;

    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
};

module.exports = errorHandler;
