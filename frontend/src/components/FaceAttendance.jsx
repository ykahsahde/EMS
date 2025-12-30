import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { attendanceAPI, faceAPI, configAPI } from '../services/api'
import { 
  Camera, ScanFace, CheckCircle, XCircle, 
  RefreshCw, AlertCircle, MapPin, LogIn, LogOut, X,
  Shield, Navigation
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import * as faceapi from 'face-api.js'

// Default Raymond office location (fallback if API fails)
// Raymond Borgaon Factory - Chhindwara, Madhya Pradesh (100 acres)
const DEFAULT_OFFICE_LOCATION = {
  latitude: 22.14,    // Raymond Borgaon coordinates
  longitude: 78.77,
  radius: 800 // meters - covers 100 acre campus
}

const FaceAttendance = ({ mode = 'check-in', onClose, onSuccess }) => {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState(null)
  const [location, setLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState('checking') // checking, allowed, denied, error
  const [locationDistance, setLocationDistance] = useState(null) // Distance from office in meters
  const [instructions, setInstructions] = useState('Loading face detection models...')
  const detectionIntervalRef = useRef(null)

  // Fetch office location from backend (includes location_verification_required setting)
  const { data: officeConfig } = useQuery({
    queryKey: ['office-location'],
    queryFn: async () => {
      try {
        const response = await configAPI.getOfficeLocation()
        return response.data.data
      } catch (error) {
        console.error('Failed to fetch office location:', error)
        return { ...DEFAULT_OFFICE_LOCATION, location_verification_required: true }
      }
    },
    staleTime: 1000 * 60 * 5 // Cache for 5 minutes
  })

  const officeLocation = officeConfig || DEFAULT_OFFICE_LOCATION
  const locationVerificationRequired = officeConfig?.location_verification_required !== false

  // Check-in mutation
  const checkInMutation = useMutation({
    mutationFn: (data) => attendanceAPI.checkIn(data),
    onSuccess: () => {
      toast.success('Checked in successfully!')
      queryClient.invalidateQueries(['today-attendance'])
      queryClient.invalidateQueries(['my-attendance'])
      onSuccess?.()
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Check-in failed')
    }
  })

  // Check-out mutation
  const checkOutMutation = useMutation({
    mutationFn: (data) => attendanceAPI.checkOut(data),
    onSuccess: () => {
      toast.success('Checked out successfully!')
      queryClient.invalidateQueries(['today-attendance'])
      queryClient.invalidateQueries(['my-attendance'])
      onSuccess?.()
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Check-out failed')
    }
  })

  // Calculate distance between two points using Haversine formula
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c // Distance in meters
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
          timeout: 30000, // Increased to 30 seconds
          maximumAge: 60000 // Allow cached position up to 1 minute old
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
      if (error.code === 1) {
        // Permission denied
        setLocationStatus('error')
        toast.error('Location permission denied. Please enable location access.')
      } else if (error.code === 2) {
        // Position unavailable
        setLocationStatus('error')
        toast.error('Location unavailable. Please check your GPS settings.')
      } else if (error.code === 3) {
        // Timeout - try again with lower accuracy
        try {
          const fallbackPosition = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false, // Lower accuracy, faster response
              timeout: 15000,
              maximumAge: 300000 // Allow cached position up to 5 minutes
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
          toast.error('Location timeout. Please check your internet and GPS settings.')
        }
      } else {
        setLocationStatus('error')
        toast.error('Failed to get location. Please try again.')
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
        setInstructions('Click "Start Camera" to verify your face')
      } catch (error) {
        console.error('Error loading face-api models:', error)
        setInstructions('Failed to load face detection. Try location-based attendance.')
      } finally {
        setIsLoading(false)
      }
    }

    loadModels()

    return () => {
      stopCamera()
    }
  }, [])

  // Check location only when location verification is required and config is loaded
  useEffect(() => {
    if (officeConfig && locationVerificationRequired) {
      checkLocation()
    } else if (officeConfig && !locationVerificationRequired) {
      // Location verification disabled - set status to allowed so it doesn't block
      setLocationStatus('allowed')
    }
  }, [officeConfig, locationVerificationRequired, checkLocation])

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' }
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
      setInstructions('Camera access denied. Try location-based attendance.')
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
        const detections = await faceapi.detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        ).withFaceLandmarks()

        const canvas = canvasRef.current
        const displaySize = { width: 480, height: 360 }
        faceapi.matchDimensions(canvas, displaySize)

        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        if (detections) {
          setFaceDetected(true)
          setInstructions('Face detected! Click "Verify & ' + (mode === 'check-in' ? 'Check In' : 'Check Out') + '"')
          
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

  // Verify face and mark attendance (Face + Location based on admin setting)
  const handleFaceVerification = async () => {
    if (!videoRef.current || !faceDetected) return

    // Check location only if verification is required by admin
    if (locationVerificationRequired && locationStatus !== 'allowed') {
      toast.error('You must be at Raymond office premises to mark attendance')
      return
    }

    setIsVerifying(true)
    setInstructions('Verifying your face...')

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

      // Verify face with backend
      const verifyResponse = await faceAPI.verify(faceDescriptor)
      
      if (verifyResponse.data.success && verifyResponse.data.data.verified) {
        setVerificationResult('success')
        const faceScore = verifyResponse.data.data.score || 0.8
        
        // Mark attendance with both face verification and location
        const attendanceData = {
          is_face_verified: true,
          face_score: faceScore,
          location: location,
          location_verified: true
        }

        if (mode === 'check-in') {
          checkInMutation.mutate(attendanceData)
        } else {
          checkOutMutation.mutate({ location, location_verified: true })
        }
      } else {
        setVerificationResult('failed')
        toast.error('Face verification failed. Your face does not match our records.')
      }
    } catch (error) {
      console.error('Verification error:', error)
      setVerificationResult('failed')
      toast.error('Face verification failed')
    } finally {
      setIsVerifying(false)
      stopCamera()
    }
  }

  useEffect(() => {
    if (isCameraActive && modelsLoaded) {
      startFaceDetection()
    }
  }, [isCameraActive, modelsLoaded])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            {mode === 'check-in' ? (
              <>
                <LogIn className="w-6 h-6 text-green-600" />
                Check In
              </>
            ) : (
              <>
                <LogOut className="w-6 h-6 text-red-600" />
                Check Out
              </>
            )}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Verification Status Banner */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
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
              {/* Face Verification Status */}
              <div className={clsx(
                "flex items-center gap-2 p-2 rounded-lg",
                verificationResult === 'success' ? "bg-green-100" : "bg-white"
              )}>
                <ScanFace className={clsx(
                  "w-5 h-5",
                  verificationResult === 'success' ? "text-green-600" : "text-gray-400"
                )} />
                <div className="text-sm">
                  <p className="font-medium text-gray-700">Face</p>
                  <p className={clsx(
                    "text-xs",
                    verificationResult === 'success' ? "text-green-600" : "text-gray-500"
                  )}>
                    {verificationResult === 'success' ? 'Verified' : 'Pending'}
                  </p>
                </div>
              </div>
              {/* Location Verification Status - Only show when location verification is required */}
              {locationVerificationRequired && (
                <div className={clsx(
                  "flex items-center gap-2 p-2 rounded-lg",
                  locationStatus === 'allowed' ? "bg-green-100" : 
                  locationStatus === 'denied' ? "bg-red-100" : "bg-white"
                )}>
                  <Navigation className={clsx(
                    "w-5 h-5",
                    locationStatus === 'allowed' ? "text-green-600" : 
                    locationStatus === 'denied' ? "text-red-600" : "text-gray-400"
                  )} />
                  <div className="text-sm">
                    <p className="font-medium text-gray-700">Location</p>
                    <p className={clsx(
                      "text-xs",
                      locationStatus === 'allowed' ? "text-green-600" : 
                      locationStatus === 'denied' ? "text-red-600" : "text-gray-500"
                    )}>
                      {locationStatus === 'checking' && 'Checking...'}
                      {locationStatus === 'allowed' && 'At Raymond'}
                      {locationStatus === 'denied' && `${locationDistance}m away`}
                      {locationStatus === 'error' && 'Error'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Location Warning if not at office - Only show when location verification is required */}
          {locationVerificationRequired && locationStatus === 'denied' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Not at Raymond Office</p>
                <p className="text-xs text-red-600 mt-1">
                  You are approximately {locationDistance} meters from the office. 
                  Please come within {officeLocation.radius}m radius to mark attendance.
                </p>
                <button
                  onClick={checkLocation}
                  className="mt-2 text-xs text-red-700 underline hover:text-red-900"
                >
                  Refresh Location
                </button>
              </div>
            </div>
          )}

          {locationVerificationRequired && locationStatus === 'error' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800">Location Access Required</p>
                <p className="text-xs text-yellow-600 mt-1">
                  Please enable location access in your browser to verify you're at Raymond office.
                </p>
                <button
                  onClick={checkLocation}
                  className="mt-2 text-xs text-yellow-700 underline hover:text-yellow-900"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Face Recognition Section */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mb-4" />
              <p className="text-gray-600">Loading face detection...</p>
            </div>
          ) : (
            <>
              {/* Camera View */}
              <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
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
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                    <Camera className="w-16 h-16 text-gray-500" />
                  </div>
                )}

                {/* Face Detection Indicator */}
                {isCameraActive && (
                  <div className={clsx(
                    "absolute top-4 left-4 px-3 py-1 rounded-full text-sm font-medium",
                    faceDetected ? "bg-green-500 text-white" : "bg-red-500 text-white"
                  )}>
                    {faceDetected ? "Face Detected" : "No Face"}
                  </div>
                )}

                {/* Location Status Badge on Camera - Only show when location verification is required */}
                {isCameraActive && locationVerificationRequired && (
                  <div className={clsx(
                    "absolute top-4 right-4 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1",
                    locationStatus === 'allowed' ? "bg-green-500 text-white" : "bg-orange-500 text-white"
                  )}>
                    <MapPin className="w-4 h-4" />
                    {locationStatus === 'allowed' ? "At Office" : "Not at Office"}
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className={clsx(
                "flex items-center gap-2 p-3 rounded-lg",
                verificationResult === 'success' ? "bg-green-50 text-green-700" :
                verificationResult === 'failed' ? "bg-red-50 text-red-700" :
                (locationVerificationRequired && locationStatus !== 'allowed') ? "bg-orange-50 text-orange-700" :
                "bg-blue-50 text-blue-700"
              )}>
                {verificationResult === 'success' ? (
                  <CheckCircle className="w-5 h-5" />
                ) : verificationResult === 'failed' ? (
                  <XCircle className="w-5 h-5" />
                ) : (locationVerificationRequired && locationStatus !== 'allowed') ? (
                  <MapPin className="w-5 h-5" />
                ) : (
                  <AlertCircle className="w-5 h-5" />
                )}
                <span className="text-sm">
                  {locationVerificationRequired && locationStatus !== 'allowed' && locationStatus !== 'checking' 
                    ? 'Please come to Raymond office to mark attendance'
                    : instructions}
                </span>
              </div>

              {/* Camera Controls */}
              <div className="flex gap-3">
                {!isCameraActive ? (
                  <button
                    onClick={startCamera}
                    disabled={!modelsLoaded || (locationVerificationRequired && locationStatus !== 'allowed')}
                    className={clsx(
                      "flex-1 btn-primary flex items-center justify-center gap-2",
                      (locationVerificationRequired && locationStatus !== 'allowed') && "opacity-50 cursor-not-allowed"
                    )}
                    title={(locationVerificationRequired && locationStatus !== 'allowed') ? "You must be at Raymond office to start" : ""}
                  >
                    <Camera className="w-5 h-5" />
                    Start Camera
                  </button>
                ) : (
                  <>
                    <button
                      onClick={stopCamera}
                      className="btn-secondary flex items-center justify-center gap-2"
                    >
                      <XCircle className="w-5 h-5" />
                      Stop
                    </button>
                    <button
                      onClick={handleFaceVerification}
                      disabled={!faceDetected || isVerifying || (locationVerificationRequired && locationStatus !== 'allowed')}
                      className={clsx(
                        "flex-1 flex items-center justify-center gap-2",
                        mode === 'check-in' ? "btn-success" : "btn-danger",
                        (locationVerificationRequired && locationStatus !== 'allowed') && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {isVerifying ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <ScanFace className="w-5 h-5" />
                      )}
                      {isVerifying ? 'Verifying...' : `Verify & ${mode === 'check-in' ? 'Check In' : 'Check Out'}`}
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {/* User Info */}
          <div className="text-center text-sm text-gray-500 pt-2 border-t">
            Marking attendance for: <span className="font-medium">{user?.first_name} {user?.last_name}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FaceAttendance
