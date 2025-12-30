
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- ENUM TYPES
-- =====================================================

CREATE TYPE user_role AS ENUM ('ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE attendance_status AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY');
CREATE TYPE leave_type AS ENUM ('CASUAL', 'SICK', 'PAID', 'UNPAID', 'MATERNITY', 'PATERNITY');
CREATE TYPE leave_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE shift_type AS ENUM ('DAY', 'NIGHT', 'ROTATIONAL', 'FLEXIBLE');
CREATE TYPE audit_action AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ATTENDANCE_EDIT');

-- =====================================================
-- TABLES
-- =====================================================

-- Departments Table
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL UNIQUE,
    description TEXT,
    head_id UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Shifts Table
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    shift_type shift_type NOT NULL DEFAULT 'DAY',
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    grace_period_minutes INTEGER DEFAULT 15,
    half_day_hours DECIMAL(4,2) DEFAULT 4.0,
    full_day_hours DECIMAL(4,2) DEFAULT 8.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users/Employees Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role user_role NOT NULL DEFAULT 'EMPLOYEE',
    status user_status NOT NULL DEFAULT 'ACTIVE',
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    date_of_joining DATE NOT NULL,
    date_of_birth DATE,
    address TEXT,
    emergency_contact VARCHAR(20),
    profile_picture_url TEXT,
    face_descriptor JSONB,
    face_registered_at TIMESTAMP WITH TIME ZONE,
    last_login TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Add foreign key for department head after users table exists
ALTER TABLE departments ADD CONSTRAINT fk_department_head 
    FOREIGN KEY (head_id) REFERENCES users(id) ON DELETE SET NULL;

-- Attendance Records Table
CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_out_time TIMESTAMP WITH TIME ZONE,
    status attendance_status NOT NULL DEFAULT 'ABSENT',
    shift_id UUID REFERENCES shifts(id),
    total_hours DECIMAL(5,2),
    overtime_hours DECIMAL(5,2) DEFAULT 0,
    is_face_verified BOOLEAN DEFAULT FALSE,
    face_verification_score DECIMAL(5,4),
    check_in_location JSONB,
    check_out_location JSONB,
    is_manual_entry BOOLEAN DEFAULT FALSE,
    manual_entry_by UUID REFERENCES users(id),
    is_locked BOOLEAN DEFAULT FALSE,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_user_date UNIQUE(user_id, date),
    CONSTRAINT valid_check_times CHECK (check_out_time IS NULL OR check_out_time > check_in_time)
);

-- Leave Balance Table
CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    casual_total INTEGER DEFAULT 12,
    casual_used INTEGER DEFAULT 0,
    casual_pending INTEGER DEFAULT 0,
    sick_total INTEGER DEFAULT 12,
    sick_used INTEGER DEFAULT 0,
    sick_pending INTEGER DEFAULT 0,
    paid_total INTEGER DEFAULT 15,
    paid_used INTEGER DEFAULT 0,
    paid_pending INTEGER DEFAULT 0,
    unpaid_used INTEGER DEFAULT 0,
    unpaid_pending INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_user_year UNIQUE(user_id, year)
);

-- Leave Requests Table
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type leave_type NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status leave_status NOT NULL DEFAULT 'PENDING',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    attachment_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_leave_dates CHECK (end_date >= start_date),
    CONSTRAINT valid_total_days CHECK (total_days > 0)
);

-- Company Holidays Table
CREATE TABLE holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    date DATE NOT NULL UNIQUE,
    description TEXT,
    is_optional BOOLEAN DEFAULT FALSE,
    year INTEGER NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Attendance Rules/Configuration Table
CREATE TABLE attendance_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    data_type VARCHAR(20) DEFAULT 'string',
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs Table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action audit_action NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Session/Token Management Table
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_employee_id ON users(employee_id);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_manager ON users(manager_id);

CREATE INDEX idx_attendance_user_id ON attendance_records(user_id);
CREATE INDEX idx_attendance_date ON attendance_records(date);
CREATE INDEX idx_attendance_user_date ON attendance_records(user_id, date);
CREATE INDEX idx_attendance_status ON attendance_records(status);

