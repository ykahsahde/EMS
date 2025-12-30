import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { authAPI, usersAPI } from '../services/api'
import { 
  User, Mail, Phone, Building, Calendar, Clock, 
  Camera, Lock, Save, RefreshCw 
} from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const Profile = () => {
  const { user, updateUser } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('profile')
  const [showChangePassword, setShowChangePassword] = useState(false)

  // Profile form state
  const [profileForm, setProfileForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    phone: user?.phone || ''
  })

  // Password form state
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  })

  // Fetch full profile data
  const { data: profileData, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const response = await authAPI.getProfile()
      return response.data.data
    }
  })

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: (data) => usersAPI.update(user.id, data),
    onSuccess: (response) => {
      toast.success('Profile updated successfully!')
      if (response.data.data) {
        updateUser(response.data.data)
      }
      queryClient.invalidateQueries(['my-profile'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to update profile')
    }
  })

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: (data) => authAPI.changePassword(data),
    onSuccess: () => {
      toast.success('Password changed successfully!')
      setShowChangePassword(false)
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to change password')
    }
  })

  const handleProfileSubmit = (e) => {
    e.preventDefault()
    updateProfileMutation.mutate(profileForm)
  }

  const handlePasswordSubmit = (e) => {
    e.preventDefault()
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('New passwords do not match')
      return
    }
    if (passwordForm.new_password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    changePasswordMutation.mutate({
      current_password: passwordForm.current_password,
      new_password: passwordForm.new_password
    })
  }

  const getRoleBadgeClass = (role) => {
    const roleClasses = {
      ADMIN: 'bg-purple-100 text-purple-800',
      GM: 'bg-amber-100 text-amber-800',
      HR: 'bg-blue-100 text-blue-800',
      MANAGER: 'bg-green-100 text-green-800',
      EMPLOYEE: 'bg-gray-100 text-gray-800'
    }
    return roleClasses[role] || roleClasses.EMPLOYEE
  }

  if (isLoading) {
    return (
      <div className="animate-fadeIn flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  const profile = profileData || user

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-gray-500">Manage your account settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="card text-center">
          <div className="relative inline-block">
            <div className="w-24 h-24 rounded-full bg-primary-100 flex items-center justify-center mx-auto">
              {profile?.profile_photo ? (
                <img 
                  src={profile.profile_photo} 
                  alt="Profile" 
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <span className="text-3xl font-bold text-primary-600">
                  {profile?.first_name?.charAt(0)}{profile?.last_name?.charAt(0)}
                </span>
              )}
            </div>
          </div>
          
          <h2 className="text-xl font-semibold text-gray-900 mt-4">
            {profile?.first_name} {profile?.last_name}
          </h2>
          <p className="text-gray-500">{profile?.employee_id}</p>
          <span className={clsx("status-badge mt-2 inline-block", getRoleBadgeClass(profile?.role))}>
            {profile?.role}
          </span>

          <div className="mt-6 pt-6 border-t border-gray-100 space-y-3 text-left">
            <div className="flex items-center gap-3 text-sm">
              <Mail className="w-4 h-4 text-gray-400" />
              <span className="text-gray-600">{profile?.email}</span>
            </div>
            {profile?.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{profile?.phone}</span>
              </div>
            )}
            {profile?.department_name && (
              <div className="flex items-center gap-3 text-sm">
                <Building className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{profile?.department_name}</span>
              </div>
            )}
            {profile?.shift_name && (
              <div className="flex items-center gap-3 text-sm">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{profile?.shift_name}</span>
              </div>
            )}
            {profile?.joining_date && (
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">
                  Joined {format(new Date(profile.joining_date), 'MMMM d, yyyy')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Edit Profile / Change Password */}
        <div className="lg:col-span-2">
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex gap-4">
              <button
                onClick={() => setActiveTab('profile')}
                className={clsx(
                  "py-2 px-1 border-b-2 font-medium text-sm transition-colors",
                  activeTab === 'profile'
                    ? "border-primary-600 text-primary-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                )}
              >
                Edit Profile
              </button>
              <button
                onClick={() => setActiveTab('security')}
                className={clsx(
                  "py-2 px-1 border-b-2 font-medium text-sm transition-colors",
                  activeTab === 'security'
                    ? "border-primary-600 text-primary-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                )}
              >
                Security
              </button>
            </nav>
          </div>

          {/* Edit Profile Form */}
          {activeTab === 'profile' && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Profile</h3>
              <form onSubmit={handleProfileSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      First Name
                    </label>
                    <input
                      type="text"
                      value={profileForm.first_name}
                      onChange={(e) => setProfileForm({ ...profileForm, first_name: e.target.value })}
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={profileForm.last_name}
                      onChange={(e) => setProfileForm({ ...profileForm, last_name: e.target.value })}
                      className="input-field"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                    className="input-field"
                    placeholder="+91 9876543210"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={profile?.email || ''}
                    className="input-field bg-gray-50"
                    disabled
                  />
                  <p className="text-xs text-gray-500 mt-1">Contact HR to change your email address</p>
                </div>
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={updateProfileMutation.isPending}
                    className="btn-primary flex items-center gap-2"
                  >
                    {updateProfileMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h3>
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.current_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                    className="input-field"
                    required
                    placeholder="Enter current password"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.new_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                    className="input-field"
                    required
                    minLength={6}
                    placeholder="Enter new password (min. 6 characters)"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                    className="input-field"
                    required
                    minLength={6}
                    placeholder="Confirm new password"
                  />
                </div>
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={changePasswordMutation.isPending}
                    className="btn-primary flex items-center gap-2"
                  >
                    {changePasswordMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                    Change Password
                  </button>
                </div>
              </form>

              <div className="mt-6 pt-6 border-t border-gray-100">
                <h4 className="font-medium text-gray-900 mb-3">Password Requirements</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                    Minimum 6 characters
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                    Use a mix of letters and numbers for better security
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                    Avoid using personal information
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Profile
