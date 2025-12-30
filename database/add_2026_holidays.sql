INSERT INTO holidays (name, date, year, is_optional) VALUES
-- January 2026
('New Year', '2026-01-01', 2026, FALSE),
('Republic Day', '2026-01-26', 2026, FALSE),

-- March 2026
('Holi', '2026-03-03', 2026, FALSE),
('Maha Shivaratri', '2026-02-15', 2026, TRUE),

-- April 2026
('Good Friday', '2026-04-03', 2026, TRUE),
('Ram Navami', '2026-04-06', 2026, TRUE),
('Mahavir Jayanti', '2026-04-14', 2026, TRUE),
('Ambedkar Jayanti', '2026-04-14', 2026, FALSE),

-- May 2026
('May Day', '2026-05-01', 2026, FALSE),
('Buddha Purnima', '2026-05-12', 2026, TRUE),

-- July 2026
('Eid ul-Adha', '2026-07-07', 2026, TRUE),
('Muharram', '2026-08-06', 2026, TRUE),

-- August 2026
('Independence Day', '2026-08-15', 2026, FALSE),
('Raksha Bandhan', '2026-08-22', 2026, TRUE),
('Janmashtami', '2026-09-04', 2026, TRUE),

-- October 2026
('Gandhi Jayanti', '2026-10-02', 2026, FALSE),
('Dussehra', '2026-10-19', 2026, FALSE),

-- November 2026
('Diwali', '2026-11-08', 2026, FALSE),
('Guru Nanak Jayanti', '2026-11-19', 2026, TRUE),

-- December 2026
('Christmas', '2026-12-25', 2026, FALSE)

ON CONFLICT DO NOTHING;

-- Also add remaining 2025 holidays if they don't exist (for Dec 31)
INSERT INTO holidays (name, date, year, is_optional) VALUES
('New Year''s Eve', '2025-12-31', 2025, TRUE)
ON CONFLICT DO NOTHING;
