import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  getProfile: () => api.get('/auth/me'),
  changePassword: (data) => api.post('/auth/change-password', data)
}

// Users API
export const usersAPI = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  deactivate: (id, reason) => api.patch(`/users/${id}/deactivate`, { reason }),
  resetPassword: (id, newPassword) => api.post(`/users/${id}/reset-password`, { new_password: newPassword }),
  getTeamMembers: () => api.get('/users/team/members'),
  getOrganizationHierarchy: () => api.get('/users/organization/hierarchy'),
  getDepartmentEmployees: (departmentId) => api.get(`/users/department/${departmentId}/employees`),
  getNextEmployeeId: (departmentId) => api.get(`/users/next-employee-id/${departmentId}`)
}

// Attendance API
export const attendanceAPI = {
  checkIn: (data) => api.post('/attendance/check-in', data),
  checkOut: (data) => api.post('/attendance/check-out', data),
  getToday: () => api.get('/attendance/today'),
  getRecords: (params) => api.get('/attendance', { params }),
  getUserAttendance: (userId, params) => api.get(`/attendance/user/${userId}`, { params }),
  manualEntry: (data) => api.post('/attendance/manual', data),
  lockAttendance: (month, year) => api.post('/attendance/lock', { month, year }),
  getDashboard: () => api.get('/attendance/summary/dashboard'),
  // Location verification settings
  getLocationVerificationStatus: () => api.get('/attendance/location-verification-status'),
  updateLocationVerification: (enabled) => api.put('/attendance/location-verification', { enabled })
}

// Leave API
export const leaveAPI = {
  apply: (data) => api.post('/leaves/apply', data),
  getMyLeaves: (params) => api.get('/leaves/my-leaves', { params }),
  getPending: () => api.get('/leaves/pending'),
  getPendingApprovals: () => api.get('/leaves/pending'),
  approve: (id, data) => api.patch(`/leaves/${id}/approve`, data),
  reject: (id, data) => api.patch(`/leaves/${id}/reject`, data),
  cancel: (id) => api.patch(`/leaves/${id}/cancel`),
  getAll: (params) => api.get('/leaves', { params }),
  getBalance: (userId, year) => api.get(`/leaves/balance/${userId || 'me'}`, { params: { year } })
}

// Department API
export const departmentAPI = {
  getAll: (params) => api.get('/departments', { params }),
  getById: (id) => api.get(`/departments/${id}`),
  create: (data) => api.post('/departments', data),
  update: (id, data) => api.put(`/departments/${id}`, data),
  delete: (id) => api.delete(`/departments/${id}`)
}

// Shift API
export const shiftAPI = {
  getAll: (params) => api.get('/shifts', { params }),
  getById: (id) => api.get(`/shifts/${id}`),
  create: (data) => api.post('/shifts', data),
  update: (id, data) => api.put(`/shifts/${id}`, data),
  delete: (id) => api.delete(`/shifts/${id}`),
  assign: (userId, shiftId) => api.post('/shifts/assign', { user_id: userId, shift_id: shiftId })
}

// Holiday API
export const holidayAPI = {
  getAll: (params) => api.get('/holidays', { params }),
  getUpcoming: () => api.get('/holidays/upcoming'),
  check: (date) => api.get(`/holidays/check/${date}`),
  create: (data) => api.post('/holidays', data),
  update: (id, data) => api.put(`/holidays/${id}`, data),
  delete: (id) => api.delete(`/holidays/${id}`),
  bulkCreate: (holidays) => api.post('/holidays/bulk', { holidays })
}

// Reports API
export const reportAPI = {
  getAttendanceReport: (params) => api.get('/reports/attendance', { params }),
  getLeaveReport: (params) => api.get('/reports/leaves', { params }),
  getEmployeeSummary: (params) => api.get('/reports/employee-summary', { params }),
  getDailyReport: (params) => api.get('/reports/daily', { params }),
  // Aliases used in Reports.jsx
  attendance: (params) => api.get('/reports/attendance', { params, responseType: params.format ? 'blob' : 'json' }),
  leaves: (params) => api.get('/reports/leaves', { params, responseType: params.format ? 'blob' : 'json' }),
  summary: (params) => api.get('/reports/employee-summary', { params, responseType: params.format ? 'blob' : 'json' }),
  downloadAttendanceExcel: (params) => 
    api.get('/reports/attendance', { params: { ...params, format: 'excel' }, responseType: 'blob' }),
  downloadAttendancePDF: (params) => 
    api.get('/reports/attendance', { params: { ...params, format: 'pdf' }, responseType: 'blob' })
}

// Face Recognition API
export const faceAPI = {
  register: (faceDescriptor) => api.post('/face/register', { face_descriptor: faceDescriptor }),
  registerForUser: (userId, faceDescriptor) => 
    api.post(`/face/register/${userId}`, { face_descriptor: faceDescriptor }),
  verify: (faceDescriptor) => api.post('/face/verify', { face_descriptor: faceDescriptor }),
  getStatus: () => api.get('/face/status'),
  getStatusForUser: (userId) => api.get(`/face/status/${userId}`),
  delete: (userId) => api.delete(`/face/register/${userId}`),
  deleteRegistration: (userId) => api.delete(`/face/register/${userId}`),
  getRegisteredUsers: (params) => api.get('/face/registered-users', { params })
}

// Config API
export const configAPI = {
  get: () => api.get('/config'),
  getAll: () => api.get('/config'),
  getByKey: (key) => api.get(`/config/${key}`),
  update: (data) => api.put('/config', data),
  updateByKey: (key, value, description) => api.put(`/config/${key}`, { value, description }),
  create: (data) => api.post('/config', data),
  delete: (key) => api.delete(`/config/${key}`),
  getAuditLogs: (params) => api.get('/config/audit/logs', { params }),
  getOfficeLocation: () => api.get('/config/office-location')
}

export default api
