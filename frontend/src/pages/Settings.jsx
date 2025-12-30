import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { configAPI, attendanceAPI } from '../services/api'
import { 
  Settings as SettingsIcon, Save, RefreshCw, Shield, Clock, 
  Bell, Database, Lock, Globe, MapPin
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Settings = () => {
  const { isAdmin, isHR } = useAuth()
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState('general')

  // Fetch system configuration
  const { data: config, isLoading } = useQuery({
    queryKey: ['system-config'],
    queryFn: async () => {
      const response = await configAPI.get()
      return response.data.data
    },
    enabled: isAdmin || isHR
  })

  // Fetch location verification status
  const { data: locationVerificationData } = useQuery({
    queryKey: ['location-verification-status'],
    queryFn: async () => {
      const response = await attendanceAPI.getLocationVerificationStatus()
      return response.data.data
    },
    enabled: isAdmin
  })

  // Form state
  const [formData, setFormData] = useState({
    company_name: 'Raymond Lifestyle Ltd.',
    working_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    default_shift_id: '',
    attendance_lock_day: 5,
    late_mark_after_minutes: 15,
    half_day_after_hours: 4,
    overtime_start_after_hours: 8,
    face_recognition_required: true,
    location_tracking_enabled: true,
    location_verification_required: true, // New setting for mandatory location check
    auto_checkout_enabled: false,
    auto_checkout_time: '23:00',
    leave_approval_required: true,
    max_consecutive_leaves: 15
  })

  // Update configuration mutation
  const updateConfigMutation = useMutation({
    mutationFn: (data) => configAPI.update(data),
    onSuccess: () => {
      toast.success('Settings saved successfully!')
      queryClient.invalidateQueries(['system-config'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to save settings')
    }
  })

  // Update location verification mutation
  const updateLocationVerificationMutation = useMutation({
    mutationFn: (enabled) => attendanceAPI.updateLocationVerification(enabled),
    onSuccess: (response) => {
      const enabled = response.data.data.location_verification_required
      toast.success(`Location verification ${enabled ? 'enabled' : 'disabled'} successfully!`)
      queryClient.invalidateQueries(['location-verification-status'])
      setFormData(prev => ({ ...prev, location_verification_required: enabled }))
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update location verification setting')
    }
  })

  // Update form data when location verification data is loaded
  useEffect(() => {
    if (locationVerificationData) {
      setFormData(prev => ({
        ...prev,
        location_verification_required: locationVerificationData.location_verification_required
      }))
    }
  }, [locationVerificationData])

  const handleSave = () => {
    updateConfigMutation.mutate(formData)
  }

  const sections = [
    { id: 'general', label: 'General', icon: Globe },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'leave', label: 'Leave Policy', icon: Shield },
    { id: 'security', label: 'Security', icon: Lock }
  ]

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const toggleWorkingDay = (day) => {
    setFormData(prev => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter(d => d !== day)
        : [...prev.working_days, day]
    }))
  }

  if (!isAdmin && !isHR) {
    return (
      <div className="animate-fadeIn">
        <div className="card text-center py-12">
          <Shield className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <h2 className="text-xl font-semibold text-gray-700">Access Restricted</h2>
          <p className="text-gray-500 mt-2">You don't have permission to access system settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500">Configure system settings and preferences</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={updateConfigMutation.isPending}
          className="btn-primary flex items-center gap-2"
        >
          {updateConfigMutation.isPending ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
          Save Changes
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Settings Navigation */}
        <div className="lg:w-64 flex-shrink-0">
          <div className="card p-2">
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                    activeSection === section.id
                      ? "bg-primary-50 text-primary-700"
                      : "text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <section.icon className="w-5 h-5" />
                  <span className="font-medium">{section.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1">
          {isLoading ? (
            <div className="card flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <>
              {/* General Settings */}
              {activeSection === 'general' && (
                <div className="card space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-gray-400" />
                    General Settings
                  </h2>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Working Days
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {weekDays.map((day) => (
                        <button
                          key={day}
                          onClick={() => toggleWorkingDay(day)}
                          className={clsx(
                            "px-4 py-2 rounded-lg border transition-colors",
                            formData.working_days.includes(day)
                              ? "bg-primary-50 border-primary-500 text-primary-700"
                              : "border-gray-300 text-gray-600 hover:border-gray-400"
                          )}
                        >
                          {day.substring(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Attendance Settings */}
              {activeSection === 'attendance' && (
                <div className="card space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-gray-400" />
                    Attendance Settings
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Late Mark After (minutes)
                      </label>
                      <input
                        type="number"
                        value={formData.late_mark_after_minutes}
                        onChange={(e) => setFormData({ ...formData, late_mark_after_minutes: parseInt(e.target.value) })}
                        className="input-field"
                        min={0}
                        max={120}
                      />
                      <p className="text-xs text-gray-500 mt-1">Grace period after shift start</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Half Day After (hours)
                      </label>
                      <input
                        type="number"
                        value={formData.half_day_after_hours}
                        onChange={(e) => setFormData({ ...formData, half_day_after_hours: parseInt(e.target.value) })}
                        className="input-field"
                        min={1}
                        max={12}
                      />
                      <p className="text-xs text-gray-500 mt-1">Minimum hours for half day</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Overtime Starts After (hours)
                      </label>
                      <input
                        type="number"
                        value={formData.overtime_start_after_hours}
                        onChange={(e) => setFormData({ ...formData, overtime_start_after_hours: parseInt(e.target.value) })}
                        className="input-field"
                        min={1}
                        max={24}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Attendance Lock Day
                      </label>
                      <input
                        type="number"
                        value={formData.attendance_lock_day}
                        onChange={(e) => setFormData({ ...formData, attendance_lock_day: parseInt(e.target.value) })}
                        className="input-field"
                        min={1}
                        max={28}
                      />
                      <p className="text-xs text-gray-500 mt-1">Day of month to lock previous month's attendance</p>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">Face Recognition Required</p>
                        <p className="text-sm text-gray-500">Require face verification for check-in</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.face_recognition_required}
                          onChange={(e) => setFormData({ ...formData, face_recognition_required: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">Location Tracking</p>
                        <p className="text-sm text-gray-500">Track GPS location during check-in/out</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.location_tracking_enabled}
                          onChange={(e) => setFormData({ ...formData, location_tracking_enabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <div>
                        <p className="font-medium text-blue-900">🛡️ Location Verification Required</p>
                        <p className="text-sm text-blue-700">When enabled, employees must be at Raymond Borgaon Factory to mark attendance. When disabled, only face verification is required.</p>
                        {!formData.location_verification_required && (
                          <p className="text-xs text-orange-600 mt-1 font-medium">Warning: Currently disabled - Employees can mark attendance from anywhere</p>
                        )}
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.location_verification_required}
                          onChange={(e) => {
                            updateLocationVerificationMutation.mutate(e.target.checked)
                          }}
                          disabled={updateLocationVerificationMutation.isPending}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">Auto Checkout</p>
                        <p className="text-sm text-gray-500">Automatically check out employees at specified time</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {formData.auto_checkout_enabled && (
                          <input
                            type="time"
                            value={formData.auto_checkout_time}
                            onChange={(e) => setFormData({ ...formData, auto_checkout_time: e.target.value })}
                            className="input-field w-auto text-sm"
                          />
                        )}
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.auto_checkout_enabled}
                            onChange={(e) => setFormData({ ...formData, auto_checkout_enabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Leave Policy Settings */}
              {activeSection === 'leave' && (
                <div className="card space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-gray-400" />
                    Leave Policy Settings
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Max Consecutive Leave Days
                      </label>
                      <input
                        type="number"
                        value={formData.max_consecutive_leaves}
                        onChange={(e) => setFormData({ ...formData, max_consecutive_leaves: parseInt(e.target.value) })}
                        className="input-field"
                        min={1}
                        max={60}
                      />
                      <p className="text-xs text-gray-500 mt-1">Maximum days for a single leave request</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <div>
                      <p className="font-medium text-gray-900">Leave Approval Required</p>
                      <p className="text-sm text-gray-500">Require manager approval for leave requests</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.leave_approval_required}
                        onChange={(e) => setFormData({ ...formData, leave_approval_required: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>
                </div>
              )}

              {/* Security Settings */}
              {activeSection === 'security' && (
                <div className="card space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Lock className="w-5 h-5 text-gray-400" />
                    Security Settings
                  </h2>

                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-sm text-gray-600">
                      Security settings like password policies, session timeouts, and two-factor authentication
                      are configured at the server level. Contact your system administrator for changes.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div>
                        <p className="font-medium text-gray-900">Password Policy</p>
                        <p className="text-sm text-gray-500">Minimum 8 characters, mixed case, numbers</p>
                      </div>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Active</span>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div>
                        <p className="font-medium text-gray-900">Session Timeout</p>
                        <p className="text-sm text-gray-500">8 hours of inactivity</p>
                      </div>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Active</span>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-gray-900">Audit Logging</p>
                        <p className="text-sm text-gray-500">All user actions are logged</p>
                      </div>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Active</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings
