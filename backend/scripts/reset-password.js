/**
 * Password Reset Utility Script
 * Usage: node scripts/reset-password.js <email> <new_password>
 * Example: node scripts/reset-password.js dishant.sevake@raymond.com NewPass@123
 */

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetPassword(email, newPassword) {
  try {
    // Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      console.log('\n❌ Password must contain:');
      console.log('   - At least 8 characters');
      console.log('   - One uppercase letter');
      console.log('   - One lowercase letter');
      console.log('   - One number');
      console.log('   - One special character (@$!%*?&)');
      process.exit(1);
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, lastName: true, role: true }
    });

    if (!user) {
      console.log(`\n❌ User with email "${email}" not found!`);
      
      // Show available users
      console.log('\n📋 Available users:');
      const users = await prisma.user.findMany({
        select: { email: true, firstName: true, lastName: true, role: true },
        orderBy: { email: 'asc' }
      });
      users.forEach(u => {
        console.log(`   - ${u.email} (${u.firstName} ${u.lastName} - ${u.role})`);
      });
      process.exit(1);
    }

    // Hash new password
    const hash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { email },
      data: { 
        passwordHash: hash,
        passwordChangedAt: new Date()
      }
    });

    console.log('\n✅ Password Reset Successful!');
    console.log('─'.repeat(40));
    console.log(`   User:     ${user.firstName} ${user.lastName}`);
    console.log(`   Email:    ${user.email}`);
    console.log(`   Role:     ${user.role}`);
    console.log(`   Password: ${newPassword}`);
    console.log('─'.repeat(40));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function listUsers() {
  try {
    console.log('\n📋 All Users in Database:');
    console.log('─'.repeat(70));
    
    const users = await prisma.user.findMany({
      select: { 
        employeeId: true,
        email: true, 
        firstName: true, 
        lastName: true, 
        role: true,
        status: true
      },
      orderBy: { email: 'asc' }
    });

    console.log('Employee ID  | Email                          | Name                | Role     | Status');
    console.log('─'.repeat(70));
    
    users.forEach(u => {
      const empId = u.employeeId.padEnd(11);
      const email = u.email.padEnd(30);
      const name = `${u.firstName} ${u.lastName}`.padEnd(19);
      const role = u.role.padEnd(8);
      console.log(`${empId} | ${email} | ${name} | ${role} | ${u.status}`);
    });

    console.log('─'.repeat(70));
    console.log(`Total: ${users.length} users\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function resetAllToDefault() {
  try {
    const defaultPassword = 'Admin@123';
    const hash = await bcrypt.hash(defaultPassword, 12);

    const result = await prisma.user.updateMany({
      data: { 
        passwordHash: hash,
        passwordChangedAt: new Date()
      }
    });

    console.log(`\n✅ Reset ${result.count} users to default password: ${defaultPassword}\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Password Reset Utility                           ║
╚════════════════════════════════════════════════════════════╝

Usage:
  node scripts/reset-password.js <email> <new_password>
  node scripts/reset-password.js --list
  node scripts/reset-password.js --reset-all

Options:
  --list, -l       List all users
  --reset-all      Reset ALL users to default password (Admin@123)
  --help, -h       Show this help

Examples:
  node scripts/reset-password.js dishant.sevake@raymond.com NewPass@123
  node scripts/reset-password.js admin@raymond.com Admin@123
  node scripts/reset-password.js --list
`);
  process.exit(0);
}

if (args[0] === '--list' || args[0] === '-l') {
  listUsers();
} else if (args[0] === '--reset-all') {
  console.log('\n⚠️  WARNING: This will reset ALL user passwords to Admin@123');
  resetAllToDefault();
} else if (args.length === 2) {
  resetPassword(args[0], args[1]);
} else {
  console.log('❌ Invalid arguments. Use --help for usage.');
}
