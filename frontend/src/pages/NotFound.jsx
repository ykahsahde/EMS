import { Link } from 'react-router-dom'
import { Home, ArrowLeft, Search } from 'lucide-react'

const NotFound = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center">
        {/* 404 Illustration */}
        <div className="mb-8">
          <div className="text-9xl font-bold text-gray-200">404</div>
          <div className="relative -mt-16">
            <Search className="w-24 h-24 mx-auto text-primary-300" />
          </div>
        </div>

        {/* Content */}
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Page Not Found</h1>
        <p className="text-gray-500 mb-8">
          Oops! The page you're looking for doesn't exist or has been moved.
          Let's get you back on track.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link 
            to="/"
            className="btn-primary flex items-center justify-center gap-2"
          >
            <Home className="w-5 h-5" />
            Go to Dashboard
          </Link>
          <button 
            onClick={() => window.history.back()}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Go Back
          </button>
        </div>

        {/* Help Links */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-500 mb-4">Here are some helpful links:</p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link to="/attendance" className="text-primary-600 hover:text-primary-700">
              Attendance
            </Link>
            <Link to="/leaves" className="text-primary-600 hover:text-primary-700">
              Leaves
            </Link>
            <Link to="/profile" className="text-primary-600 hover:text-primary-700">
              Profile
            </Link>
            <Link to="/settings" className="text-primary-600 hover:text-primary-700">
              Settings
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-12 text-xs text-gray-400">
          Raymond Lifestyle Ltd. - Attendance Management System
        </p>
      </div>
    </div>
  )
}

export default NotFound
