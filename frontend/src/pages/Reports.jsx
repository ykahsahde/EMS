import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { reportAPI } from '../services/api'
import { 
  FileText, Download, Calendar, Users, Filter, 
  FileSpreadsheet, Table, RefreshCw, ExternalLink 
} from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Reports = () => {
  const { isAdmin, isHR, isManager } = useAuth()
  const [activeTab, setActiveTab] = useState('attendance')
  const [dateRange, setDateRange] = useState({
    start_date: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end_date: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  })
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [exportFormat, setExportFormat] = useState('excel')

  // Quick date range presets
  const datePresets = [
    { label: 'Today', getValue: () => ({ start_date: format(new Date(), 'yyyy-MM-dd'), end_date: format(new Date(), 'yyyy-MM-dd') }) },
    { label: 'Last 7 Days', getValue: () => ({ start_date: format(subDays(new Date(), 7), 'yyyy-MM-dd'), end_date: format(new Date(), 'yyyy-MM-dd') }) },
    { label: 'This Month', getValue: () => ({ start_date: format(startOfMonth(new Date()), 'yyyy-MM-dd'), end_date: format(endOfMonth(new Date()), 'yyyy-MM-dd') }) },
    { label: 'Last Month', getValue: () => {
      const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1))
      return { start_date: format(startOfMonth(lastMonth), 'yyyy-MM-dd'), end_date: format(endOfMonth(lastMonth), 'yyyy-MM-dd') }
    }}
  ]

  // Export mutations
  const exportAttendanceMutation = useMutation({
    mutationFn: async () => {
      const params = {
        ...dateRange,
        format: exportFormat,
        department_id: selectedDepartment || undefined
      }
      const response = await reportAPI.attendance(params)
      return response.data
    },
    onSuccess: (data) => {
      // Create download link
      const blob = new Blob([data], { 
        type: exportFormat === 'excel' 
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          : 'application/pdf' 
      })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `attendance_report_${format(new Date(), 'yyyy-MM-dd')}.${exportFormat === 'excel' ? 'xlsx' : 'pdf'}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Report downloaded successfully!')
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to generate report')
    }
  })

  const exportLeavesMutation = useMutation({
    mutationFn: async () => {
      const params = {
        ...dateRange,
        format: exportFormat,
        department_id: selectedDepartment || undefined
      }
      const response = await reportAPI.leaves(params)
      return response.data
    },
    onSuccess: (data) => {
      const blob = new Blob([data], { 
        type: exportFormat === 'excel' 
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          : 'application/pdf' 
      })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `leave_report_${format(new Date(), 'yyyy-MM-dd')}.${exportFormat === 'excel' ? 'xlsx' : 'pdf'}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Report downloaded successfully!')
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to generate report')
    }
  })

  const exportMonthlySummaryMutation = useMutation({
    mutationFn: async () => {
      const [year, month] = dateRange.start_date.split('-')
      const params = {
        year: parseInt(year),
        month: parseInt(month),
        format: exportFormat,
        department_id: selectedDepartment || undefined
      }
      const response = await reportAPI.summary(params)
      return response.data
    },
    onSuccess: (data) => {
      const blob = new Blob([data], { 
        type: exportFormat === 'excel' 
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          : 'application/pdf' 
      })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `monthly_summary_${format(new Date(), 'yyyy-MM-dd')}.${exportFormat === 'excel' ? 'xlsx' : 'pdf'}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Report downloaded successfully!')
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to generate report')
    }
  })

  const handleExport = () => {
    switch (activeTab) {
      case 'attendance':
        exportAttendanceMutation.mutate()
        break
      case 'leaves':
        exportLeavesMutation.mutate()
        break
      case 'summary':
        exportMonthlySummaryMutation.mutate()
        break
    }
  }

  const isExporting = exportAttendanceMutation.isPending || 
                      exportLeavesMutation.isPending || 
                      exportMonthlySummaryMutation.isPending

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500">Generate and export attendance reports</p>
        </div>
      </div>

      {/* Report Type Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4">
          {[
            { id: 'attendance', label: 'Attendance Report', icon: Calendar },
            { id: 'leaves', label: 'Leave Report', icon: FileText },
            { id: 'summary', label: 'Monthly Summary', icon: Table }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2",
                activeTab === tab.id
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters Card */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Filter className="w-5 h-5" />
          Report Filters
        </h3>

        {/* Date Range Presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {datePresets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setDateRange(preset.getValue())}
              className="px-3 py-1.5 text-sm rounded-full border border-gray-300 hover:border-primary-500 hover:text-primary-600 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={dateRange.start_date}
              onChange={(e) => setDateRange({ ...dateRange, start_date: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={dateRange.end_date}
              onChange={(e) => setDateRange({ ...dateRange, end_date: e.target.value })}
              className="input-field"
              min={dateRange.start_date}
            />
          </div>
          {(isAdmin || isHR) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="input-field"
              >
                <option value="">All Departments</option>
                {/* Departments would be fetched and mapped here */}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Export Format</label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="input-field"
            >
              <option value="excel">Excel (.xlsx)</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
        </div>
      </div>

      {/* Report Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Download Report Card */}
        <div className="card">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
              <Download className="w-6 h-6 text-primary-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">Download Report</h3>
              <p className="text-sm text-gray-500 mt-1">
                Generate and download {activeTab === 'attendance' ? 'attendance' : activeTab === 'leaves' ? 'leave' : 'monthly summary'} report 
                in {exportFormat.toUpperCase()} format
              </p>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="btn-primary mt-4 flex items-center gap-2"
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download {exportFormat.toUpperCase()}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Report Preview Info */}
      <div className="card bg-gray-50">
        <h3 className="font-semibold text-gray-900 mb-3">Report Contents</h3>
        {activeTab === 'attendance' && (
          <ul className="text-sm text-gray-600 space-y-2">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Employee details (ID, Name, Department, Shift)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Daily check-in and check-out times
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Attendance status (Present, Absent, Late, Half-day, On Leave)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Total working hours per day
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Face verification status
            </li>
          </ul>
        )}
        {activeTab === 'leaves' && (
          <ul className="text-sm text-gray-600 space-y-2">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Employee leave applications
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Leave type and duration
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Approval status and approver details
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Leave balance summary
            </li>
          </ul>
        )}
        {activeTab === 'summary' && (
          <ul className="text-sm text-gray-600 space-y-2">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Monthly attendance summary per employee
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Total present/absent/late days
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Total working hours for payroll
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Overtime hours calculation
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              Department-wise breakdown
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}

export default Reports
