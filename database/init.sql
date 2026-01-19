-- Raymond Attendance Management System
-- PostgreSQL Initialization Script
-- This script runs when the Docker container is first created

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Note: Database schema is managed by Prisma migrations
-- Run `npx prisma migrate deploy` to apply migrations
-- Run `npx prisma db seed` to seed initial data

-- Create mark_attendance stored procedure for atomic attendance operations
CREATE OR REPLACE FUNCTION mark_attendance(
    p_user_id UUID,
    p_action VARCHAR(20),
    p_is_face_verified BOOLEAN DEFAULT false,
    p_face_score DECIMAL(5,4) DEFAULT NULL,
    p_location_data JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_now TIMESTAMP WITH TIME ZONE := CURRENT_TIMESTAMP;
    v_record attendance_records%ROWTYPE;
    v_shift_id UUID;
    v_shift_start TIME;
    v_shift_end TIME;
    v_grace_period INT;
    v_status attendance_status;
    v_total_hours DECIMAL(5,2);
    v_result JSONB;
BEGIN
    -- Get user's shift info
    SELECT u.shift_id, s.start_time, s.end_time, s.grace_period_minutes
    INTO v_shift_id, v_shift_start, v_shift_end, v_grace_period
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = p_user_id;

    -- Check for existing record today
    SELECT * INTO v_record
    FROM attendance_records
    WHERE user_id = p_user_id AND date = v_today;

    IF p_action = 'CHECK_IN' THEN
        -- Check if already checked in
        IF v_record.id IS NOT NULL AND v_record.check_in_time IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Already checked in today'
            );
        END IF;

        -- Determine status based on check-in time
        IF v_shift_start IS NOT NULL THEN
            IF v_now::time <= v_shift_start + (v_grace_period || ' minutes')::interval THEN
                v_status := 'PRESENT';
            ELSE
                v_status := 'LATE';
            END IF;
        ELSE
            v_status := 'PRESENT';
        END IF;

        -- Insert or update record
        IF v_record.id IS NULL THEN
            INSERT INTO attendance_records (
                user_id, date, check_in_time, status, shift_id,
                is_face_verified, face_verification_score, check_in_location
            )
            VALUES (
                p_user_id, v_today, v_now, v_status, v_shift_id,
                p_is_face_verified, p_face_score, p_location_data
            );
        ELSE
            UPDATE attendance_records
            SET check_in_time = v_now,
                status = v_status,
                is_face_verified = p_is_face_verified,
                face_verification_score = p_face_score,
                check_in_location = p_location_data
            WHERE id = v_record.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Checked in successfully',
            'check_in_time', v_now,
            'status', v_status
        );

    ELSIF p_action = 'CHECK_OUT' THEN
        -- Check if checked in
        IF v_record.id IS NULL OR v_record.check_in_time IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'No check-in record found for today'
            );
        END IF;

        -- Check if already checked out
        IF v_record.check_out_time IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Already checked out today'
            );
        END IF;

        -- Calculate total hours
        v_total_hours := EXTRACT(EPOCH FROM (v_now - v_record.check_in_time)) / 3600.0;

        -- Update status based on hours worked
        IF v_total_hours >= 8 THEN
            v_status := v_record.status; -- Keep original status
        ELSIF v_total_hours >= 4 THEN
            v_status := 'HALF_DAY';
        ELSE
            v_status := 'HALF_DAY';
        END IF;

        UPDATE attendance_records
        SET check_out_time = v_now,
            total_hours = ROUND(v_total_hours::numeric, 2),
            status = v_status,
            check_out_location = p_location_data
        WHERE id = v_record.id;

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Checked out successfully',
            'check_out_time', v_now,
            'total_hours', ROUND(v_total_hours::numeric, 2),
            'status', v_status
        );
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Invalid action');
END;
$$ LANGUAGE plpgsql;

-- Create lock_attendance_for_payroll function
CREATE OR REPLACE FUNCTION lock_attendance_for_payroll(
    p_locked_by UUID,
    p_month INT,
    p_year INT
)
RETURNS JSONB AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_updated_count INT;
BEGIN
    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month' - interval '1 day')::date;

    UPDATE attendance_records
    SET is_locked = true,
        locked_at = CURRENT_TIMESTAMP,
        locked_by = p_locked_by
    WHERE date >= v_start_date
      AND date <= v_end_date
      AND is_locked = false;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Locked %s records for %s/%s', v_updated_count, p_month, p_year),
        'records_locked', v_updated_count,
        'period', jsonb_build_object('month', p_month, 'year', p_year)
    );
END;
$$ LANGUAGE plpgsql;

-- Grant privileges
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO raymond_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO raymond_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO raymond_admin;
