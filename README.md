# EMS - Attendance Management System

A complete attendance management system with face recognition, leave management, and reporting capabilities.

## Tech Stack

- **Frontend:** React 18 + Vite + Tailwind CSS
- **Backend:** Node.js + Express + Prisma ORM
- **Database:** PostgreSQL 15
- **Containerization:** Docker
- **Face Recognition:** face-api.js

## Quick Start

### Prerequisites
- Node.js 18+
- Docker Desktop

### 1. Start Database
```bash
docker-compose up -d postgres
```

### 2. Start Backend
```bash
cd backend
npm install
npm run dev
```

### 3. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

### Access
| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000/api |
| Prisma Studio | `npx prisma studio` (http://localhost:5555) |
| pgAdmin | http://localhost:5050 |

## Default Login

| Email | Password | Role |
|-------|----------|------|
| yash.khade@ems.com | Gm@12345 | Director / GM |
| admin@ems.com | Admin@123 | Admin |
| vedant.katore@ems.com | Admin@123 | HR |
| sujal.ghagare@ems.com | Admin@123 | Employee |
| parikshit.thakre@ems.com | Admin@123 | Employee |

## Features

- Face recognition attendance
- Location-based verification
- Leave management with approval workflow
- Multiple shift support
- Department & employee management
- Excel/PDF reports
- Role-based access control
- Audit logging

## User Roles

| Role | Description |
|------|-------------|
| Admin | Full system control |
| GM | Company-wide oversight |
| HR | Employee management |
| Manager | Department-level control |
| Employee | Self-service only |

## Environment Variables

Create `backend/.env`:
```env
DATABASE_URL="postgresql://ems_admin:EMS@2024Secure@localhost:5432/ems_attendance"
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=8h
PORT=3000
NODE_ENV=development
```

## Docker Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Access database CLI
docker exec -it ems_postgres psql -U ems_admin -d ems_attendance

# View logs
docker-compose logs -f backend
```

## Database

Managed by Prisma ORM. Key tables:
- `users` - Employee accounts
- `departments` - Company departments
- `shifts` - Work shift definitions
- `attendance_records` - Daily attendance
- `leave_requests` - Leave applications
- `leave_balances` - Annual leave quotas
- `holidays` - Company holidays
- `audit_logs` - Action history

### Prisma Commands
```bash
cd backend
npx prisma studio      # Open database GUI
npx prisma migrate dev # Run migrations
npx prisma generate    # Generate client
```