CREATE INDEX idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX idx_leave_requests_approver ON leave_requests(approved_by);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

CREATE INDEX idx_holidays_date ON holidays(date);
CREATE INDEX idx_holidays_year ON holidays(year);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to all relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_balances_updated_at BEFORE UPDATE ON leave_balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_holidays_updated_at BEFORE UPDATE ON holidays
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_config_updated_at BEFORE UPDATE ON attendance_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate attendance hours
CREATE OR REPLACE FUNCTION calculate_attendance_hours()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.check_in_time IS NOT NULL AND NEW.check_out_time IS NOT NULL THEN
        NEW.total_hours = EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER calculate_hours_trigger BEFORE INSERT OR UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION calculate_attendance_hours();

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
    p_user_id UUID,
    p_action audit_action,
    p_entity_type VARCHAR,
    p_entity_id UUID,
    p_old_values JSONB,
    p_new_values JSONB,
    p_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, reason)
    VALUES (p_user_id, p_action, p_entity_type, p_entity_id, p_old_values, p_new_values, p_reason)
    RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ language 'plpgsql';

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- Default Shifts
INSERT INTO shifts (name, code, shift_type, start_time, end_time, grace_period_minutes) VALUES
('Day Shift', 'DAY', 'DAY', '09:00:00', '18:00:00', 15),
('Night Shift', 'NIGHT', 'NIGHT', '22:00:00', '06:00:00', 15),
('Morning Shift', 'MORNING', 'DAY', '06:00:00', '14:00:00', 10),
('Evening Shift', 'EVENING', 'DAY', '14:00:00', '22:00:00', 10),
('Flexible', 'FLEX', 'FLEXIBLE', '08:00:00', '20:00:00', 30);

-- Default Attendance Configuration
INSERT INTO attendance_config (config_key, config_value, description, data_type) VALUES
('late_mark_after_minutes', '15', 'Minutes after shift start to mark as late', 'integer'),
('half_day_hours', '4', 'Minimum hours for half-day', 'decimal'),
('full_day_hours', '8', 'Minimum hours for full day', 'decimal'),
('overtime_threshold_hours', '9', 'Hours after which overtime starts', 'decimal'),
('payroll_lock_day', '5', 'Day of month to lock previous month attendance', 'integer'),
('face_recognition_threshold', '0.6', 'Minimum confidence score for face match', 'decimal'),
('allow_manual_attendance', 'true', 'Allow HR to add manual attendance', 'boolean'),
('require_face_verification', 'true', 'Require face verification for check-in', 'boolean'),
('max_consecutive_leaves', '15', 'Maximum consecutive leave days allowed', 'integer');

-- Default Departments
INSERT INTO departments (name, code, description) VALUES
('Human Resources', 'HR', 'Human Resources Department'),
('Information Technology', 'IT', 'IT and Systems Department'),
('Finance', 'FIN', 'Finance and Accounts Department'),
('Operations', 'OPS', 'Operations Department'),
('Sales', 'SALES', 'Sales and Marketing Department'),
('Production', 'PROD', 'Production and Manufacturing Department'),
('Quality Assurance', 'QA', 'Quality Control Department'),
('Administration', 'ADMIN', 'Administrative Department');

-- Default Admin User (password: Admin@123)
-- Note: Employee IDs are auto-generated based on department code (e.g., IT001, HR002)
INSERT INTO users (
    employee_id, email, password_hash, first_name, last_name, phone, role, status, date_of_joining
) VALUES (
    'IT001',
    'admin@raymond.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y.M1Qxz7.3.Q5Wy',
    'System',
    'Administrator',
    '+91-9876543210',
    'ADMIN',
    'ACTIVE',
    '2024-01-01'
);

-- Create leave balance for current year
INSERT INTO leave_balances (user_id, year)
SELECT id, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
FROM users WHERE employee_id = 'IT001';

-- Sample HR User (password: Hr@12345)
-- Note: HR cannot approve any leave requests, only managers can approve for their department
INSERT INTO users (
    employee_id, email, password_hash, first_name, last_name, phone, role, status, date_of_joining,
    department_id
) VALUES (
    'HR001',
    'hr@raymond.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y.M1Qxz7.3.Q5Wy',
    'Priya',
    'Sharma',
    '+91-9876543211',
    'HR',
    'ACTIVE',
    '2024-01-15',
    (SELECT id FROM departments WHERE code = 'HR')
);

