import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Attendance from './pages/Attendance'
import LeaveManagement from './pages/LeaveManagement'
import Employees from './pages/Employees'
import Departments from './pages/Departments'
import Shifts from './pages/Shifts'
import Holidays from './pages/Holidays'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import FaceRegistration from './pages/FaceRegistration'
import NotFound from './pages/NotFound'

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

function App() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* Public Routes */}
      <Route 
        path="/login" 
        element={user ? <Navigate to="/dashboard" replace /> : <Login />} 
      />

      {/* Protected Routes */}
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="leaves" element={<LeaveManagement />} />
        <Route path="profile" element={<Profile />} />
        <Route path="face-registration" element={<FaceRegistration />} />
        
        {/* Admin, HR, GM, Manager Routes - Employee Management */}
        <Route path="employees" element={
          <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'GM', 'MANAGER']}>
            <Employees />
          </ProtectedRoute>
        } />
        
        {/* Admin Only Routes */}
        <Route path="departments" element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <Departments />
          </ProtectedRoute>
        } />
        <Route path="shifts" element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <Shifts />
          </ProtectedRoute>
        } />
        <Route path="holidays" element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <Holidays />
          </ProtectedRoute>
        } />
        <Route path="reports" element={
          <ProtectedRoute allowedRoles={['ADMIN', 'HR', 'GM']}>
            <Reports />
          </ProtectedRoute>
        } />
        <Route path="settings" element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <Settings />
          </ProtectedRoute>
        } />
      </Route>

      {/* 404 Route */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
