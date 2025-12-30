import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { usersAPI, departmentAPI, shiftAPI } from '../services/api'
import { 
  Users, Plus, Search, Filter, Edit2, Trash2, 
  Mail, Phone, Building, UserCheck, UserX, Eye, Crown, Shield, Star
} from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Employees = () => {
  const { user, isAdmin, isHR, isGM, isManager, canManageEmployees } = useAuth()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [nextEmployeeId, setNextEmployeeId] = useState('')

  // Form state - default joining_date to today
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    phone: '',
    role: 'EMPLOYEE',
    department_id: '',
    shift_id: '',
    manager_id: '',
    joining_date: format(new Date(), 'yyyy-MM-dd')
  })

  // Fetch employees
  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['employees', searchQuery, filterDepartment, filterRole, filterStatus],
    queryFn: async () => {
      const params = {}
      if (searchQuery) params.search = searchQuery
      if (filterDepartment) params.department_id = filterDepartment
      if (filterRole) params.role = filterRole
      if (filterStatus) params.status = filterStatus
      const response = await usersAPI.getAll(params)
      return response.data.data
    }
  })

  // Fetch organization hierarchy (GM and department managers)
  const { data: orgHierarchy } = useQuery({
    queryKey: ['organization-hierarchy'],
    queryFn: async () => {
      const response = await usersAPI.getOrganizationHierarchy()
      return response.data.data
    }
  })

  // Fetch departments for dropdown
  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const response = await departmentAPI.getAll()
      return response.data.data
    }
  })

  // Fetch shifts for dropdown
  const { data: shifts } = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => {
      const response = await shiftAPI.getAll()
      return response.data.data
    }
  })

  // Create user mutation
  const createMutation = useMutation({
    mutationFn: (data) => usersAPI.create(data),
    onSuccess: () => {
      toast.success('Employee created successfully!')
      setShowModal(false)
      resetForm()
      queryClient.invalidateQueries(['employees'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to create employee')
    }
  })

  // Update user mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => usersAPI.update(id, data),
    onSuccess: () => {
      toast.success('Employee updated successfully!')
      setShowModal(false)
      setEditingUser(null)
      resetForm()
      queryClient.invalidateQueries(['employees'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update employee')
    }
  })

  // Delete user mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => usersAPI.delete(id),
    onSuccess: () => {
      toast.success('Employee deleted successfully!')
      queryClient.invalidateQueries(['employees'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete employee')
    }
  })

  // Toggle status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, is_active }) => usersAPI.update(id, { is_active }),
    onSuccess: (_, { is_active }) => {
      toast.success(`Employee ${is_active ? 'activated' : 'deactivated'} successfully!`)
      queryClient.invalidateQueries(['employees'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update status')
    }
  })

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      phone: '',
      role: 'EMPLOYEE',
      department_id: '',
      shift_id: '',
      manager_id: '',
      joining_date: format(new Date(), 'yyyy-MM-dd')
    })
    setNextEmployeeId('')
  }

  const handleEdit = (employee) => {
    setEditingUser(employee)
    setFormData({
      email: employee.email || '',
      password: '',
      first_name: employee.first_name || '',
      last_name: employee.last_name || '',
      phone: employee.phone || '',
      role: employee.role || 'EMPLOYEE',
      department_id: employee.department_id || '',
      shift_id: employee.shift_id || '',
      manager_id: employee.manager_id || '',
      joining_date: employee.joining_date ? format(new Date(employee.joining_date), 'yyyy-MM-dd') : ''
    })
    setNextEmployeeId(employee.employee_id || '')
    setShowModal(true)
  }

  // Fetch next employee ID when department changes
  const fetchNextEmployeeId = async (departmentId) => {
    if (!departmentId || editingUser) {
      setNextEmployeeId('')
      return
    }
    try {
      const response = await usersAPI.getNextEmployeeId(departmentId)
      setNextEmployeeId(response.data.data.next_employee_id)
    } catch (error) {
      console.error('Failed to fetch next employee ID:', error)
      setNextEmployeeId('')
    }
  }

  // Handle department change
  const handleDepartmentChange = (e) => {
    const departmentId = e.target.value
    setFormData({ ...formData, department_id: departmentId })
    fetchNextEmployeeId(departmentId)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const data = { ...formData }
    if (!data.password) delete data.password
    if (!data.department_id) delete data.department_id
    if (!data.shift_id) delete data.shift_id
    if (!data.manager_id) delete data.manager_id

    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (employee) => {
    if (confirm(`Are you sure you want to delete ${employee.first_name} ${employee.last_name}?`)) {
      deleteMutation.mutate(employee.id)
    }
  }

  const getRoleBadgeClass = (role) => {
    const roleClasses = {
      ADMIN: 'bg-purple-100 text-purple-800',
      GM: 'bg-amber-100 text-amber-800 border border-amber-300',
      HR: 'bg-blue-100 text-blue-800',
      MANAGER: 'bg-green-100 text-green-800',
      EMPLOYEE: 'bg-gray-100 text-gray-800'
    }
    return roleClasses[role] || roleClasses.EMPLOYEE
  }

  const getRoleDisplayName = (role) => {
    const roleNames = {
      ADMIN: 'Admin',
      GM: 'Director (GM)',
      HR: 'HR',
      MANAGER: 'Dept. Manager',
      EMPLOYEE: 'Employee'
    }
    return roleNames[role] || role
  }

  const getRoleIcon = (role) => {
    switch(role) {
      case 'GM': return <Crown className="w-3 h-3" />
      case 'ADMIN': return <Shield className="w-3 h-3" />
      case 'MANAGER': return <Star className="w-3 h-3" />
      default: return null
    }
  }

  // Get all potential managers (GM, Managers, Admin, HR)
  const allManagers = employeesData?.filter(emp => 
    emp.role === 'GM' || emp.role === 'ADMIN' || emp.role === 'HR' || emp.role === 'MANAGER'
  ) || []

  // Get department-wise managers - filter by selected department
  const departmentManagers = formData.department_id 
    ? allManagers.filter(mgr => 
        mgr.role === 'GM' || // GM manages all departments
        mgr.department_id === formData.department_id || // Same department managers
        mgr.role === 'HR' // HR can be manager too
      )
    : allManagers

  // Legacy compatibility
  const managers = allManagers

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Organization Hierarchy Card - Show GM as Director */}
      {orgHierarchy?.director && (
        <div className="card bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center border-2 border-amber-300">
              <Crown className="w-8 h-8 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-amber-900">{orgHierarchy.director.full_name}</h3>
                <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-medium rounded-full">
                  Director / General Manager
                </span>
              </div>
              <p className="text-amber-700 text-sm mt-1">Company Director - Oversees all departments</p>
              <div className="flex items-center gap-4 mt-2 text-sm text-amber-600">
                <span className="flex items-center gap-1">
                  <Mail className="w-4 h-4" />
                  {orgHierarchy.director.email}
                </span>
                {orgHierarchy.director.department_name && (
                  <span className="flex items-center gap-1">
                    <Building className="w-4 h-4" />
                    {orgHierarchy.director.department_name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500">
            {isManager && !isAdmin && !isHR && !isGM 
              ? `Manage employees in your department` 
              : 'Manage employee records across all departments'}
          </p>
        </div>
        {canManageEmployees && (
          <button 
            onClick={() => {
              setEditingUser(null)
              resetForm()
              setNextEmployeeId('')
              // If manager with fixed department, auto-fetch next employee ID
              if (isManager && !isAdmin && !isHR && !isGM && user?.department_id) {
                fetchNextEmployeeId(user.department_id)
              }
              setShowModal(true)
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Employee
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, or employee ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-10"
            />
          </div>
          <select
            value={filterDepartment}
            onChange={(e) => setFilterDepartment(e.target.value)}
            className="input-field w-auto"
          >
            <option value="">All Departments</option>
            {departments?.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="input-field w-auto"
          >
            <option value="">All Roles</option>
            <option value="ADMIN">Admin</option>
            <option value="GM">General Manager</option>
            <option value="HR">HR</option>
            <option value="MANAGER">Manager</option>
            <option value="EMPLOYEE">Employee</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-field w-auto"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Employees Table */}
      <div className="card">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Contact</th>
                  <th className="table-header">Department</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Joined</th>
                  {canManageEmployees && <th className="table-header">Actions</th>}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {employeesData?.map((employee) => (
                  <tr key={employee.id} className="hover:bg-gray-50">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className={clsx(
                          "w-10 h-10 rounded-full flex items-center justify-center",
                          employee.role === 'GM' ? 'bg-amber-100 border-2 border-amber-300' : 'bg-primary-100'
                        )}>
                          {employee.role === 'GM' ? (
                            <Crown className="w-5 h-5 text-amber-600" />
                          ) : (
                            <span className="text-primary-700 font-medium">
                              {employee.first_name?.charAt(0)}{employee.last_name?.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {employee.first_name} {employee.last_name}
                            {employee.role === 'GM' && <span className="ml-2 text-xs text-amber-600">(Director)</span>}
                          </p>
                          <p className="text-sm text-gray-500">{employee.employee_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="space-y-1">
                        <p className="flex items-center gap-1 text-sm">
                          <Mail className="w-4 h-4 text-gray-400" />
                          {employee.email}
                        </p>
                        {employee.phone && (
                          <p className="flex items-center gap-1 text-sm text-gray-500">
                            <Phone className="w-4 h-4 text-gray-400" />
                            {employee.phone}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <Building className="w-4 h-4 text-gray-400" />
                        {employee.department_name || '-'}
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className={clsx("status-badge inline-flex items-center gap-1", getRoleBadgeClass(employee.role))}>
                        {getRoleIcon(employee.role)}
                        {getRoleDisplayName(employee.role)}
                      </span>
                    </td>
                    <td className="table-cell">
                      {employee.is_active ? (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <UserCheck className="w-4 h-4" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600">
                          <UserX className="w-4 h-4" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      {employee.joining_date 
                        ? format(new Date(employee.joining_date), 'MMM d, yyyy')
                        : '-'
                      }
                    </td>
                    {canManageEmployees && (
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {/* Edit button - Admin, HR, GM can edit anyone; Manager can edit employees in their dept */}
                          {(isAdmin || isHR || isGM || (isManager && employee.role === 'EMPLOYEE' && employee.department_id === user?.department_id)) && (
                            <button
                              onClick={() => handleEdit(employee)}
                              className="p-1 text-gray-500 hover:text-primary-600"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {/* Deactivate button - Cannot deactivate GM */}
                          {employee.role !== 'GM' && (isAdmin || isHR || isGM || (isManager && employee.role === 'EMPLOYEE' && employee.department_id === user?.department_id)) && (
                            <button
                              onClick={() => toggleStatusMutation.mutate({ 
                                id: employee.id, 
                                is_active: !employee.is_active 
                              })}
                              className={clsx(
                                "p-1",
                                employee.is_active 
                                  ? "text-gray-500 hover:text-red-600" 
                                  : "text-gray-500 hover:text-green-600"
                              )}
                              title={employee.is_active ? 'Deactivate' : 'Activate'}
                            >
                              {employee.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </button>
                          )}
                          {/* Delete button - Admin can delete anyone except GM; Manager can delete employees in their dept */}
                          {employee.id !== user.id && employee.role !== 'GM' && (
                            (isAdmin || isGM || (isManager && employee.role === 'EMPLOYEE' && employee.department_id === user?.department_id))
                          ) && (
                            <button
                              onClick={() => handleDelete(employee)}
                              className="p-1 text-gray-500 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(!employeesData || employeesData.length === 0) && (
                  <tr>
                    <td colSpan={canManageEmployees ? 7 : 6} className="table-cell text-center text-gray-500 py-8">
                      {isManager && !isAdmin && !isHR && !isGM 
                        ? 'No employees found in your department'
                        : 'No employees found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Employee Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 animate-fadeIn">
            <h2 className="text-xl font-bold mb-4">
              {editingUser ? 'Edit Employee' : 'Add New Employee'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Employee ID - Auto-generated */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Employee ID
                    {!editingUser && <span className="text-xs text-blue-600 ml-2">(Auto-generated)</span>}
                  </label>
                  <input
                    type="text"
                    value={nextEmployeeId || (editingUser ? editingUser.employee_id : 'Select department first')}
                    className="input-field bg-gray-100"
                    disabled
                    placeholder="Select department to generate ID"
                  />
                  {!editingUser && !nextEmployeeId && formData.department_id && (
                    <p className="text-xs text-gray-500 mt-1">Generating ID...</p>
                  )}
                  {!editingUser && nextEmployeeId && (
                    <p className="text-xs text-green-600 mt-1">ID will be: {nextEmployeeId}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => {
                      const firstName = e.target.value
                      const autoEmail = firstName && formData.last_name 
                        ? `${firstName.toLowerCase()}.${formData.last_name.toLowerCase()}@raymond.com`
                        : formData.email
                      setFormData({ 
                        ...formData, 
                        first_name: firstName,
                        email: editingUser ? formData.email : autoEmail
                      })
                    }}
                    className="input-field"
                    required
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => {
                      const lastName = e.target.value
                      const autoEmail = formData.first_name && lastName 
                        ? `${formData.first_name.toLowerCase()}.${lastName.toLowerCase()}@raymond.com`
                        : formData.email
                      setFormData({ 
                        ...formData, 
                        last_name: lastName,
                        email: editingUser ? formData.email : autoEmail
                      })
                    }}
                    className="input-field"
                    required
                    placeholder="Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email * <span className="text-xs text-gray-500">(auto-generated)</span>
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="input-field"
                    required
                    placeholder="firstname.lastname@raymond.com"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Email is auto-generated from name. You can edit if needed.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password {editingUser ? '(leave blank to keep current)' : '*'}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="input-field"
                    required={!editingUser}
                    placeholder="********"
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="input-field"
                    placeholder="+91 9876543210"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role *
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="input-field"
                    required
                    disabled={isManager && !isAdmin && !isHR && !isGM}
                  >
                    <option value="EMPLOYEE">Employee</option>
                    {(isAdmin || isHR || isGM) && <option value="MANAGER">Department Manager</option>}
                    {(isAdmin || isGM) && <option value="GM">General Manager (GM) - Director</option>}
                    {(isAdmin || isGM) && <option value="HR">HR</option>}
                    {isAdmin && <option value="ADMIN">Admin</option>}
                  </select>
                  {isManager && !isAdmin && !isHR && !isGM && (
                    <p className="text-xs text-gray-500 mt-1">As a department manager, you can only add employees</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Department * {isManager && !isAdmin && !isHR && !isGM && <span className="text-xs text-gray-500">(Your department)</span>}
                  </label>
                  <select
                    value={isManager && !isAdmin && !isHR && !isGM ? user?.department_id : formData.department_id}
                    onChange={handleDepartmentChange}
                    className="input-field"
                    disabled={isManager && !isAdmin && !isHR && !isGM}
                    required
                  >
                    <option value="">Select Department</option>
                    {departments?.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                  {isManager && !isAdmin && !isHR && !isGM && (
                    <p className="text-xs text-gray-500 mt-1">Employees will be added to your department</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Shift
                  </label>
                  <select
                    value={formData.shift_id}
                    onChange={(e) => setFormData({ ...formData, shift_id: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select Shift</option>
                    {shifts?.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.name} ({shift.start_time} - {shift.end_time})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reporting Manager
                  </label>
                  <select
                    value={formData.manager_id}
                    onChange={(e) => setFormData({ ...formData, manager_id: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select Manager</option>
                    {departmentManagers.map((mgr) => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.first_name} {mgr.last_name} ({mgr.role === 'GM' ? 'General Manager' : mgr.role}){mgr.department_name ? ` - ${mgr.department_name}` : ''}
                      </option>
                    ))}
                  </select>
                  {formData.department_id && departmentManagers.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">No managers found for this department. Consider adding a GM or Department Manager first.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Joining Date
                  </label>
                  <input
                    type="date"
                    value={formData.joining_date}
                    onChange={(e) => setFormData({ ...formData, joining_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingUser(null)
                    resetForm()
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn-primary flex-1"
                >
                  {(createMutation.isPending || updateMutation.isPending) 
                    ? 'Saving...' 
                    : editingUser ? 'Update Employee' : 'Add Employee'
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Employees