-- Sample Manager User (password: Manager@123)
-- Note: Managers can only approve leave for employees in their own department
INSERT INTO users (
    employee_id, email, password_hash, first_name, last_name, phone, role, status, date_of_joining,
    department_id, shift_id
) VALUES (
    'IT002',
    'manager@raymond.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y.M1Qxz7.3.Q5Wy',
    'Rajesh',
    'Kumar',
    '+91-9876543212',
    'MANAGER',
    'ACTIVE',
    '2024-01-20',
    (SELECT id FROM departments WHERE code = 'IT'),
    (SELECT id FROM shifts WHERE code = 'DAY')
);

-- Sample Employee User (password: Employee@123)
INSERT INTO users (
    employee_id, email, password_hash, first_name, last_name, phone, role, status, date_of_joining,
    department_id, shift_id, manager_id
) VALUES (
    'IT003',
    'employee@raymond.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y.M1Qxz7.3.Q5Wy',
    'Amit',
    'Patel',
    '+91-9876543213',
    'EMPLOYEE',
    'ACTIVE',
    '2024-02-01',
    (SELECT id FROM departments WHERE code = 'IT'),
    (SELECT id FROM shifts WHERE code = 'DAY'),
    (SELECT id FROM users WHERE employee_id = 'IT002')
);

-- General Manager (GM) - Director of Company (password: Gm@12345)
-- Note: GM is the only one who can approve Admin leave requests
-- GM can also approve/reject any leave request across all departments
INSERT INTO users (
    employee_id, email, password_hash, first_name, last_name, phone, role, status, date_of_joining,
    department_id, shift_id
) VALUES (
    'ADMIN001',
    'gm@raymond.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y.M1Qxz7.3.Q5Wy',
    'Vikram',
    'Singhania',
    '+91-9876543214',
    'GM',
    'ACTIVE',
    '2020-01-01',
    (SELECT id FROM departments WHERE code = 'ADMIN'),
    (SELECT id FROM shifts WHERE code = 'DAY')
);

-- Update Admin user to be under IT department
UPDATE users SET department_id = (SELECT id FROM departments WHERE code = 'IT')
WHERE employee_id = 'IT001';

-- Create leave balances for all users
INSERT INTO leave_balances (user_id, year)
SELECT id, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
FROM users
WHERE id NOT IN (SELECT user_id FROM leave_balances WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);

-- Sample Holidays for 2025
INSERT INTO holidays (name, date, year, is_optional) VALUES
('New Year', '2025-01-01', 2025, FALSE),
('Republic Day', '2025-01-26', 2025, FALSE),
('Holi', '2025-03-14', 2025, FALSE),
('Good Friday', '2025-04-18', 2025, TRUE),
('Independence Day', '2025-08-15', 2025, FALSE),
('Gandhi Jayanti', '2025-10-02', 2025, FALSE),
('Diwali', '2025-10-20', 2025, FALSE),
('Christmas', '2025-12-25', 2025, FALSE);

-- Holidays for 2026 (Indian National and Company Holidays)
INSERT INTO holidays (name, date, year, is_optional) VALUES
('New Year', '2026-01-01', 2026, FALSE),
('Republic Day', '2026-01-26', 2026, FALSE),
('Maha Shivaratri', '2026-02-15', 2026, TRUE),
('Holi', '2026-03-04', 2026, FALSE),
('Good Friday', '2026-04-03', 2026, TRUE),
('Ram Navami', '2026-04-06', 2026, TRUE),
('Mahavir Jayanti', '2026-04-09', 2026, TRUE),
('Buddha Purnima', '2026-05-12', 2026, TRUE),
('Eid ul-Fitr', '2026-03-21', 2026, TRUE),
('Eid ul-Adha', '2026-05-28', 2026, TRUE),
('Independence Day', '2026-08-15', 2026, FALSE),
('Janmashtami', '2026-08-25', 2026, TRUE),
('Gandhi Jayanti', '2026-10-02', 2026, FALSE),
('Dussehra', '2026-10-11', 2026, FALSE),
('Diwali', '2026-11-08', 2026, FALSE),
('Diwali (Next Day)', '2026-11-09', 2026, FALSE),
('Guru Nanak Jayanti', '2026-11-16', 2026, TRUE),
('Christmas', '2026-12-25', 2026, FALSE);

