import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { leaveAPI } from '../services/api'
import { 
  Calendar, Plus, CheckCircle, XCircle, Clock, 
  AlertCircle, FileText, Filter, ChevronDown 
} from 'lucide-react'
import { format, differenceInDays, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const LeaveManagement = () => {
  const { user, isAdmin, isHR, isManager, canManageEmployees } = useAuth()
  const queryClient = useQueryClient()
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [activeTab, setActiveTab] = useState('my-leaves')
  const [filterStatus, setFilterStatus] = useState('all')

  // Form state
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'CASUAL',
    start_date: '',
    end_date: '',
    reason: ''
  })

  // Fetch leave balance
  const { data: balanceData } = useQuery({
    queryKey: ['leave-balance'],
    queryFn: async () => {
      const response = await leaveAPI.getBalance('me')
      return response.data.data
    }
  })

  // Fetch my leave requests
  const { data: myLeavesResponse, isLoading: myLeavesLoading } = useQuery({
    queryKey: ['my-leaves', filterStatus],
    queryFn: async () => {
      const params = filterStatus !== 'all' ? { status: filterStatus } : {}
      const response = await leaveAPI.getMyLeaves(params)
      return response.data.data
    }
  })

  // Extract requests array from response
  const myLeavesData = myLeavesResponse?.requests || []

  // Fetch pending leaves for approval (managers/HR/Admin)
  const { data: pendingLeavesData, isLoading: pendingLoading } = useQuery({
    queryKey: ['pending-leaves'],
    queryFn: async () => {
      const response = await leaveAPI.getPendingApprovals()
      return response.data.data
    },
    enabled: canManageEmployees
  })

  // Apply leave mutation
  const applyLeaveMutation = useMutation({
    mutationFn: (data) => leaveAPI.apply(data),
    onSuccess: () => {
      toast.success('Leave request submitted successfully!')
      setShowApplyModal(false)
      setLeaveForm({ leave_type: 'CASUAL', start_date: '', end_date: '', reason: '' })
      queryClient.invalidateQueries(['my-leaves'])
      queryClient.invalidateQueries(['leave-balance'])
    },
    onError: (error) => {
      const errorMsg = error.response?.data?.errors?.[0]?.msg || 
                       error.response?.data?.error || 
                       'Failed to submit leave request'
      toast.error(errorMsg)
    }
  })

  // Approve/Reject mutation
  const actionMutation = useMutation({
    mutationFn: ({ id, action, comments }) => {
      if (action === 'approve') {
        return leaveAPI.approve(id, { status: 'APPROVED' })
      } else {
        return leaveAPI.approve(id, { status: 'REJECTED', rejection_reason: comments })
      }
    },
    onSuccess: (_, { action }) => {
      toast.success(`Leave request ${action}d successfully!`)
      queryClient.invalidateQueries(['pending-leaves'])
      queryClient.invalidateQueries(['my-leaves'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Action failed')
    }
  })

  // Cancel leave mutation
  const cancelMutation = useMutation({
    mutationFn: (id) => leaveAPI.cancel(id),
    onSuccess: () => {
      toast.success('Leave request cancelled!')
      queryClient.invalidateQueries(['my-leaves'])
      queryClient.invalidateQueries(['leave-balance'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to cancel leave')
    }
  })

  const handleApplyLeave = (e) => {
    e.preventDefault()
    applyLeaveMutation.mutate(leaveForm)
  }

  const handleAction = (id, action) => {
    const comments = prompt(`Enter comments for ${action}ing this leave:`)
    if (comments !== null) {
      actionMutation.mutate({ id, action, comments })
    }
  }

  const getStatusBadge = (status) => {
    const config = {
      PENDING: { class: 'bg-yellow-100 text-yellow-800', icon: Clock },
      APPROVED: { class: 'bg-green-100 text-green-800', icon: CheckCircle },
      REJECTED: { class: 'bg-red-100 text-red-800', icon: XCircle },
      CANCELLED: { class: 'bg-gray-100 text-gray-800', icon: AlertCircle }
    }
    return config[status] || config.PENDING
  }

  const leaveTypeColors = {
    CASUAL: 'bg-blue-100 text-blue-800',
    SICK: 'bg-red-100 text-red-800',
    PAID: 'bg-green-100 text-green-800',
    EARNED: 'bg-green-100 text-green-800',
    MATERNITY: 'bg-pink-100 text-pink-800',
    PATERNITY: 'bg-purple-100 text-purple-800',
    COMPENSATORY: 'bg-orange-100 text-orange-800',
    UNPAID: 'bg-gray-100 text-gray-800'
  }

  const calculateDays = (start, end) => {
    if (!start || !end) return 0
    return differenceInDays(parseISO(end), parseISO(start)) + 1
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
          <p className="text-gray-500">Manage your leaves and approvals</p>
        </div>
        <button 
          onClick={() => setShowApplyModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Apply Leave
        </button>
      </div>

      {/* Leave Balance Cards */}
      {balanceData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <p className={clsx("text-xs font-medium px-2 py-1 rounded-full inline-block mb-2", leaveTypeColors['CASUAL'])}>
              Casual Leave
            </p>
            <p className="text-2xl font-bold text-gray-900">{balanceData.casual_available || 0}</p>
            <p className="text-xs text-gray-500">of {balanceData.casual_total || 12} days</p>
          </div>
          <div className="card text-center">
            <p className={clsx("text-xs font-medium px-2 py-1 rounded-full inline-block mb-2", leaveTypeColors['SICK'])}>
              Sick Leave
            </p>
            <p className="text-2xl font-bold text-gray-900">{balanceData.sick_available || 0}</p>
            <p className="text-xs text-gray-500">of {balanceData.sick_total || 12} days</p>
          </div>
          <div className="card text-center">
            <p className={clsx("text-xs font-medium px-2 py-1 rounded-full inline-block mb-2", leaveTypeColors['PAID'])}>
              Paid Leave
            </p>
            <p className="text-2xl font-bold text-gray-900">{balanceData.paid_available || 0}</p>
            <p className="text-xs text-gray-500">of {balanceData.paid_total || 15} days</p>
          </div>
          <div className="card text-center">
            <p className={clsx("text-xs font-medium px-2 py-1 rounded-full inline-block mb-2", leaveTypeColors['UNPAID'] || 'bg-gray-100 text-gray-800')}>
              Unpaid Leave
            </p>
            <p className="text-2xl font-bold text-gray-900">{balanceData.unpaid_used || 0}</p>
            <p className="text-xs text-gray-500">days used</p>
          </div>
        </div>
      )}

      {/* Tabs for managers/HR/Admin */}
      {canManageEmployees && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-4">
            <button
              onClick={() => setActiveTab('my-leaves')}
              className={clsx(
                "py-2 px-1 border-b-2 font-medium text-sm transition-colors",
                activeTab === 'my-leaves'
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              My Leaves
            </button>
            <button
              onClick={() => setActiveTab('pending-approvals')}
              className={clsx(
                "py-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2",
                activeTab === 'pending-approvals'
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              Pending Approvals
              {pendingLeavesData?.length > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {pendingLeavesData.length}
                </span>
              )}
            </button>
          </nav>
        </div>
      )}

      {/* My Leaves Table */}
      {activeTab === 'my-leaves' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">My Leave Requests</h2>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="input-field w-auto text-sm"
              >
                <option value="all">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {myLeavesLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Type</th>
                    <th className="table-header">Dates</th>
                    <th className="table-header">Days</th>
                    <th className="table-header">Reason</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {myLeavesData?.map((leave) => {
                    const statusConfig = getStatusBadge(leave.status)
                    const StatusIcon = statusConfig.icon
                    const days = calculateDays(leave.start_date, leave.end_date)
                    return (
                      <tr key={leave.id} className="hover:bg-gray-50">
                        <td className="table-cell">
                          <span className={clsx("text-xs font-medium px-2 py-1 rounded-full", leaveTypeColors[leave.leave_type])}>
                            {leave.leave_type}
                          </span>
                        </td>
                        <td className="table-cell">
                          <div>
                            <p className="font-medium">{format(parseISO(leave.start_date), 'MMM d, yyyy')}</p>
                            {leave.start_date !== leave.end_date && (
                              <p className="text-sm text-gray-500">to {format(parseISO(leave.end_date), 'MMM d, yyyy')}</p>
                            )}
                          </div>
                        </td>
                        <td className="table-cell font-medium">{days} {days === 1 ? 'day' : 'days'}</td>
                        <td className="table-cell max-w-xs truncate" title={leave.reason}>
                          {leave.reason}
                        </td>
                        <td className="table-cell">
                          <span className={clsx("status-badge inline-flex items-center gap-1", statusConfig.class)}>
                            <StatusIcon className="w-3 h-3" />
                            {leave.status}
                          </span>
                        </td>
                        <td className="table-cell">
                          {leave.status === 'PENDING' && (
                            <button
                              onClick={() => {
                                if (confirm('Are you sure you want to cancel this leave request?')) {
                                  cancelMutation.mutate(leave.id)
                                }
                              }}
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {(!myLeavesData || myLeavesData.length === 0) && (
                    <tr>
                      <td colSpan="6" className="table-cell text-center text-gray-500 py-8">
                        No leave requests found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pending Approvals Table */}
      {activeTab === 'pending-approvals' && canManageEmployees && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Pending Approvals</h2>

          {pendingLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Employee</th>
                    <th className="table-header">Type</th>
                    <th className="table-header">Dates</th>
                    <th className="table-header">Days</th>
                    <th className="table-header">Reason</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pendingLeavesData?.map((leave) => {
                    const days = calculateDays(leave.start_date, leave.end_date)
                    return (
                      <tr key={leave.id} className="hover:bg-gray-50">
                        <td className="table-cell">
                          <div>
                            <p className="font-medium">{leave.employee_name}</p>
                            <p className="text-sm text-gray-500">{leave.department}</p>
                          </div>
                        </td>
                        <td className="table-cell">
                          <span className={clsx("text-xs font-medium px-2 py-1 rounded-full", leaveTypeColors[leave.leave_type])}>
                            {leave.leave_type}
                          </span>
                        </td>
                        <td className="table-cell">
                          <div>
                            <p className="font-medium">{format(parseISO(leave.start_date), 'MMM d, yyyy')}</p>
                            {leave.start_date !== leave.end_date && (
                              <p className="text-sm text-gray-500">to {format(parseISO(leave.end_date), 'MMM d, yyyy')}</p>
                            )}
                          </div>
                        </td>
                        <td className="table-cell font-medium">{days} {days === 1 ? 'day' : 'days'}</td>
                        <td className="table-cell max-w-xs truncate" title={leave.reason}>
                          {leave.reason}
                        </td>
                        <td className="table-cell">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAction(leave.id, 'approve')}
                              disabled={actionMutation.isPending}
                              className="text-green-600 hover:text-green-800 font-medium text-sm"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleAction(leave.id, 'reject')}
                              disabled={actionMutation.isPending}
                              className="text-red-600 hover:text-red-800 font-medium text-sm"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {(!pendingLeavesData || pendingLeavesData.length === 0) && (
                    <tr>
                      <td colSpan="6" className="table-cell text-center text-gray-500 py-8">
                        No pending leave requests
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Apply Leave Modal */}
      {showApplyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 animate-fadeIn">
            <h2 className="text-xl font-bold mb-4">Apply for Leave</h2>
            <form onSubmit={handleApplyLeave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Leave Type
                </label>
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                  className="input-field"
                  required
                >
                  <option value="CASUAL">Casual Leave</option>
                  <option value="SICK">Sick Leave</option>
                  <option value="EARNED">Earned Leave</option>
                  <option value="MATERNITY">Maternity Leave</option>
                  <option value="PATERNITY">Paternity Leave</option>
                  <option value="COMPENSATORY">Compensatory Off</option>
                  <option value="UNPAID">Unpaid Leave</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                    className="input-field"
                    required
                    min={format(new Date(), 'yyyy-MM-dd')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                    className="input-field"
                    required
                    min={leaveForm.start_date || format(new Date(), 'yyyy-MM-dd')}
                  />
                </div>
              </div>
              {leaveForm.start_date && leaveForm.end_date && (
                <p className="text-sm text-gray-600">
                  Total: <span className="font-medium">{calculateDays(leaveForm.start_date, leaveForm.end_date)} days</span>
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason
                </label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  className="input-field min-h-[100px]"
                  required
                  placeholder="Please provide a reason for your leave request"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApplyModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={applyLeaveMutation.isPending}
                  className="btn-primary flex-1"
                >
                  {applyLeaveMutation.isPending ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeaveManagement
