
-- Insert 2026 holidays (skip if already exists)
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
('Christmas', '2026-12-25', 2026, FALSE)
ON CONFLICT (date) DO NOTHING;

-- =====================================================
-- 3. UPDATE EMPLOYEE IDS TO DEPARTMENT-BASED FORMAT
-- (Optional - only run if you want to migrate existing IDs)
-- =====================================================

-- This section creates a function to generate department-based employee IDs
-- and optionally migrate existing users to the new format

-- Function to generate next employee ID for a department
CREATE OR REPLACE FUNCTION generate_next_employee_id(dept_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    v_dept_code VARCHAR(10);
    v_max_num INTEGER;
    v_next_id VARCHAR(20);
BEGIN
    -- Get department code
    SELECT code INTO v_dept_code FROM departments WHERE id = dept_id;
    
    IF v_dept_code IS NULL THEN
        v_dept_code := 'EMP';
    END IF;
    
    -- Find highest existing number for this department
    SELECT COALESCE(MAX(
        CASE 
            WHEN employee_id ~ ('^' || v_dept_code || '[0-9]+$')
            THEN SUBSTRING(employee_id FROM LENGTH(v_dept_code) + 1)::INTEGER
            ELSE 0
        END
    ), 0) INTO v_max_num
    FROM users
    WHERE employee_id LIKE v_dept_code || '%';
    
    -- Generate next ID with 3-digit padding
    v_next_id := v_dept_code || LPAD((v_max_num + 1)::TEXT, 3, '0');
    
    RETURN v_next_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. CREATE LEAVE BALANCES FOR 2026
-- =====================================================

-- Create leave balances for 2026 for all active users who don't have them
INSERT INTO leave_balances (user_id, year, casual_total, sick_total, paid_total)
SELECT u.id, 2026, 12, 12, 15
FROM users u
WHERE u.status = 'ACTIVE'
AND NOT EXISTS (
    SELECT 1 FROM leave_balances lb 
    WHERE lb.user_id = u.id AND lb.year = 2026
);

SELECT 'Migration completed successfully!' AS status;