-- =====================================================
-- VIEWS
-- =====================================================

-- Employee Attendance Summary View
CREATE OR REPLACE VIEW vw_employee_attendance_summary AS
SELECT 
    u.id AS user_id,
    u.employee_id,
    u.first_name || ' ' || u.last_name AS full_name,
    u.email,
    d.name AS department,
    s.name AS shift,
    EXTRACT(MONTH FROM ar.date) AS month,
    EXTRACT(YEAR FROM ar.date) AS year,
    COUNT(CASE WHEN ar.status = 'PRESENT' THEN 1 END) AS present_days,
    COUNT(CASE WHEN ar.status = 'ABSENT' THEN 1 END) AS absent_days,
    COUNT(CASE WHEN ar.status = 'LATE' THEN 1 END) AS late_days,
    COUNT(CASE WHEN ar.status = 'HALF_DAY' THEN 1 END) AS half_days,
    COUNT(CASE WHEN ar.status = 'ON_LEAVE' THEN 1 END) AS leave_days,
    COALESCE(SUM(ar.total_hours), 0) AS total_hours,
    COALESCE(SUM(ar.overtime_hours), 0) AS overtime_hours
FROM users u
LEFT JOIN departments d ON u.department_id = d.id
LEFT JOIN shifts s ON u.shift_id = s.id
LEFT JOIN attendance_records ar ON u.id = ar.user_id
WHERE u.status = 'ACTIVE'
GROUP BY u.id, u.employee_id, u.first_name, u.last_name, u.email, d.name, s.name,
    EXTRACT(MONTH FROM ar.date), EXTRACT(YEAR FROM ar.date);

-- Leave Balance Summary View
CREATE OR REPLACE VIEW vw_leave_balance_summary AS
SELECT 
    u.id AS user_id,
    u.employee_id,
    u.first_name || ' ' || u.last_name AS full_name,
    d.name AS department,
    lb.year,
    lb.casual_total - lb.casual_used - lb.casual_pending AS casual_available,
    lb.sick_total - lb.sick_used - lb.sick_pending AS sick_available,
    lb.paid_total - lb.paid_used - lb.paid_pending AS paid_available,
    lb.casual_total, lb.casual_used, lb.casual_pending,
    lb.sick_total, lb.sick_used, lb.sick_pending,
    lb.paid_total, lb.paid_used, lb.paid_pending,
    lb.unpaid_used, lb.unpaid_pending
FROM users u
JOIN leave_balances lb ON u.id = lb.user_id
LEFT JOIN departments d ON u.department_id = d.id
WHERE u.status = 'ACTIVE';

-- Pending Leave Requests View
CREATE OR REPLACE VIEW vw_pending_leave_requests AS
SELECT 
    lr.id AS request_id,
    u.employee_id,
    u.first_name || ' ' || u.last_name AS employee_name,
    d.name AS department,
    m.first_name || ' ' || m.last_name AS manager_name,
    m.email AS manager_email,
    lr.leave_type,
    lr.start_date,
    lr.end_date,
    lr.total_days,
    lr.reason,
    lr.created_at AS requested_at
FROM leave_requests lr
JOIN users u ON lr.user_id = u.id
LEFT JOIN departments d ON u.department_id = d.id
LEFT JOIN users m ON u.manager_id = m.id
WHERE lr.status = 'PENDING'
ORDER BY lr.created_at ASC;

-- =====================================================
-- STORED PROCEDURES
-- =====================================================

