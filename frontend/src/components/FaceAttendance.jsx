import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { attendanceAPI, faceAPI } from '../services/api'
import {
  Camera, ScanFace, CheckCircle, XCircle,
  RefreshCw, AlertCircle, LogIn, LogOut, X,
  Shield
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import * as faceapi from 'face-api.js'

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
  const [instructions, setInstructions] = useState('Loading face detection models...')
  const detectionIntervalRef = useRef(null)

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
      setInstructions('Camera access denied.')
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

  // Verify face and mark attendance
  const handleFaceVerification = async () => {
    if (!videoRef.current || !faceDetected) return

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

        // Mark attendance with face verification
        const attendanceData = {
          is_face_verified: true,
          face_score: faceScore
        }

        if (mode === 'check-in') {
          checkInMutation.mutate(attendanceData)
        } else {
          checkOutMutation.mutate({})
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
                Face Verification Required
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3">
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
            </div>
          </div>

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
              </div>

              {/* Instructions */}
              <div className={clsx(
                "flex items-center gap-2 p-3 rounded-lg",
                verificationResult === 'success' ? "bg-green-50 text-green-700" :
                  verificationResult === 'failed' ? "bg-red-50 text-red-700" :
                    "bg-blue-50 text-blue-700"
              )}>
                {verificationResult === 'success' ? (
                  <CheckCircle className="w-5 h-5" />
                ) : verificationResult === 'failed' ? (
                  <XCircle className="w-5 h-5" />
                ) : (
                  <AlertCircle className="w-5 h-5" />
                )}
                <span className="text-sm">{instructions}</span>
              </div>

              {/* Camera Controls */}
              <div className="flex gap-3">
                {!isCameraActive ? (
                  <button
                    onClick={startCamera}
                    disabled={!modelsLoaded}
                    className="flex-1 btn-primary flex items-center justify-center gap-2"
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
                      disabled={!faceDetected || isVerifying}
                      className={clsx(
                        "flex-1 flex items-center justify-center gap-2",
                        mode === 'check-in' ? "btn-success" : "btn-danger"
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
