import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { attendanceAPI, configAPI } from '../services/api'
import { 
  Camera, ScanFace, CheckCircle, XCircle, 
  RefreshCw, AlertCircle, MapPin, LogIn, LogOut, X,
  Shield, Navigation, User, Clock
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import * as faceapi from 'face-api.js'
import api from '../services/api'

// Default Raymond office location (fallback if API fails)
// Raymond Borgaon Factory - Chhindwara, Madhya Pradesh (100 acres)
const DEFAULT_OFFICE_LOCATION = {
  latitude: 22.14,
  longitude: 78.77,
  radius: 800
}

const PublicFaceAttendance = ({ onClose, onLoginClick }) => {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState(null)
  const [identifiedUser, setIdentifiedUser] = useState(null)
  const [location, setLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState('checking')
  const [locationDistance, setLocationDistance] = useState(null)
  const [instructions, setInstructions] = useState('Loading face detection models...')
  const [attendanceMode, setAttendanceMode] = useState('check-in') // check-in or check-out
  const [currentTime, setCurrentTime] = useState(new Date())
  const detectionIntervalRef = useRef(null)

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Fetch office location and location verification setting
  const { data: officeConfig } = useQuery({
    queryKey: ['office-location-public'],
    queryFn: async () => {
      try {
        const response = await api.get('/config/office-location')
        return response.data.data
      } catch (error) {
        return { ...DEFAULT_OFFICE_LOCATION, location_verification_required: true }
      }
    },
    staleTime: 1000 * 60 * 60
  })

  const officeLocation = officeConfig || DEFAULT_OFFICE_LOCATION
  const locationVerificationRequired = officeConfig?.location_verification_required !== false

  // Public check-in mutation
  const checkInMutation = useMutation({
    mutationFn: (data) => api.post('/attendance/public/check-in', data),
    onSuccess: (response) => {
      toast.success(`${response.data.data.employee_name} checked in successfully!`)
      setVerificationResult('success')
      setIdentifiedUser(response.data.data)
      setTimeout(() => {
        resetState()
      }, 5000)
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Check-in failed')
      setVerificationResult('failed')
    }
  })

  // Public check-out mutation
  const checkOutMutation = useMutation({
    mutationFn: (data) => api.post('/attendance/public/check-out', data),
    onSuccess: (response) => {
      toast.success(`${response.data.data.employee_name} checked out successfully!`)
      setVerificationResult('success')
      setIdentifiedUser(response.data.data)
      setTimeout(() => {
        resetState()
      }, 5000)
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Check-out failed')
      setVerificationResult('failed')
    }
  })

  const resetState = () => {
    setVerificationResult(null)
    setIdentifiedUser(null)
    setFaceDetected(false)
    setInstructions('Position your face in the center for verification')
    if (isCameraActive) {
      startFaceDetection()
    }
  }

  // Calculate distance
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  // Check location
  const checkLocation = useCallback(async () => {
    setLocationStatus('checking')
    if (!navigator.geolocation) {
      setLocationStatus('error')
      return
    }

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 60000
        })
      })

      const userLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }
      setLocation(userLocation)

      const distance = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        officeLocation.latitude,
        officeLocation.longitude
      )

      setLocationDistance(Math.round(distance))

      if (distance <= officeLocation.radius) {
        setLocationStatus('allowed')
      } else {
        setLocationStatus('denied')
      }
    } catch (error) {
      console.error('Location error:', error)
      if (error.code === 3) {
        // Timeout - try with lower accuracy
        try {
          const fallbackPosition = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 15000,
              maximumAge: 300000
            })
          })
          
          const userLocation = {
            latitude: fallbackPosition.coords.latitude,
            longitude: fallbackPosition.coords.longitude
          }
          setLocation(userLocation)

          const distance = calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            officeLocation.latitude,
            officeLocation.longitude
          )

          setLocationDistance(Math.round(distance))

          if (distance <= officeLocation.radius) {
            setLocationStatus('allowed')
          } else {
            setLocationStatus('denied')
          }
          return
        } catch (fallbackError) {
          setLocationStatus('error')
        }
      } else {
        setLocationStatus('error')
      }
    }
  }, [officeLocation])

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        setIsLoading(true)
        const MODEL_URL = '/models'

        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ])
        
        setModelsLoaded(true)
        setInstructions('Click "Start Camera" to mark your attendance')
      } catch (error) {
        console.error('Error loading face-api models:', error)
        setInstructions('Failed to load face detection.')
      } finally {
        setIsLoading(false)
      }
    }

    loadModels()

    return () => {
      stopCamera()
    }
  }, [])

  // Check location only when location verification is required
  useEffect(() => {
    if (officeConfig && locationVerificationRequired) {
      checkLocation()
    } else if (officeConfig && !locationVerificationRequired) {
      // Location verification disabled by admin - set status to allowed
      setLocationStatus('allowed')
    }
  }, [officeConfig, locationVerificationRequired, checkLocation])

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setIsCameraActive(true)
        setInstructions('Position your face in the center for verification')
        startFaceDetection()
      }
    } catch (error) {
      console.error('Error accessing camera:', error)
      toast.error('Failed to access camera')
    }
  }

  // Stop camera
  const stopCamera = () => {
    if (detectionIntervalRef.current) {
      cancelAnimationFrame(detectionIntervalRef.current)
      detectionIntervalRef.current = null
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
    }
    setIsCameraActive(false)
    setFaceDetected(false)
  }

  // Face detection loop
  const startFaceDetection = () => {
    const detectFace = async () => {
      if (!videoRef.current || !canvasRef.current || !modelsLoaded || !isCameraActive) return

      try {
        const video = videoRef.current
        const canvas = canvasRef.current
        
        // Double check refs are still valid
        if (!video || !canvas) return

        const detections = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        ).withFaceLandmarks()

        // Check again after async operation
        if (!canvasRef.current) return

        const displaySize = { width: 640, height: 480 }
        faceapi.matchDimensions(canvas, displaySize)

        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        if (detections) {
          setFaceDetected(true)
          setInstructions(`Face detected! Click "${attendanceMode === 'check-in' ? 'Check In' : 'Check Out'}" to mark attendance`)
          
          const resizedDetections = faceapi.resizeResults(detections, displaySize)
          faceapi.draw.drawDetections(canvas, resizedDetections)
          faceapi.draw.drawFaceLandmarks(canvas, resizedDetections)
        } else {
          setFaceDetected(false)
          setInstructions('Position your face in the center of the frame')
        }
      } catch (error) {
        console.error('Detection error:', error)
      }

      if (isCameraActive) {
        detectionIntervalRef.current = requestAnimationFrame(detectFace)
      }
    }

    detectFace()
  }

  // Verify face and mark attendance
  const handleFaceVerification = async () => {
    if (!videoRef.current || !faceDetected) return

    // Only check location if location verification is required
    if (locationVerificationRequired && locationStatus !== 'allowed') {
      toast.error('You must be at Raymond Borgaon Factory to mark attendance')
      return
    }

    setIsVerifying(true)
    setInstructions('Identifying you...')

    try {
      const detection = await faceapi.detectSingleFace(
        videoRef.current,
        new faceapi.TinyFaceDetectorOptions()
      ).withFaceLandmarks().withFaceDescriptor()

      if (!detection) {
        toast.error('Face not detected. Please try again.')
        setIsVerifying(false)
        return
      }

      const faceDescriptor = Array.from(detection.descriptor)

      // Include location data only if verification is required
      const locationData = locationVerificationRequired ? {
        ...location,
        verified: locationStatus === 'allowed',
        distance_from_office: locationDistance,
        verified_at: new Date().toISOString()
      } : null

      const attendanceData = {
        face_descriptor: faceDescriptor,
        location: locationData
      }

      if (attendanceMode === 'check-in') {
        checkInMutation.mutate(attendanceData)
      } else {
        checkOutMutation.mutate(attendanceData)
      }
    } catch (error) {
      console.error('Verification error:', error)
      toast.error('Face verification failed')
      setVerificationResult('failed')
    } finally {
      setIsVerifying(false)
    }
  }

  useEffect(() => {
    if (isCameraActive && modelsLoaded) {
      startFaceDetection()
    }
  }, [isCameraActive, modelsLoaded, attendanceMode])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Raymond Borgaon</h1>
              <p className="text-blue-100">Attendance Management System</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold">{currentTime.toLocaleTimeString()}</p>
              <p className="text-blue-100">{currentTime.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setAttendanceMode('check-in')}
              className={clsx(
                "flex-1 py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all",
                attendanceMode === 'check-in' 
                  ? "bg-green-500 text-white shadow-lg" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <LogIn className="w-5 h-5" />
              Check In
            </button>
            <button
              onClick={() => setAttendanceMode('check-out')}
              className={clsx(
                "flex-1 py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all",
                attendanceMode === 'check-out' 
                  ? "bg-red-500 text-white shadow-lg" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <LogOut className="w-5 h-5" />
              Check Out
            </button>
          </div>

          {/* Verification Status */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-blue-600" />
              <span className="font-semibold text-blue-900">
                {locationVerificationRequired ? 'Dual Verification Required' : 'Face Verification Required'}
              </span>
              {!locationVerificationRequired && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Location Disabled</span>
              )}
            </div>
            <div className={clsx("grid gap-3", locationVerificationRequired ? "grid-cols-2" : "grid-cols-1")}>
              <div className={clsx(
                "flex items-center gap-2 p-3 rounded-lg",
                verificationResult === 'success' ? "bg-green-100" : "bg-white"
              )}>
                <ScanFace className={clsx(
                  "w-6 h-6",
                  verificationResult === 'success' ? "text-green-600" : "text-gray-400"
                )} />
                <div>
                  <p className="font-medium text-gray-700">Face Recognition</p>
                  <p className={clsx(
                    "text-sm",
                    verificationResult === 'success' ? "text-green-600" : "text-gray-500"
                  )}>
                    {verificationResult === 'success' ? 'Verified' : 'Scan your face'}
                  </p>
                </div>
              </div>
              {locationVerificationRequired && (
                <div className={clsx(
                  "flex items-center gap-2 p-3 rounded-lg",
                  locationStatus === 'allowed' ? "bg-green-100" : 
                  locationStatus === 'denied' ? "bg-red-100" : "bg-white"
                )}>
                  <Navigation className={clsx(
                    "w-6 h-6",
                    locationStatus === 'allowed' ? "text-green-600" : 
                    locationStatus === 'denied' ? "text-red-600" : "text-gray-400"
                  )} />
                  <div>
                    <p className="font-medium text-gray-700">Location</p>
                    <p className={clsx(
                      "text-sm",
                      locationStatus === 'allowed' ? "text-green-600" : 
                      locationStatus === 'denied' ? "text-red-600" : "text-gray-500"
                    )}>
                      {locationStatus === 'checking' && 'Checking...'}
                      {locationStatus === 'allowed' && 'At Raymond'}
                      {locationStatus === 'denied' && `${locationDistance}m away`}
                      {locationStatus === 'error' && 'Enable GPS'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Success Message */}
          {verificationResult === 'success' && identifiedUser && (
            <div className="bg-green-50 border-2 border-green-300 rounded-xl p-4 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-xl font-bold text-green-800">{identifiedUser.employee_name}</p>
              <p className="text-green-600">{identifiedUser.employee_id}</p>
              <p className="text-lg text-green-700 mt-2">
                {attendanceMode === 'check-in' ? 'Checked In' : 'Checked Out'} at {new Date().toLocaleTimeString()}
              </p>
            </div>
          )}

          {/* Location Warning - Only show when location verification is required */}
          {locationVerificationRequired && locationStatus === 'denied' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Not at Raymond Borgaon Factory</p>
                <p className="text-xs text-red-600 mt-1">
                  You are {locationDistance} meters away. Please come within {officeLocation.radius}m.
                </p>
                <button onClick={checkLocation} className="mt-2 text-xs text-red-700 underline">
                  Refresh Location
                </button>
              </div>
            </div>
          )}

          {/* Camera View */}
          {!verificationResult && (
            <>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-4" />
                  <p className="text-gray-600">Loading face detection...</p>
                </div>
              ) : (
                <>
                  <div className="relative bg-gray-900 rounded-xl overflow-hidden" style={{ aspectRatio: '4/3' }}>
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      playsInline
                      muted
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute top-0 left-0 w-full h-full"
                    />
                    
                    {!isCameraActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800">
                        <Camera className="w-20 h-20 text-gray-500 mb-4" />
                        <p className="text-gray-400">Camera not started</p>
                      </div>
                    )}

                    {isCameraActive && (
                      <>
                        <div className={clsx(
                          "absolute top-4 left-4 px-3 py-2 rounded-full text-sm font-medium flex items-center gap-2",
                          faceDetected ? "bg-green-500 text-white" : "bg-red-500 text-white"
                        )}>
                          <User className="w-4 h-4" />
                          {faceDetected ? "Face Detected" : "No Face"}
                        </div>
                        {locationVerificationRequired && (
                          <div className={clsx(
                            "absolute top-4 right-4 px-3 py-2 rounded-full text-sm font-medium flex items-center gap-2",
                            locationStatus === 'allowed' ? "bg-green-500 text-white" : "bg-orange-500 text-white"
                          )}>
                            <MapPin className="w-4 h-4" />
                            {locationStatus === 'allowed' ? "At Office" : "Not at Office"}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Instructions */}
                  <div className={clsx(
                    "flex items-center gap-2 p-3 rounded-xl",
                    verificationResult === 'failed' ? "bg-red-50 text-red-700" :
                    (locationVerificationRequired && locationStatus !== 'allowed') ? "bg-orange-50 text-orange-700" :
                    "bg-blue-50 text-blue-700"
                  )}>
                    <AlertCircle className="w-5 h-5" />
                    <span>{locationVerificationRequired && locationStatus !== 'allowed' && locationStatus !== 'checking' 
                      ? 'Please come to Raymond Borgaon Factory'
                      : instructions}</span>
                  </div>

                  {/* Controls */}
                  <div className="flex gap-3">
                    {!isCameraActive ? (
                      <button
                        onClick={startCamera}
                        disabled={!modelsLoaded || (locationVerificationRequired && locationStatus !== 'allowed')}
                        className={clsx(
                          "flex-1 py-4 rounded-xl font-semibold flex items-center justify-center gap-2",
                          (!locationVerificationRequired || locationStatus === 'allowed')
                            ? "bg-blue-600 text-white hover:bg-blue-700" 
                            : "bg-gray-300 text-gray-500 cursor-not-allowed"
                        )}
                      >
                        <Camera className="w-5 h-5" />
                        Start Camera
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={stopCamera}
                          className="px-6 py-4 rounded-xl font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 flex items-center gap-2"
                        >
                          <XCircle className="w-5 h-5" />
                          Stop
                        </button>
                        <button
                          onClick={handleFaceVerification}
                          disabled={!faceDetected || isVerifying || (locationVerificationRequired && locationStatus !== 'allowed')}
                          className={clsx(
                            "flex-1 py-4 rounded-xl font-semibold flex items-center justify-center gap-2",
                            faceDetected && (!locationVerificationRequired || locationStatus === 'allowed')
                              ? attendanceMode === 'check-in' 
                                ? "bg-green-500 text-white hover:bg-green-600" 
                                : "bg-red-500 text-white hover:bg-red-600"
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          )}
                        >
                          {isVerifying ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <ScanFace className="w-5 h-5" />
                          )}
                          {isVerifying ? 'Identifying...' : attendanceMode === 'check-in' ? 'Check In' : 'Check Out'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* Login Link */}
          <div className="text-center pt-4 border-t">
            <p className="text-gray-500 mb-2">Need to access your account?</p>
            <button
              onClick={onLoginClick}
              className="text-blue-600 hover:text-blue-800 font-medium flex items-center justify-center gap-2 mx-auto"
            >
              <LogIn className="w-4 h-4" />
              Login to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PublicFaceAttendance
