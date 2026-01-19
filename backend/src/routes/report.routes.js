const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const prisma = require('../config/prisma');
const { authenticate, authorize, isHROrAdmin } = require('../middleware/auth');

// Middleware to allow ADMIN, HR, GM, or MANAGER for reports
const canAccessReports = authorize('ADMIN', 'HR', 'GM', 'MANAGER');

// Get attendance report
router.get('/attendance', authenticate, canAccessReports, async (req, res, next) => {
    try {
        const { start_date, end_date, department_id, user_id, format } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                error: 'Start date and end date are required'
            });
        }

        let whereClause = {
            date: {
                gte: new Date(start_date),
                lte: new Date(end_date)
            }
        };

        // Manager can only see their department's reports
        if (req.user.role === 'MANAGER') {
            whereClause.user = { departmentId: req.user.department_id };
        } else if (department_id) {
            whereClause.user = { departmentId: department_id };
        }

        if (user_id) {
            whereClause.userId = user_id;
        }

        const records = await prisma.attendanceRecord.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        employeeId: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        department: { select: { name: true } }
                    }
                },
                shift: { select: { name: true } }
            },
            orderBy: [{ date: 'asc' }, { user: { firstName: 'asc' } }]
        });

        // Generate summary
        const summary = {
            total_records: records.length,
            present: records.filter(r => r.status === 'PRESENT').length,
            absent: records.filter(r => r.status === 'ABSENT').length,
            late: records.filter(r => r.status === 'LATE').length,
            half_day: records.filter(r => r.status === 'HALF_DAY').length,
            on_leave: records.filter(r => r.status === 'ON_LEAVE').length,
            total_hours: records.reduce((sum, r) => sum + (parseFloat(r.totalHours) || 0), 0),
            overtime_hours: records.reduce((sum, r) => sum + (parseFloat(r.overtimeHours) || 0), 0)
        };

        const data = records.map(r => ({
            date: r.date,
            check_in_time: r.checkInTime,
            check_out_time: r.checkOutTime,
            status: r.status,
            total_hours: r.totalHours,
            overtime_hours: r.overtimeHours,
            is_manual_entry: r.isManualEntry,
            employee_id: r.user.employeeId,
            first_name: r.user.firstName,
            last_name: r.user.lastName,
            email: r.user.email,
            department_name: r.user.department?.name,
            shift_name: r.shift?.name,
            employee_name: `${r.user.firstName} ${r.user.lastName}`
        }));

        if (format === 'excel') {
            return generateExcelReport(res, data, 'Attendance Report', start_date, end_date);
        }

        if (format === 'pdf') {
            return generatePDFReport(res, data, 'Attendance Report', start_date, end_date);
        }

        res.json({
            success: true,
            data: {
                records: data,
                summary,
                period: { start_date, end_date }
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get leave report
router.get('/leaves', authenticate, canAccessReports, async (req, res, next) => {
    try {
        const { start_date, end_date, department_id, leave_type, status, format } = req.query;

        let whereClause = {};

        // Manager can only see their department's leave reports
        if (req.user.role === 'MANAGER') {
            whereClause.user = { departmentId: req.user.department_id };
        } else if (department_id) {
            whereClause.user = { departmentId: department_id };
        }

        if (start_date) whereClause.startDate = { gte: new Date(start_date) };
        if (end_date) whereClause.endDate = { lte: new Date(end_date) };
        if (leave_type) whereClause.leaveType = leave_type;
        if (status) whereClause.status = status;

        const records = await prisma.leaveRequest.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        employeeId: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        department: { select: { name: true } }
                    }
                },
                approvedBy: {
                    select: { firstName: true, lastName: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Generate summary
        const summary = {
            total_requests: records.length,
            pending: records.filter(r => r.status === 'PENDING').length,
            approved: records.filter(r => r.status === 'APPROVED').length,
            rejected: records.filter(r => r.status === 'REJECTED').length,
            total_days: records.reduce((sum, r) => sum + r.totalDays, 0)
        };

        const data = records.map(r => ({
            id: r.id,
            leave_type: r.leaveType,
            start_date: r.startDate,
            end_date: r.endDate,
            total_days: r.totalDays,
            reason: r.reason,
            status: r.status,
            created_at: r.createdAt,
            employee_id: r.user.employeeId,
            first_name: r.user.firstName,
            last_name: r.user.lastName,
            email: r.user.email,
            department_name: r.user.department?.name,
            approved_by_name: r.approvedBy ? `${r.approvedBy.firstName} ${r.approvedBy.lastName}` : null,
            employee_name: `${r.user.firstName} ${r.user.lastName}`
        }));

        if (format === 'excel') {
            return generateLeaveExcelReport(res, data, start_date, end_date);
        }

        res.json({
            success: true,
            data: {
                records: data,
                summary
            }
        });
    } catch (error) {
        next(error);
    }
});

// Get employee summary report
router.get('/employee-summary', authenticate, canAccessReports, async (req, res, next) => {
    try {
        const { month, year, department_id } = req.query;
        const targetMonth = parseInt(month) || new Date().getMonth() + 1;
        const targetYear = parseInt(year) || new Date().getFullYear();

        // Calculate date range for the month
        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0);

        let userWhereClause = { status: 'ACTIVE' };

        // Manager can only see their department's employee summary
        if (req.user.role === 'MANAGER') {
            userWhereClause.departmentId = req.user.department_id;
        } else if (department_id) {
            userWhereClause.departmentId = department_id;
        }

        const users = await prisma.user.findMany({
            where: userWhereClause,
            include: {
                department: { select: { name: true } },
                shift: { select: { name: true } },
                attendanceRecords: {
                    where: {
                        date: { gte: startDate, lte: endDate }
                    }
                },
                leaveBalances: {
                    where: { year: targetYear }
                }
            },
            orderBy: { firstName: 'asc' }
        });

        const data = users.map(u => {
            const records = u.attendanceRecords;
            const balance = u.leaveBalances[0];

            return {
                id: u.id,
                employee_id: u.employeeId,
                first_name: u.firstName,
                last_name: u.lastName,
                email: u.email,
                department_name: u.department?.name,
                shift_name: u.shift?.name,
                present_days: records.filter(r => r.status === 'PRESENT').length,
                absent_days: records.filter(r => r.status === 'ABSENT').length,
                late_days: records.filter(r => r.status === 'LATE').length,
                half_days: records.filter(r => r.status === 'HALF_DAY').length,
                leave_days: records.filter(r => r.status === 'ON_LEAVE').length,
                total_hours: records.reduce((sum, r) => sum + (parseFloat(r.totalHours) || 0), 0),
                overtime_hours: records.reduce((sum, r) => sum + (parseFloat(r.overtimeHours) || 0), 0),
                full_name: `${u.firstName} ${u.lastName}`,
                leave_balance: balance ? {
                    casual_used: balance.casualUsed,
                    sick_used: balance.sickUsed,
                    paid_used: balance.paidUsed,
                    unpaid_used: balance.unpaidUsed
                } : null
            };
        });

        res.json({
            success: true,
            data,
            period: { month: targetMonth, year: targetYear }
        });
    } catch (error) {
        next(error);
    }
});

// Get daily attendance report
router.get('/daily', authenticate, canAccessReports, async (req, res, next) => {
    try {
        const { date, department_id } = req.query;
        const targetDate = date ? new Date(date) : new Date();
        targetDate.setHours(0, 0, 0, 0);

        let userWhereClause = { status: 'ACTIVE' };

        // Manager can only see their department's daily report
        if (req.user.role === 'MANAGER') {
            userWhereClause.departmentId = req.user.department_id;
        } else if (department_id) {
            userWhereClause.departmentId = department_id;
        }

        const users = await prisma.user.findMany({
            where: userWhereClause,
            include: {
                department: { select: { name: true } },
                shift: {
                    select: { name: true, startTime: true, endTime: true }
                },
                attendanceRecords: {
                    where: { date: targetDate }
                }
            },
            orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }]
        });

        const data = users.map(u => {
            const record = u.attendanceRecords[0];
            return {
                id: u.id,
                employee_id: u.employeeId,
                first_name: u.firstName,
                last_name: u.lastName,
                email: u.email,
                department_name: u.department?.name,
                shift_name: u.shift?.name,
                shift_start: u.shift?.startTime,
                shift_end: u.shift?.endTime,
                check_in_time: record?.checkInTime,
                check_out_time: record?.checkOutTime,
                status: record?.status || 'NOT_MARKED',
                total_hours: record?.totalHours,
                is_face_verified: record?.isFaceVerified,
                is_manual_entry: record?.isManualEntry,
                full_name: `${u.firstName} ${u.lastName}`
            };
        });

        // Calculate summary
        const summary = {
            total_employees: data.length,
            present: data.filter(r => r.status === 'PRESENT').length,
            absent: data.filter(r => r.status === 'NOT_MARKED' || r.status === 'ABSENT').length,
            late: data.filter(r => r.status === 'LATE').length,
            half_day: data.filter(r => r.status === 'HALF_DAY').length,
            on_leave: data.filter(r => r.status === 'ON_LEAVE').length,
            not_checked_in: data.filter(r => !r.check_in_time).length
        };

        res.json({
            success: true,
            data: {
                records: data,
                summary,
                date: targetDate.toISOString().split('T')[0]
            }
        });
    } catch (error) {
        next(error);
    }
});

