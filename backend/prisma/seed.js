const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log(' Starting database seeding...\n');


  console.log(' Seeding Departments...');

  const departments = [
    { name: 'Administration', code: 'ADMIN', description: 'Administrative and executive management' },
    { name: 'Human Resources', code: 'HR', description: 'HR, recruitment, and employee welfare' },
    { name: 'Information Technology', code: 'IT', description: 'IT infrastructure and software development' },
    { name: 'Production', code: 'PROD', description: 'Manufacturing and production operations' },
    { name: 'Quality Control', code: 'QC', description: 'Quality assurance and control' },
    { name: 'Sales & Marketing', code: 'SALES', description: 'Sales, marketing, and business development' },
    { name: 'Finance', code: 'FIN', description: 'Finance, accounting, and audit' },
    { name: 'Warehouse', code: 'WH', description: 'Warehouse and inventory management' },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: { code: dept.code },
      update: {},
      create: dept,
    });
  }
  console.log(` ${departments.length} departments seeded\n`);

  // =====================================================
  // 2. SEED SHIFTS
  // =====================================================
  console.log('Seeding Shifts...');

  const shifts = [
    {
      name: 'Day Shift',
      code: 'DAY',
      shiftType: 'DAY',
      startTime: new Date('1970-01-01T09:00:00'),
      endTime: new Date('1970-01-01T18:00:00'),
      gracePeriodMinutes: 15,
      halfDayHours: 4.0,
      fullDayHours: 8.0,
    },
    {
      name: 'Night Shift',
      code: 'NIGHT',
      shiftType: 'NIGHT',
      startTime: new Date('1970-01-01T21:00:00'),
      endTime: new Date('1970-01-01T06:00:00'),
      gracePeriodMinutes: 15,
      halfDayHours: 4.0,
      fullDayHours: 8.0,
    },
    {
      name: 'Rotational Shift',
      code: 'ROTATIONAL',
      shiftType: 'ROTATIONAL',
      startTime: new Date('1970-01-01T06:00:00'),
      endTime: new Date('1970-01-01T14:00:00'),
      gracePeriodMinutes: 10,
      halfDayHours: 4.0,
      fullDayHours: 8.0,
    },
    {
      name: 'Flexible Shift',
      code: 'FLEXIBLE',
      shiftType: 'FLEXIBLE',
      startTime: new Date('1970-01-01T08:00:00'),
      endTime: new Date('1970-01-01T20:00:00'),
      gracePeriodMinutes: 30,
      halfDayHours: 4.0,
      fullDayHours: 8.0,
    },
  ];

  for (const shift of shifts) {
    await prisma.shift.upsert({
      where: { code: shift.code },
      update: {},
      create: shift,
    });
  }
  console.log(`    ${shifts.length} shifts seeded\n`);

  // Get department and shift IDs for user creation
  const adminDept = await prisma.department.findUnique({ where: { code: 'ADMIN' } });
  const hrDept = await prisma.department.findUnique({ where: { code: 'HR' } });
  const itDept = await prisma.department.findUnique({ where: { code: 'IT' } });
  const prodDept = await prisma.department.findUnique({ where: { code: 'PROD' } });
  const dayShift = await prisma.shift.findUnique({ where: { code: 'DAY' } });

  // =====================================================
  // 3. SEED DEFAULT USERS
  // =====================================================
  console.log(' Seeding Users...');

  const defaultPassword = await bcrypt.hash('Admin@123', 12);
  const gmPassword = await bcrypt.hash('Gm@12345', 12);

  const users = [
    {
      employeeId: 'RLL0001',
      email: 'admin@raymond.in',
      passwordHash: defaultPassword,
      firstName: 'System',
      lastName: 'Administrator',
      phone: '+91-9876543210',
      role: 'ADMIN',
      status: 'ACTIVE',
      departmentId: itDept?.id,
      shiftId: dayShift?.id,
      dateOfJoining: new Date('2020-01-01'),
    },
    {
      employeeId: 'RLL0002',
      email: 'hr@raymond.in',
      passwordHash: defaultPassword,
      firstName: 'HR',
      lastName: 'Manager',
      phone: '+91-9876543211',
      role: 'HR',
      status: 'ACTIVE',
      departmentId: hrDept?.id,
      shiftId: dayShift?.id,
      dateOfJoining: new Date('2020-01-15'),
    },
    {
      employeeId: 'RLL0003',
      email: 'manager@raymond.in',
      passwordHash: defaultPassword,
      firstName: 'Production',
      lastName: 'Manager',
      phone: '+91-9876543212',
      role: 'MANAGER',
      status: 'ACTIVE',
      departmentId: prodDept?.id,
      shiftId: dayShift?.id,
      dateOfJoining: new Date('2020-02-01'),
    },
    {
      employeeId: 'RLL0004',
      email: 'employee@raymond.in',
      passwordHash: defaultPassword,
      firstName: 'John',
      lastName: 'Employee',
      phone: '+91-9876543213',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      departmentId: prodDept?.id,
      shiftId: dayShift?.id,
      dateOfJoining: new Date('2021-01-01'),
    },
    {
      employeeId: 'RLL0005',
      email: 'gm@raymond.com',
      passwordHash: gmPassword,
      firstName: 'Vikram',
      lastName: 'Singhania',
      phone: '+91-9876543214',
      role: 'GM',
      status: 'ACTIVE',
      departmentId: adminDept?.id,
      shiftId: dayShift?.id,
      dateOfJoining: new Date('2020-01-01'),
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user,
    });
  }
  console.log(`    ${users.length} users seeded\n`);


  console.log('Seeding Holidays...');

  const holidays = [
    // 2025 Holidays
    { name: "New Year's Eve", date: new Date('2025-12-31'), year: 2025, isOptional: true },

    // 2026 Holidays
    { name: 'New Year', date: new Date('2026-01-01'), year: 2026, isOptional: false },
    { name: 'Republic Day', date: new Date('2026-01-26'), year: 2026, isOptional: false },
    { name: 'Maha Shivaratri', date: new Date('2026-02-15'), year: 2026, isOptional: true },
    { name: 'Holi', date: new Date('2026-03-03'), year: 2026, isOptional: false },
    { name: 'Good Friday', date: new Date('2026-04-03'), year: 2026, isOptional: true },
    { name: 'Ram Navami', date: new Date('2026-04-06'), year: 2026, isOptional: true },
    { name: 'Ambedkar Jayanti', date: new Date('2026-04-14'), year: 2026, isOptional: false },
    { name: 'Mahavir Jayanti', date: new Date('2026-04-14'), year: 2026, isOptional: true },
    { name: 'May Day', date: new Date('2026-05-01'), year: 2026, isOptional: false },
    { name: 'Buddha Purnima', date: new Date('2026-05-12'), year: 2026, isOptional: true },
    { name: 'Eid ul-Adha', date: new Date('2026-07-07'), year: 2026, isOptional: true },
    { name: 'Muharram', date: new Date('2026-08-06'), year: 2026, isOptional: true },
    { name: 'Independence Day', date: new Date('2026-08-15'), year: 2026, isOptional: false },
    { name: 'Raksha Bandhan', date: new Date('2026-08-22'), year: 2026, isOptional: true },
    { name: 'Janmashtami', date: new Date('2026-09-04'), year: 2026, isOptional: true },
    { name: 'Gandhi Jayanti', date: new Date('2026-10-02'), year: 2026, isOptional: false },
    { name: 'Dussehra', date: new Date('2026-10-19'), year: 2026, isOptional: false },
    { name: 'Diwali', date: new Date('2026-11-08'), year: 2026, isOptional: false },
    { name: 'Guru Nanak Jayanti', date: new Date('2026-11-19'), year: 2026, isOptional: true },
    { name: 'Christmas', date: new Date('2026-12-25'), year: 2026, isOptional: false },
  ];

  let holidayCount = 0;
  for (const holiday of holidays) {
    try {
      await prisma.holiday.upsert({
        where: { date: holiday.date },
        update: {},
        create: holiday,
      });
      holidayCount++;
    } catch (error) {
      // Skip duplicates silently
      if (!error.message.includes('Unique constraint')) {
        console.log(`    Skipped duplicate: ${holiday.name}`);
      }
    }
  }
  console.log(`    ${holidayCount} holidays seeded\n`);


  console.log(' Seeding Leave Balances for 2026...');

  const allUsers = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  let leaveBalanceCount = 0;
  for (const user of allUsers) {
    try {
      await prisma.leaveBalance.upsert({
        where: {
          userId_year: {
            userId: user.id,
            year: 2026,
          },
        },
        update: {},
        create: {
          userId: user.id,
          year: 2026,
          casualTotal: 12,
          casualUsed: 0,
          sickTotal: 12,
          sickUsed: 0,
          paidTotal: 15,
          paidUsed: 0,
        },
      });
      leaveBalanceCount++;
    } catch (error) {

    }
  }
  console.log(`    ${leaveBalanceCount} leave balances seeded\n`);


  console.log('Seeding Attendance Config...');

  const configs = [
    { configKey: 'face_recognition_threshold', configValue: '0.6', description: 'Minimum face match score (0.0 to 1.0)', dataType: 'float' },
    { configKey: 'auto_checkout_enabled', configValue: 'true', description: 'Enable automatic checkout at end of shift', dataType: 'boolean' },
    { configKey: 'late_threshold_minutes', configValue: '15', description: 'Minutes after shift start to mark as late', dataType: 'integer' },
    { configKey: 'half_day_threshold_hours', configValue: '4', description: 'Minimum hours for half day attendance', dataType: 'integer' },
    { configKey: 'overtime_threshold_minutes', configValue: '30', description: 'Minutes after shift end to count overtime', dataType: 'integer' },
    { configKey: 'allow_manual_attendance', configValue: 'true', description: 'Allow HR/Admin to add manual attendance', dataType: 'boolean' },
    { configKey: 'require_face_verification', configValue: 'true', description: 'Require face verification for attendance', dataType: 'boolean' },
    { configKey: 'attendance_lock_day', configValue: '5', description: 'Day of month when previous month attendance is locked', dataType: 'integer' },
  ];

  for (const config of configs) {
    await prisma.attendanceConfig.upsert({
      where: { configKey: config.configKey },
      update: {},
      create: config,
    });
  }
  console.log(`    ${configs.length} config entries seeded\n`);

  console.log(' Database seeding completed successfully!\n');
  console.log(' Default Credentials:');
  console.log('   Admin:    admin@raymond.in / Admin@123');
  console.log('   HR:       hr@raymond.in / Admin@123');
  console.log('   Manager:  manager@raymond.in / Admin@123');
  console.log('   Employee: employee@raymond.in / Admin@123');
  console.log('   GM:       gm@raymond.com / Gm@12345');
}

main()
  .catch((e) => {
    console.error(' Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
