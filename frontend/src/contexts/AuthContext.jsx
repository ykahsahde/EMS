import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'

const AuthContext = createContext(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token')
      if (token) {
        try {
          const response = await api.get('/auth/me')
          if (response.data.success) {
            setUser(response.data.data)
          }
        } catch (error) {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
        }
      }
      setIsLoading(false)
    }
    checkAuth()
  }, [])

  const login = useCallback(async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password })
      
      if (response.data.success) {
        const { token, user: userData } = response.data.data
        localStorage.setItem('token', token)
        localStorage.setItem('user', JSON.stringify(userData))
        setUser(userData)
        toast.success(`Welcome back, ${userData.first_name}!`)
        navigate('/dashboard')
        return { success: true }
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Login failed'
      toast.error(message)
      return { success: false, error: message }
    }
  }, [navigate])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch (error) {
      // Ignore logout errors
    } finally {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setUser(null)
      toast.success('Logged out successfully')
      navigate('/login')
    }
  }, [navigate])

  const updateUser = useCallback((updatedData) => {
    setUser(prev => ({ ...prev, ...updatedData }))
    const stored = JSON.parse(localStorage.getItem('user') || '{}')
    localStorage.setItem('user', JSON.stringify({ ...stored, ...updatedData }))
  }, [])

  // Role check helpers
  const isAdmin = user?.role === 'ADMIN'
  const isGM = user?.role === 'GM'
  const isHR = user?.role === 'HR'
  const isManager = user?.role === 'MANAGER'
  const isEmployee = user?.role === 'EMPLOYEE'
  const canManageEmployees = isAdmin || isHR || isManager || isGM
  const canApproveLeaves = isManager || isAdmin || isHR || isGM
  const canViewReports = isAdmin || isHR || isGM
  const canEditSettings = isAdmin

  const value = {
    user,
    isLoading,
    login,
    logout,
    updateUser,
    isAdmin,
    isGM,
    isHR,
    isManager,
    isEmployee,
    canManageEmployees,
    canApproveLeaves,
    canViewReports,
    canEditSettings
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
