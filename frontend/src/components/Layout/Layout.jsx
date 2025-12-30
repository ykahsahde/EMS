import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { 
  LayoutDashboard, Clock, Calendar, Users, Building2, 
  CalendarClock, CalendarDays, FileText, Settings, 
  LogOut, User, Menu, X, Bell, ScanFace
} from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'

const Layout = () => {
  const { user, logout, isAdmin, isHR, isGM, isManager, canViewReports } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { name: 'Attendance', href: '/attendance', icon: Clock, roles: ['ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { name: 'Leave Management', href: '/leaves', icon: Calendar, roles: ['ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { name: 'Face Registration', href: '/face-registration', icon: ScanFace, roles: ['ADMIN', 'GM', 'HR', 'MANAGER', 'EMPLOYEE'] },
    { name: 'Employees', href: '/employees', icon: Users, roles: ['ADMIN', 'GM', 'HR', 'MANAGER'] },
    { name: 'Departments', href: '/departments', icon: Building2, roles: ['ADMIN'] },
    { name: 'Shifts', href: '/shifts', icon: CalendarClock, roles: ['ADMIN'] },
    { name: 'Holidays', href: '/holidays', icon: CalendarDays, roles: ['ADMIN'] },
    { name: 'Reports', href: '/reports', icon: FileText, roles: ['ADMIN', 'GM', 'HR'] },
    { name: 'Settings', href: '/settings', icon: Settings, roles: ['ADMIN'] },
  ]

  const filteredNavigation = navigation.filter(item => item.roles.includes(user?.role))

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'ADMIN': return 'bg-red-100 text-red-800'
      case 'GM': return 'bg-amber-100 text-amber-800'
      case 'HR': return 'bg-purple-100 text-purple-800'
      case 'MANAGER': return 'bg-blue-100 text-blue-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        "fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-raymond-red rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-semibold text-gray-900">Raymond AMS</span>
          </div>
          <button 
            className="lg:hidden text-gray-500 hover:text-gray-700"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User Info */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-primary-700 font-medium">
                {user?.first_name?.[0]}{user?.last_name?.[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.first_name} {user?.last_name}
              </p>
              <span className={clsx("inline-block px-2 py-0.5 text-xs font-medium rounded-full", getRoleBadgeColor(user?.role))}>
                {user?.role}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {filteredNavigation.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={clsx(
                  "sidebar-link",
                  isActive && "active"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={logout}
            className="sidebar-link w-full text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:ml-64">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 h-16">
          <div className="flex items-center justify-between h-full px-4 lg:px-6">
            <button
              className="lg:hidden text-gray-500 hover:text-gray-700"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1 lg:flex-none">
              <h1 className="text-lg font-semibold text-gray-900 lg:hidden">Raymond AMS</h1>
            </div>

            <div className="flex items-center gap-4">
              {/* Notifications */}
              <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
              </button>

              {/* Profile Link */}
              <NavLink 
                to="/profile"
                className="flex items-center gap-2 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <User className="w-5 h-5" />
                <span className="hidden sm:inline text-sm font-medium">{user?.first_name}</span>
              </NavLink>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
