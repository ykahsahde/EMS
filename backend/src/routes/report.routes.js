const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { query } = require('../config/database');
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

        let queryText = `
            SELECT ar.date, ar.check_in_time, ar.check_out_time, ar.status, 
                   ar.total_hours, ar.overtime_hours, ar.is_manual_entry,
                   u.employee_id, u.first_name, u.last_name, u.email,
                   d.name as department_name, s.name as shift_name
            FROM attendance_records ar
            JOIN users u ON ar.user_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN shifts s ON ar.shift_id = s.id
            WHERE ar.date >= $1 AND ar.date <= $2
        `;
        const params = [start_date, end_date];
        let paramCount = 2;

        // Manager can only see their department's reports
        if (req.user.role === 'MANAGER') {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(req.user.department_id);
        } else if (department_id) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        if (user_id) {
            paramCount++;
            queryText += ` AND ar.user_id = $${paramCount}`;
            params.push(user_id);
        }

        queryText += ` ORDER BY ar.date, u.first_name`;

        const result = await query(queryText, params);

        // Generate summary
        const summary = {
            total_records: result.rows.length,
            present: result.rows.filter(r => r.status === 'PRESENT').length,
            absent: result.rows.filter(r => r.status === 'ABSENT').length,
            late: result.rows.filter(r => r.status === 'LATE').length,
            half_day: result.rows.filter(r => r.status === 'HALF_DAY').length,
            on_leave: result.rows.filter(r => r.status === 'ON_LEAVE').length,
            total_hours: result.rows.reduce((sum, r) => sum + (parseFloat(r.total_hours) || 0), 0),
            overtime_hours: result.rows.reduce((sum, r) => sum + (parseFloat(r.overtime_hours) || 0), 0)
        };

        if (format === 'excel') {
            return generateExcelReport(res, result.rows, 'Attendance Report', start_date, end_date);
        }

        if (format === 'pdf') {
            return generatePDFReport(res, result.rows, 'Attendance Report', start_date, end_date);
        }

        res.json({
            success: true,
            data: {
                records: result.rows.map(r => ({
                    ...r,
                    employee_name: `${r.first_name} ${r.last_name}`
                })),
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

        let queryText = `
            SELECT lr.*, 
                   u.employee_id, u.first_name, u.last_name, u.email,
                   d.name as department_name,
                   approver.first_name || ' ' || approver.last_name as approved_by_name
            FROM leave_requests lr
            JOIN users u ON lr.user_id = u.id
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN users approver ON lr.approved_by = approver.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        // Manager can only see their department's leave reports
        if (req.user.role === 'MANAGER') {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(req.user.department_id);
        } else if (department_id) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        if (start_date) {
            paramCount++;
            queryText += ` AND lr.start_date >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            queryText += ` AND lr.end_date <= $${paramCount}`;
            params.push(end_date);
        }

        if (leave_type) {
            paramCount++;
            queryText += ` AND lr.leave_type = $${paramCount}`;
            params.push(leave_type);
        }

        if (status) {
            paramCount++;
            queryText += ` AND lr.status = $${paramCount}`;
            params.push(status);
        }

        queryText += ` ORDER BY lr.created_at DESC`;

        const result = await query(queryText, params);

        // Generate summary
        const summary = {
            total_requests: result.rows.length,
            pending: result.rows.filter(r => r.status === 'PENDING').length,
            approved: result.rows.filter(r => r.status === 'APPROVED').length,
            rejected: result.rows.filter(r => r.status === 'REJECTED').length,
            total_days: result.rows.reduce((sum, r) => sum + r.total_days, 0)
        };

        if (format === 'excel') {
            return generateLeaveExcelReport(res, result.rows, start_date, end_date);
        }

        res.json({
            success: true,
            data: {
                records: result.rows.map(r => ({
                    ...r,
                    employee_name: `${r.first_name} ${r.last_name}`
                })),
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
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();

        let queryText = `
            SELECT 
                u.id, u.employee_id, u.first_name, u.last_name, u.email,
                d.name as department_name, s.name as shift_name,
                COUNT(CASE WHEN ar.status = 'PRESENT' THEN 1 END) as present_days,
                COUNT(CASE WHEN ar.status = 'ABSENT' THEN 1 END) as absent_days,
                COUNT(CASE WHEN ar.status = 'LATE' THEN 1 END) as late_days,
                COUNT(CASE WHEN ar.status = 'HALF_DAY' THEN 1 END) as half_days,
                COUNT(CASE WHEN ar.status = 'ON_LEAVE' THEN 1 END) as leave_days,
                COALESCE(SUM(ar.total_hours), 0) as total_hours,
                COALESCE(SUM(ar.overtime_hours), 0) as overtime_hours
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN shifts s ON u.shift_id = s.id
            LEFT JOIN attendance_records ar ON u.id = ar.user_id 
                AND EXTRACT(MONTH FROM ar.date) = $1
                AND EXTRACT(YEAR FROM ar.date) = $2
            WHERE u.status = 'ACTIVE'
        `;
        const params = [targetMonth, targetYear];
        let paramCount = 2;

        // Manager can only see their department's employee summary
        if (req.user.role === 'MANAGER') {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(req.user.department_id);
        } else if (department_id) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        queryText += ` GROUP BY u.id, u.employee_id, u.first_name, u.last_name, u.email, d.name, s.name
                       ORDER BY u.first_name`;

        const result = await query(queryText, params);

        // Get leave balances
        const leaveResult = await query(
            `SELECT user_id, casual_used, sick_used, paid_used, unpaid_used
             FROM leave_balances WHERE year = $1`,
            [targetYear]
        );

        const leaveMap = {};
        leaveResult.rows.forEach(lb => {
            leaveMap[lb.user_id] = lb;
        });

        res.json({
            success: true,
            data: result.rows.map(r => ({
                ...r,
                full_name: `${r.first_name} ${r.last_name}`,
                leave_balance: leaveMap[r.id] || null
            })),
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
        const targetDate = date || new Date().toISOString().split('T')[0];

        let queryText = `
            SELECT 
                u.id, u.employee_id, u.first_name, u.last_name, u.email,
                d.name as department_name, s.name as shift_name,
                s.start_time as shift_start, s.end_time as shift_end,
                ar.check_in_time, ar.check_out_time, ar.status, ar.total_hours,
                ar.is_face_verified, ar.is_manual_entry
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            LEFT JOIN shifts s ON u.shift_id = s.id
            LEFT JOIN attendance_records ar ON u.id = ar.user_id AND ar.date = $1
            WHERE u.status = 'ACTIVE'
        `;
        const params = [targetDate];
        let paramCount = 1;

        // Manager can only see their department's daily report
        if (req.user.role === 'MANAGER') {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(req.user.department_id);
        } else if (department_id) {
            paramCount++;
            queryText += ` AND u.department_id = $${paramCount}`;
            params.push(department_id);
        }

        queryText += ` ORDER BY d.name, u.first_name`;

        const result = await query(queryText, params);

        // Calculate summary
        const summary = {
            total_employees: result.rows.length,
            present: result.rows.filter(r => r.status === 'PRESENT').length,
            absent: result.rows.filter(r => !r.status || r.status === 'ABSENT').length,
            late: result.rows.filter(r => r.status === 'LATE').length,
            half_day: result.rows.filter(r => r.status === 'HALF_DAY').length,
            on_leave: result.rows.filter(r => r.status === 'ON_LEAVE').length,
            not_checked_in: result.rows.filter(r => !r.check_in_time).length
        };

        res.json({
            success: true,
            data: {
                records: result.rows.map(r => ({
                    ...r,
                    full_name: `${r.first_name} ${r.last_name}`,
                    status: r.status || 'NOT_MARKED'
                })),
                summary,
                date: targetDate
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
            record.date,
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
