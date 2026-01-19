const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// Test connection
prisma.$connect()
    .then(() => {
        console.log('Prisma connected to database successfully');
    })
    .catch((error) => {
        console.error('Prisma database connection error:', error);
    });

module.exports = prisma;
