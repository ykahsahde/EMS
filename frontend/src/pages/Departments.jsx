import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { departmentAPI, usersAPI } from '../services/api'
import { 
  Building, Plus, Edit2, Trash2, Users, ChevronDown, ChevronRight, Crown, Star 
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Departments = () => {
  const { isAdmin, isHR } = useAuth()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState(null)
  const [expandedDepts, setExpandedDepts] = useState(new Set())

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    head_id: ''
  })

  // Fetch departments
  const { data: departments, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const response = await departmentAPI.getAll()
      return response.data.data
    }
  })

  // Fetch potential department heads (GM, managers/HR/Admin)
  const { data: potentialHeads } = useQuery({
    queryKey: ['potential-heads'],
    queryFn: async () => {
      const response = await usersAPI.getAll({ })
      // Filter to only GM, MANAGER, HR, ADMIN roles
      return response.data.data?.filter(u => 
        ['GM', 'MANAGER', 'HR', 'ADMIN'].includes(u.role)
      ) || []
    }
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data) => departmentAPI.create(data),
    onSuccess: () => {
      toast.success('Department created successfully!')
      setShowModal(false)
      resetForm()
      queryClient.invalidateQueries(['departments'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to create department')
    }
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => departmentAPI.update(id, data),
    onSuccess: () => {
      toast.success('Department updated successfully!')
      setShowModal(false)
      setEditingDepartment(null)
      resetForm()
      queryClient.invalidateQueries(['departments'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update department')
    }
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => departmentAPI.delete(id),
    onSuccess: () => {
      toast.success('Department deleted successfully!')
      queryClient.invalidateQueries(['departments'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete department')
    }
  })

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      head_id: ''
    })
  }

  const handleEdit = (department) => {
    setEditingDepartment(department)
    setFormData({
      name: department.name || '',
      code: department.code || '',
      description: department.description || '',
      head_id: department.head_id || ''
    })
    setShowModal(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const data = { ...formData }
    if (!data.head_id) delete data.head_id

    if (editingDepartment) {
      updateMutation.mutate({ id: editingDepartment.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (department) => {
    if (department.employee_count > 0) {
      toast.error('Cannot delete department with employees. Please reassign employees first.')
      return
    }
    if (confirm(`Are you sure you want to delete ${department.name}?`)) {
      deleteMutation.mutate(department.id)
    }
  }

  const toggleExpand = (deptId) => {
    setExpandedDepts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(deptId)) {
        newSet.delete(deptId)
      } else {
        newSet.add(deptId)
      }
      return newSet
    })
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Departments</h1>
          <p className="text-gray-500">Manage company departments</p>
        </div>
        {(isAdmin || isHR) && (
          <button 
            onClick={() => {
              setEditingDepartment(null)
              resetForm()
              setShowModal(true)
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Department
          </button>
        )}
      </div>

      {/* Department Stats */}
      {departments && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <Building className="w-8 h-8 mx-auto text-primary-600 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{departments.length}</p>
            <p className="text-sm text-gray-500">Total Departments</p>
          </div>
          <div className="card text-center">
            <Users className="w-8 h-8 mx-auto text-green-600 mb-2" />
            <p className="text-2xl font-bold text-gray-900">
              {departments.reduce((sum, dept) => sum + (dept.employee_count || 0), 0)}
            </p>
            <p className="text-sm text-gray-500">Total Employees</p>
          </div>
        </div>
      )}

      {/* Departments Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : departments?.length > 0 ? (
          departments.map((department) => (
            <div key={department.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-primary-100 flex items-center justify-center">
                    <Building className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{department.name}</h3>
                    <p className="text-sm text-gray-500">{department.code}</p>
                  </div>
                </div>
                {(isAdmin || isHR) && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(department)}
                      className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(department)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {department.description && (
                <p className="mt-3 text-sm text-gray-600 line-clamp-2">{department.description}</p>
              )}

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1 text-gray-500">
                    <Users className="w-4 h-4" />
                    <span>{department.employee_count || 0} employees</span>
                  </div>
                  {department.head_name && (
                    <div className="flex items-center gap-1 text-gray-600">
                      <Star className="w-4 h-4 text-amber-500" />
                      <span className="font-medium">{department.head_name}</span>
                      <span className="text-xs text-gray-400">(Manager)</span>
                    </div>
                  )}
                </div>
                {!department.head_name && (
                  <p className="text-xs text-amber-600 mt-2">No department manager assigned</p>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Building className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>No departments found</p>
            {(isAdmin || isHR) && (
              <button 
                onClick={() => setShowModal(true)}
                className="mt-2 text-primary-600 hover:text-primary-700 font-medium"
              >
                Add your first department
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Department Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 animate-fadeIn">
            <h2 className="text-xl font-bold mb-4">
              {editingDepartment ? 'Edit Department' : 'Add New Department'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  required
                  placeholder="e.g., Human Resources"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department Code *
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="input-field"
                  required
                  placeholder="e.g., HR"
                  maxLength={10}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field min-h-[80px]"
                  placeholder="Brief description of the department"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department Head / Manager
                </label>
                <select
                  value={formData.head_id}
                  onChange={(e) => setFormData({ ...formData, head_id: e.target.value })}
                  className="input-field"
                >
                  <option value="">Select Department Head/Manager</option>
                  {potentialHeads?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.first_name} {user.last_name} ({user.role === 'GM' ? 'Director/GM' : user.role})
                      {user.department_name ? ` - ${user.department_name}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Assign a GM, Manager, HR, or Admin as department head
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingDepartment(null)
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
                    : editingDepartment ? 'Update' : 'Create'
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

export default Departments
