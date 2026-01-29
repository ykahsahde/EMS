import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { holidayAPI } from '../services/api'
import {
  Calendar, Plus, Edit2, Trash2, PartyPopper
} from 'lucide-react'
import { format, parseISO, isSameMonth, isSameYear } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Holidays = () => {
  const { isAdmin, isHR } = useAuth()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'NATIONAL',
    is_optional: false
  })

  // Fetch holidays
  const { data: holidays, isLoading } = useQuery({
    queryKey: ['holidays', selectedYear],
    queryFn: async () => {
      const response = await holidayAPI.getAll({ year: selectedYear })
      return response.data.data
    }
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data) => holidayAPI.create(data),
    onSuccess: () => {
      toast.success('Holiday added successfully!')
      setShowModal(false)
      resetForm()
      queryClient.invalidateQueries(['holidays'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to add holiday')
    }
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => holidayAPI.update(id, data),
    onSuccess: () => {
      toast.success('Holiday updated successfully!')
      setShowModal(false)
      setEditingHoliday(null)
      resetForm()
      queryClient.invalidateQueries(['holidays'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update holiday')
    }
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => holidayAPI.delete(id),
    onSuccess: () => {
      toast.success('Holiday deleted successfully!')
      queryClient.invalidateQueries(['holidays'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete holiday')
    }
  })

  const resetForm = () => {
    setFormData({
      name: '',
      date: '',
      type: 'NATIONAL',
      is_optional: false
    })
  }

  const handleEdit = (holiday) => {
    setEditingHoliday(holiday)
    setFormData({
      name: holiday.name || '',
      date: holiday.date ? format(parseISO(holiday.date), 'yyyy-MM-dd') : '',
      type: holiday.type || 'NATIONAL',
      is_optional: holiday.is_optional || false
    })
    setShowModal(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const data = { ...formData }

    if (editingHoliday) {
      updateMutation.mutate({ id: editingHoliday.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDelete = (holiday) => {
    if (confirm(`Are you sure you want to delete ${holiday.name}?`)) {
      deleteMutation.mutate(holiday.id)
    }
  }

  const getTypeColor = (type) => {
    const colors = {
      NATIONAL: 'bg-red-100 text-red-800',
      REGIONAL: 'bg-blue-100 text-blue-800',
      COMPANY: 'bg-purple-100 text-purple-800'
    }
    return colors[type] || colors.NATIONAL
  }

  // Group holidays by month
  const holidaysByMonth = holidays?.reduce((acc, holiday) => {
    const date = parseISO(holiday.date)
    const monthKey = format(date, 'MMMM')
    if (!acc[monthKey]) acc[monthKey] = []
    acc[monthKey].push(holiday)
    return acc
  }, {}) || {}

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Holidays</h1>
          <p className="text-gray-500">Manage company holidays and observances</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="input-field w-auto"
          >
            {[2024, 2025, 2026].map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          {(isAdmin || isHR) && (
            <button
              onClick={() => {
                setEditingHoliday(null)
                resetForm()
                setShowModal(true)
              }}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Holiday
            </button>
          )}
        </div>
      </div>

      {/* Holiday Stats */}
      {holidays && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <PartyPopper className="w-8 h-8 mx-auto text-primary-600 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{holidays.length}</p>
            <p className="text-sm text-gray-500">Total Holidays</p>
          </div>
          <div className="card text-center">
            <div className="w-8 h-8 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-2">
              <span className="text-red-600 font-bold text-sm">N</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {holidays.filter(h => h.type === 'NATIONAL').length}
            </p>
            <p className="text-sm text-gray-500">National</p>
          </div>
          <div className="card text-center">
            <div className="w-8 h-8 mx-auto rounded-full bg-blue-100 flex items-center justify-center mb-2">
              <span className="text-blue-600 font-bold text-sm">R</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {holidays.filter(h => h.type === 'REGIONAL').length}
            </p>
            <p className="text-sm text-gray-500">Regional</p>
          </div>
          <div className="card text-center">
            <div className="w-8 h-8 mx-auto rounded-full bg-purple-100 flex items-center justify-center mb-2">
              <span className="text-purple-600 font-bold text-sm">C</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {holidays.filter(h => h.type === 'COMPANY').length}
            </p>
            <p className="text-sm text-gray-500">Company</p>
          </div>
        </div>
      )}

      {/* Holiday Calendar View */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {months.map((month) => {
            const monthHolidays = holidaysByMonth[month]
            if (!monthHolidays || monthHolidays.length === 0) return null

            return (
              <div key={month} className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  {month} {selectedYear}
                </h3>
                <div className="space-y-3">
                  {monthHolidays.map((holiday) => (
                    <div
                      key={holiday.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-center min-w-[50px]">
                          <p className="text-2xl font-bold text-primary-600">
                            {format(parseISO(holiday.date), 'd')}
                          </p>
                          <p className="text-xs text-gray-500 uppercase">
                            {format(parseISO(holiday.date), 'EEE')}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{holiday.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={clsx("text-xs px-2 py-0.5 rounded-full", getTypeColor(holiday.type))}>
                              {holiday.type}
                            </span>
                            {holiday.is_optional && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                Optional
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {(isAdmin || isHR) && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleEdit(holiday)}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-white rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(holiday)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-white rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {Object.keys(holidaysByMonth).length === 0 && (
            <div className="card text-center py-12 text-gray-500">
              <Calendar className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No holidays for {selectedYear}</p>
              {(isAdmin || isHR) && (
                <button
                  onClick={() => setShowModal(true)}
                  className="mt-2 text-primary-600 hover:text-primary-700 font-medium"
                >
                  Add your first holiday
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Holiday Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 animate-fadeIn">
            <h2 className="text-xl font-bold mb-4">
              {editingHoliday ? 'Edit Holiday' : 'Add New Holiday'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Holiday Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  required
                  placeholder="e.g., Republic Day"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type *
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="input-field"
                  required
                >
                  <option value="NATIONAL">National Holiday</option>
                  <option value="REGIONAL">Regional Holiday</option>
                  <option value="COMPANY">Company Holiday</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_optional"
                  checked={formData.is_optional}
                  onChange={(e) => setFormData({ ...formData, is_optional: e.target.checked })}
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="is_optional" className="text-sm text-gray-700">
                  Optional Holiday (employees can choose to work)
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingHoliday(null)
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
                    : editingHoliday ? 'Update' : 'Add Holiday'
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

export default Holidays
