
-- Step 1: Add GM to user_role enum
DO $$
BEGIN
    -- Check if 'GM' already exists in the enum
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'GM' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
    ) THEN
        -- Add GM after ADMIN in the enum
        ALTER TYPE user_role ADD VALUE 'GM' AFTER 'ADMIN';
        RAISE NOTICE 'GM role added to user_role enum';
    ELSE
        RAISE NOTICE 'GM role already exists in user_role enum';
    END IF;
END $$;

-- Step 2: Create a sample GM user (Director) if not exists
-- Password: Gm@12345 (hashed with bcrypt)
INSERT INTO users (
    employee_id, email, password_hash, first_name, last_name, phone, role, status, date_of_joining,
    department_id, shift_id
) 
SELECT 
    'RLL0005',
    'gm@raymond.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4Y.M1Qxz7.3.Q5Wy',
    'Vikram',
    'Singhania',
    '+91-9876543214',
    'GM',
    'ACTIVE',
    '2020-01-01',
    (SELECT id FROM departments WHERE code = 'ADMIN' LIMIT 1),
    (SELECT id FROM shifts WHERE code = 'DAY' LIMIT 1)
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'gm@raymond.com'
);

-- Step 3: Update Admin user to be under IT department (if not already set)
UPDATE users 
SET department_id = (SELECT id FROM departments WHERE code = 'IT' LIMIT 1)
WHERE role = 'ADMIN' 
AND department_id IS NULL;

-- Step 4: Create leave balance for GM user if not exists
INSERT INTO leave_balances (user_id, year)
SELECT id, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
FROM users 
WHERE email = 'gm@raymond.com'
AND id NOT IN (
    SELECT user_id FROM leave_balances 
    WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
);

-- Verification queries
SELECT 'Role Hierarchy:' as info;
SELECT DISTINCT role, COUNT(*) as count 
FROM users 
GROUP BY role 
ORDER BY 
    CASE role 
        WHEN 'ADMIN' THEN 1 
        WHEN 'GM' THEN 2 
        WHEN 'HR' THEN 3 
        WHEN 'MANAGER' THEN 4 
        WHEN 'EMPLOYEE' THEN 5 
    END;

SELECT 'GM User Created:' as info;
SELECT employee_id, email, first_name, last_name, role, status 
FROM users 
WHERE role = 'GM';


-- GM ROLE PRIVILEGES:
-- 1. GM (General Manager) is the Director of the company
-- 2. GM can oversee ALL departments
-- 3. GM can manage employees across all departments  
-- 4. GM reports directly to Admin (or no one)
-- 5. Department Managers report to GM

