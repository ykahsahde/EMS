# Raymond Lifestyle Ltd. - Attendance Management System

A complete attendance management system with face recognition, leave management, and reporting capabilities.

## Tech Stack

- Frontend: React 18 + Vite + Tailwind CSS
- Backend: Node.js + Express REST API
- Database: PostgreSQL 15
- Containerization: Docker + Docker Compose
- Face Recognition: face-api.js (TensorFlow.js)

## Project Structure

```
├── frontend/                 # React + Vite application
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   ├── pages/            # Page components
│   │   ├── contexts/         # React contexts (Auth)
│   │   └── services/         # API services
│   └── Public/models/        # Face detection models
├── backend/                  # Express REST API
│   ├── src/
│   │   ├── routes/           # API routes
│   │   ├── middleware/       # Auth, validation, logging
│   │   └── config/           # Database configuration
├── database/                 # PostgreSQL schema & migrations
│   └── init.sql              # Database initialization script
└── docker-compose.yml        # Docker services configuration
```

## Getting Started

### Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose
- Git

### Installation

1. Clone the repository

```bash
git clone <repository-url>
cd attendance-management-system
```

2. Start all services with Docker

```bash
docker-compose up -d
```

3. Access the application

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- pgAdmin: http://localhost:5050

### Manual Setup (without Docker)

1. Install frontend dependencies

```bash
cd frontend
npm install
npm run dev
```

2. Install backend dependencies

```bash
cd backend
npm install
npm run dev
```

3. Set up PostgreSQL database and run init.sql

## User Roles

| Role | Access Level | Description |
|------|--------------|-------------|
| Admin | Full system control | System administrator, manages all settings |
| GM (Director) | Company-wide oversight | General Manager, oversees all departments |
| HR | Employee management | Manages employee records and attendance |
| Manager | Department-level control | Manages employees in their department only |
| Employee | Self-service | Personal attendance and leave requests |

### Role Permissions

- Admin: Full access to all features, can create any user role
- GM: Oversees all departments, approves leaves across departments, views company-wide reports
- HR: Manages employee records, can create Managers and Employees
- Manager: Manages own department employees, approves department leave requests
- Employee: Mark attendance, apply for leave, view own records

### Default Login Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@raymond.com | Admin@123 | Admin |
| hr@raymond.com | Hr@12345 | HR |
| manager@raymond.com | Manager@123 | Manager |
| employee@raymond.com | Employee@123 | Employee |
| gm@raymond.com | Gm@12345 | GM |

## Features

- Role-based access control with 5 user levels
- Face recognition for attendance marking
- Location-based attendance verification
- Multiple shift support (Day, Night, Morning, Evening, Flexible)
- Leave management with approval workflow
- Holiday calendar management
- Department and employee management
- Attendance reports with Excel/PDF export
- Audit logging for all actions
- Real-time dashboard with attendance statistics

## API Endpoints

### Authentication
- POST /api/auth/login - User login
- POST /api/auth/logout - User logout
- GET /api/auth/me - Get current user

### Attendance
- POST /api/attendance/check-in - Check in
- POST /api/attendance/check-out - Check out
- GET /api/attendance/today - Get today's attendance
- GET /api/attendance/my - Get user's attendance history

### Users
- GET /api/users - List all users
- POST /api/users - Create new user
- PUT /api/users/:id - Update user
- DELETE /api/users/:id - Delete user

### Leave
- GET /api/leave - List leave requests
- POST /api/leave - Apply for leave
- PUT /api/leave/:id/approve - Approve leave
- PUT /api/leave/:id/reject - Reject leave

### Reports
- GET /api/reports/attendance - Attendance report
- GET /api/reports/summary - Summary report



## Docker Services

| Service | Port | Description |
|---------|------|-------------|
| postgres | 5432 | PostgreSQL database |
| pgadmin | 5050 | Database management UI |
| backend | 3000 | Node.js API server |
| frontend | 5173 | React development server |

### Docker Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f backend

# Rebuild containers
docker-compose up -d --build

# Access database
docker exec -it raymond_postgres psql -U raymond_admin -d raymond_attendance
```

## Database Tables

- users - Employee information and credentials
- departments - Company departments
- shifts - Work shift definitions
- attendance_records - Daily attendance entries
- leave_requests - Leave applications
- leave_balances - Annual leave quotas
- holidays - Company holidays
- attendance_config - System configuration
- audit_logs - Action history