-- Procedure to mark attendance
CREATE OR REPLACE FUNCTION mark_attendance(
    p_user_id UUID,
    p_action VARCHAR,
    p_is_face_verified BOOLEAN DEFAULT FALSE,
    p_face_score DECIMAL DEFAULT NULL,
    p_location JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_now TIMESTAMP WITH TIME ZONE := CURRENT_TIMESTAMP;
    v_record attendance_records%ROWTYPE;
    v_shift shifts%ROWTYPE;
    v_status attendance_status;
    v_result JSONB;
BEGIN
    -- Get user's shift
    SELECT s.* INTO v_shift
    FROM users u
    JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = p_user_id;
    
    -- Check existing record for today
    SELECT * INTO v_record
    FROM attendance_records
    WHERE user_id = p_user_id AND date = v_today;
    
    IF p_action = 'CHECK_IN' THEN
        IF v_record.id IS NOT NULL AND v_record.check_in_time IS NOT NULL THEN
            RETURN jsonb_build_object('success', FALSE, 'message', 'Already checked in today');
        END IF;
        
        -- Determine status based on time
        IF v_shift.id IS NOT NULL THEN
            IF v_now::TIME > (v_shift.start_time + (v_shift.grace_period_minutes || ' minutes')::INTERVAL) THEN
                v_status := 'LATE';
            ELSE
                v_status := 'PRESENT';
            END IF;
        ELSE
            v_status := 'PRESENT';
        END IF;
        
        IF v_record.id IS NULL THEN
            INSERT INTO attendance_records (user_id, date, check_in_time, status, shift_id, is_face_verified, face_verification_score, check_in_location)
            VALUES (p_user_id, v_today, v_now, v_status, v_shift.id, p_is_face_verified, p_face_score, p_location)
            RETURNING * INTO v_record;
        ELSE
            UPDATE attendance_records
            SET check_in_time = v_now, status = v_status, is_face_verified = p_is_face_verified, 
                face_verification_score = p_face_score, check_in_location = p_location
            WHERE id = v_record.id
            RETURNING * INTO v_record;
        END IF;
        
        v_result := jsonb_build_object(
            'success', TRUE,
            'message', 'Check-in successful',
            'check_in_time', v_record.check_in_time,
            'status', v_record.status
        );
        
    ELSIF p_action = 'CHECK_OUT' THEN
        IF v_record.id IS NULL OR v_record.check_in_time IS NULL THEN
            RETURN jsonb_build_object('success', FALSE, 'message', 'No check-in found for today');
        END IF;
        
        IF v_record.check_out_time IS NOT NULL THEN
            RETURN jsonb_build_object('success', FALSE, 'message', 'Already checked out today');
        END IF;
        
        -- Update status based on total hours
        UPDATE attendance_records
        SET check_out_time = v_now, check_out_location = p_location
        WHERE id = v_record.id
        RETURNING * INTO v_record;
        
        -- Update status to HALF_DAY if less than full day hours
        IF v_record.total_hours < COALESCE(v_shift.full_day_hours, 8) 
           AND v_record.total_hours >= COALESCE(v_shift.half_day_hours, 4) THEN
            UPDATE attendance_records SET status = 'HALF_DAY' WHERE id = v_record.id;
        END IF;
        
        v_result := jsonb_build_object(
            'success', TRUE,
            'message', 'Check-out successful',
            'check_out_time', v_record.check_out_time,
            'total_hours', v_record.total_hours
        );
    ELSE
        v_result := jsonb_build_object('success', FALSE, 'message', 'Invalid action');
    END IF;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Procedure to lock attendance for payroll
CREATE OR REPLACE FUNCTION lock_attendance_for_payroll(
    p_admin_id UUID,
    p_month INTEGER,
    p_year INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE attendance_records
    SET is_locked = TRUE, locked_at = CURRENT_TIMESTAMP, locked_by = p_admin_id
    WHERE EXTRACT(MONTH FROM date) = p_month
    AND EXTRACT(YEAR FROM date) = p_year
    AND is_locked = FALSE;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    -- Log the action
    PERFORM create_audit_log(p_admin_id, 'UPDATE', 'attendance_records', NULL, NULL, 
        jsonb_build_object('action', 'PAYROLL_LOCK', 'month', p_month, 'year', p_year, 'records_locked', v_count),
        'Payroll period lock');
    
    RETURN jsonb_build_object('success', TRUE, 'records_locked', v_count);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO raymond_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO raymond_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO raymond_admin;