// Generate Excel report helper function
async function generateExcelReport(res, data, title, startDate, endDate) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Attendance Report');

    // Header
    worksheet.mergeCells('A1:K1');
    worksheet.getCell('A1').value = `${title} - ${startDate} to ${endDate}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Column headers
    worksheet.addRow([]);
    worksheet.addRow([
        'Date', 'Employee ID', 'Employee Name', 'Department', 'Shift',
        'Check In', 'Check Out', 'Status', 'Total Hours', 'Overtime', 'Manual Entry'
    ]);

    const headerRow = worksheet.getRow(3);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Data rows
    data.forEach(record => {
        worksheet.addRow([
            record.date,
            record.employee_id,
            `${record.first_name} ${record.last_name}`,
            record.department_name || '-',
            record.shift_name || '-',
            record.check_in_time ? new Date(record.check_in_time).toLocaleTimeString() : '-',
            record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : '-',
            record.status,
            record.total_hours || 0,
            record.overtime_hours || 0,
            record.is_manual_entry ? 'Yes' : 'No'
        ]);
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
        column.width = 15;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${startDate}_${endDate}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
}

// Generate leave Excel report
async function generateLeaveExcelReport(res, data, startDate, endDate) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leave Report');

    worksheet.mergeCells('A1:J1');
    worksheet.getCell('A1').value = `Leave Report - ${startDate || 'All Time'} to ${endDate || 'Present'}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };

    worksheet.addRow([]);
    worksheet.addRow([
        'Employee ID', 'Employee Name', 'Department', 'Leave Type',
        'Start Date', 'End Date', 'Days', 'Status', 'Reason', 'Approved By'
    ]);

    const headerRow = worksheet.getRow(3);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };

    data.forEach(record => {
        worksheet.addRow([
            record.employee_id,
            `${record.first_name} ${record.last_name}`,
            record.department_name || '-',
            record.leave_type,
            record.start_date,
            record.end_date,
            record.total_days,
            record.status,
            record.reason,
            record.approved_by_name || '-'
        ]);
    });

    worksheet.columns.forEach(column => {
        column.width = 15;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=leave_report.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
}

// Generate PDF report
function generatePDFReport(res, data, title, startDate, endDate) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${startDate}_${endDate}.pdf`);

    doc.pipe(res);

    // Title
    doc.fontSize(18).text(title, { align: 'center' });
    doc.fontSize(12).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
    doc.moveDown();

    // Table headers
    const headers = ['Date', 'Employee', 'Department', 'Check In', 'Check Out', 'Status', 'Hours'];
    const colWidths = [80, 120, 100, 80, 80, 80, 60];
    let y = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    headers.forEach((header, i) => {
        let x = 30 + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(header, x, y, { width: colWidths[i] });
    });

    doc.moveDown();
    doc.font('Helvetica');

    // Table data
    data.slice(0, 30).forEach(record => { // Limit to 30 records for PDF
        y = doc.y;
        if (y > 500) {
            doc.addPage();
            y = 30;
        }

        const row = [
            record.date instanceof Date ? record.date.toISOString().split('T')[0] : record.date,
            `${record.first_name} ${record.last_name}`,
            record.department_name || '-',
            record.check_in_time ? new Date(record.check_in_time).toLocaleTimeString() : '-',
            record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : '-',
            record.status,
            record.total_hours?.toString() || '0'
        ];

        row.forEach((cell, i) => {
            let x = 30 + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
            doc.text(cell, x, y, { width: colWidths[i] });
        });
        doc.moveDown(0.5);
    });

    doc.end();
}

module.exports = router;
