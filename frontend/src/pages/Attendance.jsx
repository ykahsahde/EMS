import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { attendanceAPI, faceAPI } from '../services/api'
import {
  Clock, LogIn, LogOut, Calendar, CheckCircle, XCircle,
  Timer, AlertCircle, ScanFace, Camera, UserCheck
} from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import FaceAttendance from '../components/FaceAttendance'

const Attendance = () => {
  const { user, isAdmin, isHR, isManager } = useAuth()
  const queryClient = useQueryClient()
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [showFaceAttendance, setShowFaceAttendance] = useState(false)
  const [attendanceMode, setAttendanceMode] = useState('check-in') // 'check-in' or 'check-out'

  // Fetch face registration status
  const { data: faceStatus } = useQuery({
    queryKey: ['face-status'],
    queryFn: async () => {
      const response = await faceAPI.getStatus()
      return response.data.data
    }
  })

  // Fetch today's attendance
  const { data: todayData, isLoading: todayLoading } = useQuery({
    queryKey: ['today-attendance'],
    queryFn: async () => {
      const response = await attendanceAPI.getToday()
      return response.data.data
    },
    refetchInterval: 60000 // Refresh every minute
  })

  // Fetch attendance history
  const { data: attendanceData, isLoading: historyLoading } = useQuery({
    queryKey: ['my-attendance', user?.id, selectedMonth, selectedYear],
    queryFn: async () => {
      const response = await attendanceAPI.getUserAttendance(user.id, {
        month: selectedMonth,
        year: selectedYear
      })
      return response.data.data
    }
  })

  // Check-in mutation
  const checkInMutation = useMutation({
    mutationFn: async (data) => {
      return attendanceAPI.checkIn(data)
    },
    onSuccess: () => {
      toast.success('Checked in successfully!')
      queryClient.invalidateQueries(['today-attendance'])
      queryClient.invalidateQueries(['my-attendance'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Check-in failed')
    }
  })

  // Check-out mutation
  const checkOutMutation = useMutation({
    mutationFn: async (data) => {
      return attendanceAPI.checkOut(data)
    },
    onSuccess: () => {
      toast.success('Checked out successfully!')
      queryClient.invalidateQueries(['today-attendance'])
      queryClient.invalidateQueries(['my-attendance'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Check-out failed')
    }
  })

  const handleCheckIn = async () => {
    setAttendanceMode('check-in')
    setShowFaceAttendance(true)
  }

  const handleCheckOut = async () => {
    setAttendanceMode('check-out')
    setShowFaceAttendance(true)
  }

  const getStatusBadge = (status) => {
    const statusConfig = {
      PRESENT: { class: 'status-present', icon: CheckCircle },
      ABSENT: { class: 'status-absent', icon: XCircle },
      LATE: { class: 'status-late', icon: Timer },
      HALF_DAY: { class: 'status-half-day', icon: AlertCircle },
      ON_LEAVE: { class: 'status-on-leave', icon: Calendar }
    }
    return statusConfig[status] || { class: 'bg-gray-100 text-gray-800', icon: AlertCircle }
  }

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-500">Track your daily attendance</p>
        </div>
        {(isAdmin || isHR) && (
          <button
            onClick={() => setShowManualEntry(true)}
            className="btn-secondary"
          >
            Manual Entry
          </button>
        )}
      </div>

      {/* Today's Attendance Card */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Today's Attendance</h2>
            <p className="text-gray-500">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>

            {todayData?.shift && (
              <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                <Clock className="w-4 h-4" />
                <span>Shift: {todayData.shift.name} ({todayData.shift.start_time} - {todayData.shift.end_time})</span>
              </div>
            )}

            {todayData?.attendance && (
              <div className="mt-4 space-y-2">
                {todayData.attendance.check_in_time && (
                  <div className="flex items-center gap-2">
                    <LogIn className="w-4 h-4 text-green-600" />
                    <span className="text-sm">
                      Checked in at <span className="font-medium">{format(new Date(todayData.attendance.check_in_time), 'hh:mm a')}</span>
                    </span>
                    {todayData.attendance.is_face_verified && (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                        Face Verified
                      </span>
                    )}
                  </div>
                )}
                {todayData.attendance.check_out_time && (
                  <div className="flex items-center gap-2">
                    <LogOut className="w-4 h-4 text-red-600" />
                    <span className="text-sm">
                      Checked out at <span className="font-medium">{format(new Date(todayData.attendance.check_out_time), 'hh:mm a')}</span>
                    </span>
                  </div>
                )}
                {todayData.attendance.total_hours && (
                  <div className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-blue-600" />
                    <span className="text-sm">
                      Total: <span className="font-medium">{parseFloat(todayData.attendance.total_hours).toFixed(2)} hours</span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Face Registration Alert */}
            {!faceStatus?.face_registered && (
              <div className="w-full sm:w-auto bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">
                  <a href="/face-registration" className="font-medium underline">Register your face</a> for faster check-in
                </span>
              </div>
            )}

            <button
              onClick={handleCheckIn}
              disabled={!todayData?.can_check_in || checkInMutation.isPending}
              className={clsx(
                "btn-success flex items-center gap-2 justify-center min-w-[140px]",
                !todayData?.can_check_in && "opacity-50 cursor-not-allowed"
              )}
            >
              <ScanFace className="w-5 h-5" />
              {checkInMutation.isPending ? 'Processing...' : 'Check In'}
            </button>
            <button
              onClick={handleCheckOut}
              disabled={!todayData?.can_check_out || checkOutMutation.isPending}
              className={clsx(
                "btn-danger flex items-center gap-2 justify-center min-w-[140px]",
                !todayData?.can_check_out && "opacity-50 cursor-not-allowed"
              )}
            >
              <LogOut className="w-5 h-5" />
              {checkOutMutation.isPending ? 'Processing...' : 'Check Out'}
            </button>
          </div>
        </div>

        {/* Status Badge */}
        {todayData?.attendance?.status && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Status:</span>
              <span className={clsx("status-badge", getStatusBadge(todayData.attendance.status).class)}>
                {todayData.attendance.status.replace('_', ' ')}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Monthly Summary */}
      {attendanceData?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Present', value: attendanceData.summary.present_days, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Absent', value: attendanceData.summary.absent_days, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Late', value: attendanceData.summary.late_days, color: 'text-yellow-600', bg: 'bg-yellow-50' },
            { label: 'Half Days', value: attendanceData.summary.half_days, color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'On Leave', value: attendanceData.summary.leave_days, color: 'text-blue-600', bg: 'bg-blue-50' }
          ].map((stat, index) => (
            <div key={index} className={clsx("card text-center", stat.bg)}>
              <p className={clsx("text-3xl font-bold", stat.color)}>{stat.value || 0}</p>
              <p className="text-sm text-gray-600 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Attendance History */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Attendance History</h2>
          <div className="flex gap-3">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="input-field w-auto"
            >
              {months.map((month, index) => (
                <option key={index} value={index + 1}>{month}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="input-field w-auto"
            >
              {[2024, 2025, 2026].map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>

        {historyLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Date</th>
                  <th className="table-header">Check In</th>
                  <th className="table-header">Check Out</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Hours</th>
                  <th className="table-header">Verified</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {attendanceData?.records?.map((record) => {
                  const statusConfig = getStatusBadge(record.status)
                  const StatusIcon = statusConfig.icon
                  return (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="table-cell font-medium">
                        {format(new Date(record.date), 'EEE, MMM d')}
                      </td>
                      <td className="table-cell">
                        {record.check_in_time
                          ? format(new Date(record.check_in_time), 'hh:mm a')
                          : '-'
                        }
                      </td>
                      <td className="table-cell">
                        {record.check_out_time
                          ? format(new Date(record.check_out_time), 'hh:mm a')
                          : '-'
                        }
                      </td>
                      <td className="table-cell">
                        <span className={clsx("status-badge inline-flex items-center gap-1", statusConfig.class)}>
                          <StatusIcon className="w-3 h-3" />
                          {record.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="table-cell">
                        {record.total_hours ? `${parseFloat(record.total_hours).toFixed(2)}h` : '-'}
                      </td>
                      <td className="table-cell">
                        {record.is_face_verified ? (
                          <ScanFace className="w-5 h-5 text-green-600" />
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {(!attendanceData?.records || attendanceData.records.length === 0) && (
                  <tr>
                    <td colSpan="6" className="table-cell text-center text-gray-500 py-8">
                      No attendance records found for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Entry Modal would go here for HR/Admin */}

      {/* Face Attendance Modal */}
      {showFaceAttendance && (
        <FaceAttendance
          mode={attendanceMode}
          onClose={() => setShowFaceAttendance(false)}
          onSuccess={() => setShowFaceAttendance(false)}
        />
      )}
    </div>
  )
}

export default Attendance
