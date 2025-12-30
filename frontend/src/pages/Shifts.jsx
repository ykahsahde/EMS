import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { shiftAPI } from '../services/api'
import { 
  Clock, Plus, Edit2, Trash2, Sun, Moon, Sunset, Users 
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Shifts = () => {
  const { isAdmin, isHR } = useAuth()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingShift, setEditingShift] = useState(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    start_time: '09:00',
    end_time: '18:00',
    grace_period_minutes: 15,
    half_day_hours: 4,
    is_night_shift: false
  })

  // Fetch shifts
  const { data: shifts, isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => {
      const response = await shiftAPI.getAll()
      return response.data.data
    }
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data) => shiftAPI.create(data),
    onSuccess: () => {
      toast.success('Shift created successfully!')
      setShowModal(false)
      resetForm()
      queryClient.invalidateQueries(['shifts'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to create shift')
    }
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => shiftAPI.update(id, data),
    onSuccess: () => {
      toast.success('Shift updated successfully!')
      setShowModal(false)
      setEditingShift(null)
      resetForm()
      queryClient.invalidateQueries(['shifts'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update shift')
    }
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => shiftAPI.delete(id),
    onSuccess: () => {
      toast.success('Shift deleted successfully!')
      queryClient.invalidateQueries(['shifts'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete shift')
    }
  })

  const resetForm = () => {
    setFormData({
      name: '',
      start_time: '09:00',
      end_time: '18:00',
      grace_period_minutes: 15,
      half_day_hours: 4,
      is_night_shift: false
    })
  }

  const handleEdit = (shift) => {
    setEditingShift(shift)
    setFormData({
      name: shift.name || '',
      start_time: shift.start_time || '09:00',
      end_time: shift.end_time || '18:00',
      grace_period_minutes: shift.grace_period_minutes || 15,
      half_day_hours: shift.half_day_hours || 4,
      is_night_shift: shift.is_night_shift || false
    })
    setShowModal(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editingShift) {
      updateMutation.mutate({ id: editingShift.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleDelete = (shift) => {
    if (shift.employee_count > 0) {
      toast.error('Cannot delete shift with assigned employees. Please reassign employees first.')
      return
    }
    if (confirm(`Are you sure you want to delete ${shift.name}?`)) {
      deleteMutation.mutate(shift.id)
    }
  }

  const getShiftIcon = (shift) => {
    if (shift.is_night_shift) return Moon
    const startHour = parseInt(shift.start_time?.split(':')[0] || 9)
    if (startHour < 12) return Sun
    return Sunset
  }

  const calculateShiftDuration = (startTime, endTime, isNightShift) => {
    const [startHour, startMin] = startTime.split(':').map(Number)
    const [endHour, endMin] = endTime.split(':').map(Number)
    
    let duration = (endHour * 60 + endMin) - (startHour * 60 + startMin)
    if (duration < 0 || isNightShift) {
      duration += 24 * 60
    }
    
    const hours = Math.floor(duration / 60)
    const mins = duration % 60
    return `${hours}h ${mins > 0 ? `${mins}m` : ''}`
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shifts</h1>
          <p className="text-gray-500">Manage work shifts and timings</p>
        </div>
        {(isAdmin || isHR) && (
          <button 
            onClick={() => {
              setEditingShift(null)
              resetForm()
              setShowModal(true)
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Shift
          </button>
        )}
      </div>

      {/* Shifts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : shifts?.length > 0 ? (
          shifts.map((shift) => {
            const ShiftIcon = getShiftIcon(shift)
            return (
              <div key={shift.id} className="card hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      "w-12 h-12 rounded-lg flex items-center justify-center",
                      shift.is_night_shift ? "bg-indigo-100" : "bg-amber-100"
                    )}>
                      <ShiftIcon className={clsx(
                        "w-6 h-6",
                        shift.is_night_shift ? "text-indigo-600" : "text-amber-600"
                      )} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{shift.name}</h3>
                      <p className="text-sm text-gray-500">
                        {calculateShiftDuration(shift.start_time, shift.end_time, shift.is_night_shift)}
                      </p>
                    </div>
                  </div>
                  {(isAdmin || isHR) && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleEdit(shift)}
                        className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(shift)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Timing</span>
                    <span className="font-medium text-gray-900">
                      {shift.start_time} - {shift.end_time}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Grace Period</span>
                    <span className="font-medium text-gray-900">
                      {shift.grace_period_minutes} minutes
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Half Day After</span>
                    <span className="font-medium text-gray-900">
                      {shift.half_day_hours} hours
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-gray-500">
                      <Users className="w-4 h-4" />
                      <span>{shift.employee_count || 0} employees</span>
                    </div>
                    {shift.is_night_shift && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700">
                        <Moon className="w-3 h-3" />
                        Night Shift
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Clock className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>No shifts configured</p>
            {(isAdmin || isHR) && (
              <button 
                onClick={() => setShowModal(true)}
                className="mt-2 text-primary-600 hover:text-primary-700 font-medium"
              >
                Add your first shift
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Shift Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 animate-fadeIn">
            <h2 className="text-xl font-bold mb-4">
              {editingShift ? 'Edit Shift' : 'Add New Shift'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Shift Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  required
                  placeholder="e.g., Morning Shift"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Time *
                  </label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Time *
                  </label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Grace Period (minutes)
                  </label>
                  <input
                    type="number"
                    value={formData.grace_period_minutes}
                    onChange={(e) => setFormData({ ...formData, grace_period_minutes: parseInt(e.target.value) })}
                    className="input-field"
                    min={0}
                    max={60}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Half Day Hours
                  </label>
                  <input
                    type="number"
                    value={formData.half_day_hours}
                    onChange={(e) => setFormData({ ...formData, half_day_hours: parseInt(e.target.value) })}
                    className="input-field"
                    min={1}
                    max={12}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_night_shift"
                  checked={formData.is_night_shift}
                  onChange={(e) => setFormData({ ...formData, is_night_shift: e.target.checked })}
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="is_night_shift" className="text-sm text-gray-700">
                  Night Shift (crosses midnight)
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingShift(null)
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
                    : editingShift ? 'Update' : 'Create'
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

export default Shifts
