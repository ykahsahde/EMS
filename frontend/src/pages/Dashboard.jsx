import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { attendanceAPI, leaveAPI, holidayAPI } from '../services/api'
import { 
  Users, Clock, Calendar, TrendingUp, AlertCircle, 
  CheckCircle, XCircle, Timer, CalendarDays
} from 'lucide-react'
import { format } from 'date-fns'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, PieChart, Pie, Cell 
} from 'recharts'
import clsx from 'clsx'

const Dashboard = () => {
  const { user, isAdmin, isHR, isManager, isGM } = useAuth()

  // Fetch dashboard data
  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await attendanceAPI.getDashboard()
      return response.data.data
    }
  })

  // Fetch today's attendance for employee
  const { data: todayAttendance } = useQuery({
    queryKey: ['today-attendance'],
    queryFn: async () => {
      const response = await attendanceAPI.getToday()
      return response.data.data
    }
  })

  // Fetch pending leaves for manager
  const { data: pendingLeaves } = useQuery({
    queryKey: ['pending-leaves'],
    queryFn: async () => {
      const response = await leaveAPI.getPending()
      return response.data.data
    },
    enabled: isManager || isAdmin || isHR
  })

  // Fetch upcoming holidays
  const { data: upcomingHolidays } = useQuery({
    queryKey: ['upcoming-holidays'],
    queryFn: async () => {
      const response = await holidayAPI.getUpcoming()
      return response.data.data
    }
  })

  const stats = [
    {
      title: 'Present Today',
      value: dashboardData?.summary?.present_today || 0,
      icon: CheckCircle,
      color: 'text-green-600',
      bg: 'bg-green-100'
    },
    {
      title: 'Absent Today',
      value: dashboardData?.summary?.absent_today || 0,
      icon: XCircle,
      color: 'text-red-600',
      bg: 'bg-red-100'
    },
    {
      title: 'Late Today',
      value: dashboardData?.summary?.late_today || 0,
      icon: Timer,
      color: 'text-yellow-600',
      bg: 'bg-yellow-100'
    },
    {
      title: 'On Leave',
      value: dashboardData?.summary?.on_leave_today || 0,
      icon: Calendar,
      color: 'text-blue-600',
      bg: 'bg-blue-100'
    }
  ]

  const monthlyData = [
    { name: 'Present', value: dashboardData?.summary?.present_this_month || 0 },
    { name: 'Absent', value: dashboardData?.summary?.absent_this_month || 0 },
    { name: 'Late', value: dashboardData?.summary?.late_this_month || 0 }
  ]

  const COLORS = ['#22c55e', '#ef4444', '#eab308']

  const getStatusBadge = (status) => {
    const statusClasses = {
      PRESENT: 'status-badge status-present',
      ABSENT: 'status-badge status-absent',
      LATE: 'status-badge status-late',
      HALF_DAY: 'status-badge status-half-day',
      ON_LEAVE: 'status-badge status-on-leave',
      PENDING: 'status-badge status-pending'
    }
    return statusClasses[status] || 'status-badge bg-gray-100 text-gray-800'
  }

  if (dashboardLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Welcome back, {user?.first_name}!
              {isGM && <span className="ml-2 text-amber-300">(Director)</span>}
            </h1>
            <p className="text-primary-100 mt-1">
              {format(new Date(), 'EEEE, MMMM d, yyyy')}
            </p>
            {isGM && (
              <p className="text-sm text-primary-200 mt-2">
                General Manager - Overseeing all departments
              </p>
            )}
          </div>
          {isGM && (
            <div className="hidden md:flex items-center justify-center w-16 h-16 bg-amber-400/20 rounded-full">
              <svg className="w-8 h-8 text-amber-300" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
              </svg>
            </div>
          )}
        </div>
        
        {/* Quick Check-in Status for Employees */}
        {!isAdmin && !isHR && !isGM && todayAttendance && (
          <div className="mt-4 flex items-center gap-4">
            {todayAttendance.attendance?.check_in_time ? (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
                <span className="text-sm">Checked in at </span>
                <span className="font-semibold">
                  {format(new Date(todayAttendance.attendance.check_in_time), 'hh:mm a')}
                </span>
              </div>
            ) : (
              <div className="bg-yellow-500/20 backdrop-blur-sm rounded-lg px-4 py-2">
                <span className="text-sm">You haven't checked in today</span>
              </div>
            )}
            {todayAttendance.attendance?.check_out_time && (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2">
                <span className="text-sm">Checked out at </span>
                <span className="font-semibold">
                  {format(new Date(todayAttendance.attendance.check_out_time), 'hh:mm a')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      {(isAdmin || isHR || isManager || isGM) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="card flex items-center gap-4">
              <div className={clsx("p-3 rounded-lg", stat.bg)}>
                <stat.icon className={clsx("w-6 h-6", stat.color)} />
              </div>
              <div>
                <p className="text-sm text-gray-500">{stat.title}</p>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Overview Chart */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">This Month's Overview</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Attendance Distribution */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Attendance Distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={monthlyData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {monthlyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-4">
            {monthlyData.map((item, index) => (
              <div key={item.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }}></div>
                <span className="text-sm text-gray-600">{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Leave Requests - For Managers */}
        {(isManager || isAdmin) && pendingLeaves && pendingLeaves.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Pending Leave Requests</h2>
              <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-medium">
                {pendingLeaves.length} pending
              </span>
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {pendingLeaves.slice(0, 5).map((leave) => (
                <div key={leave.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{leave.employee_name}</p>
                    <p className="text-sm text-gray-500">
                      {leave.leave_type} • {leave.total_days} day(s)
                    </p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(leave.start_date), 'MMM d')} - {format(new Date(leave.end_date), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <span className={getStatusBadge('PENDING')}>Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Attendance */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {dashboardData?.recent_records?.slice(0, 6).map((record, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{record.employee_name || `${record.first_name} ${record.last_name}`}</p>
                  <p className="text-sm text-gray-500">
                    {format(new Date(record.date), 'MMM d, yyyy')}
                  </p>
                </div>
                <span className={getStatusBadge(record.status)}>{record.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Holidays */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-5 h-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Holidays</h2>
          </div>
          <div className="space-y-3">
            {upcomingHolidays?.slice(0, 5).map((holiday) => (
              <div key={holiday.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{holiday.name}</p>
                  <p className="text-sm text-gray-500">
                    {format(new Date(holiday.date), 'EEEE, MMMM d, yyyy')}
                  </p>
                </div>
                {holiday.is_optional && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                    Optional
                  </span>
                )}
              </div>
            ))}
            {(!upcomingHolidays || upcomingHolidays.length === 0) && (
              <p className="text-gray-500 text-sm text-center py-4">No upcoming holidays</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
