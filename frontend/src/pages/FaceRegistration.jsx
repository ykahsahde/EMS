import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { faceAPI } from '../services/api'
import { 
  Camera, ScanFace, CheckCircle, XCircle, 
  RefreshCw, AlertCircle, Trash2 
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import * as faceapi from 'face-api.js'

const FaceRegistration = () => {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [capturedImages, setCapturedImages] = useState([])
  const [faceDetected, setFaceDetected] = useState(false)
  const [instructions, setInstructions] = useState('Click "Start Camera" to begin face registration')

  // Fetch existing face data
  const { data: faceData, isLoading: faceDataLoading } = useQuery({
    queryKey: ['face-data', user?.id],
    queryFn: async () => {
      const response = await faceAPI.getStatus()
      return response.data.data
    }
  })

  // Register face mutation
  const registerFaceMutation = useMutation({
    mutationFn: (data) => faceAPI.register(data),
    onSuccess: () => {
      toast.success('Face registered successfully!')
      setCapturedImages([])
      queryClient.invalidateQueries(['face-data'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to register face')
    }
  })

  // Delete face data mutation
  const deleteFaceMutation = useMutation({
    mutationFn: () => faceAPI.delete(user.id),
    onSuccess: () => {
      toast.success('Face data deleted successfully!')
      queryClient.invalidateQueries(['face-data'])
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Failed to delete face data')
    }
  })

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        setIsLoading(true)
        const MODEL_URL = '/models' // You'll need to serve face-api models

        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ])
        
        setModelsLoaded(true)
        setInstructions('Click "Start Camera" to begin face registration')
      } catch (error) {
        console.error('Error loading face-api models:', error)
        setInstructions('Failed to load face detection models. Please refresh the page.')
      } finally {
        setIsLoading(false)
      }
    }

    loadModels()
  }, [])

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
        setInstructions('Position your face in the center. Make sure you have good lighting.')
        detectFace()
      }
    } catch (error) {
      console.error('Error accessing camera:', error)
      toast.error('Failed to access camera. Please check permissions.')
    }
  }

  // Stop camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
    }
    setIsCameraActive(false)
    setFaceDetected(false)
  }

  // Face detection loop
  const detectFace = async () => {
    if (!videoRef.current || !canvasRef.current || !modelsLoaded) return

    const detections = await faceapi.detectSingleFace(
      videoRef.current,
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks()

    const canvas = canvasRef.current
    const displaySize = { width: 640, height: 480 }
    faceapi.matchDimensions(canvas, displaySize)

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (detections) {
      setFaceDetected(true)
      setInstructions('Face detected! Click "Capture" to take a photo.')
      
      const resizedDetections = faceapi.resizeResults(detections, displaySize)
      faceapi.draw.drawDetections(canvas, resizedDetections)
      faceapi.draw.drawFaceLandmarks(canvas, resizedDetections)
    } else {
      setFaceDetected(false)
      setInstructions('Position your face in the center of the frame.')
    }

    if (isCameraActive) {
      requestAnimationFrame(detectFace)
    }
  }

  // Capture image
  const captureImage = useCallback(async () => {
    if (!videoRef.current || !faceDetected) return

    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(videoRef.current, 0, 0)

    const imageData = canvas.toDataURL('image/jpeg', 0.8)
    
    // Extract face descriptor
    const detection = await faceapi.detectSingleFace(
      videoRef.current,
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks().withFaceDescriptor()

    if (detection) {
      setCapturedImages(prev => [...prev, {
        image: imageData,
        descriptor: Array.from(detection.descriptor)
      }])
      
      if (capturedImages.length + 1 >= 3) {
        setInstructions('Great! You have captured enough images. Click "Register Face" to complete.')
      } else {
        setInstructions(`Captured ${capturedImages.length + 1}/3. Move your head slightly and capture ${3 - capturedImages.length - 1} more.`)
      }
      
      toast.success(`Photo ${capturedImages.length + 1} captured!`)
    }
  }, [faceDetected, capturedImages.length])

  // Submit registration
  const handleRegister = () => {
    if (capturedImages.length < 3) {
      toast.error('Please capture at least 3 images')
      return
    }

    registerFaceMutation.mutate({
      user_id: user.id,
      face_descriptors: capturedImages.map(img => img.descriptor),
      images: capturedImages.map(img => img.image)
    })
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera()
  }, [])

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Face Registration</h1>
          <p className="text-gray-500">Register your face for biometric attendance</p>
        </div>
      </div>

      {/* Status Card */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={clsx(
              "w-14 h-14 rounded-full flex items-center justify-center",
              faceData?.is_registered ? "bg-green-100" : "bg-gray-100"
            )}>
              <ScanFace className={clsx(
                "w-7 h-7",
                faceData?.is_registered ? "text-green-600" : "text-gray-400"
              )} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Face Registration Status</h2>
              <p className={clsx(
                "text-sm flex items-center gap-1",
                faceData?.is_registered ? "text-green-600" : "text-gray-500"
              )}>
                {faceData?.is_registered ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Face registered successfully
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" />
                    Face not registered
                  </>
                )}
              </p>
            </div>
          </div>
          {faceData?.is_registered && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete your face data? You will need to re-register.')) {
                  deleteFaceMutation.mutate()
                }
              }}
              disabled={deleteFaceMutation.isPending}
              className="btn-danger flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Face Data
            </button>
          )}
        </div>
      </div>

      {/* Camera Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Camera Feed</h3>
            
            {/* Instructions */}
            <div className={clsx(
              "p-3 rounded-lg mb-4 flex items-center gap-2",
              faceDetected ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"
            )}>
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{instructions}</p>
            </div>

            {/* Video Container */}
            <div className="relative bg-gray-900 rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
              {isLoading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
                    <p className="text-white mt-4">Loading face detection models...</p>
                  </div>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
                  />
                  {!isCameraActive && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center text-white">
                        <Camera className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p>Camera is off</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Camera Controls */}
            <div className="flex justify-center gap-4 mt-4">
              {!isCameraActive ? (
                <button
                  onClick={startCamera}
                  disabled={!modelsLoaded || isLoading}
                  className="btn-primary flex items-center gap-2"
                >
                  <Camera className="w-5 h-5" />
                  Start Camera
                </button>
              ) : (
                <>
                  <button
                    onClick={stopCamera}
                    className="btn-secondary flex items-center gap-2"
                  >
                    Stop Camera
                  </button>
                  <button
                    onClick={captureImage}
                    disabled={!faceDetected || capturedImages.length >= 5}
                    className={clsx(
                      "btn-primary flex items-center gap-2",
                      !faceDetected && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <Camera className="w-5 h-5" />
                    Capture ({capturedImages.length}/3)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Captured Images */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Captured Images</h3>
          
          {capturedImages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Camera className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No images captured yet</p>
              <p className="text-sm mt-1">Capture at least 3 images</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {capturedImages.map((img, index) => (
                  <div key={index} className="relative">
                    <img
                      src={img.image}
                      alt={`Capture ${index + 1}`}
                      className="w-full aspect-square object-cover rounded-lg"
                    />
                    <button
                      onClick={() => setCapturedImages(prev => prev.filter((_, i) => i !== index))}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              
              <div className="pt-4 border-t border-gray-100">
                <button
                  onClick={handleRegister}
                  disabled={capturedImages.length < 3 || registerFaceMutation.isPending}
                  className={clsx(
                    "w-full btn-success flex items-center justify-center gap-2",
                    capturedImages.length < 3 && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {registerFaceMutation.isPending ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Register Face
                    </>
                  )}
                </button>
                {capturedImages.length < 3 && (
                  <p className="text-xs text-gray-500 text-center mt-2">
                    Capture {3 - capturedImages.length} more image(s)
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tips */}
      <div className="card bg-gray-50">
        <h3 className="font-semibold text-gray-900 mb-3">Tips for Best Results</h3>
        <ul className="text-sm text-gray-600 space-y-2">
          <li className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5"></span>
            Ensure good, even lighting on your face - avoid shadows and backlighting
          </li>
          <li className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5"></span>
            Look directly at the camera with a neutral expression
          </li>
          <li className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5"></span>
            Slightly turn your head between captures for better recognition
          </li>
          <li className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5"></span>
            Remove glasses, hats, or anything that covers your face
          </li>
          <li className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5"></span>
            Keep your face within the frame and at a comfortable distance
          </li>
        </ul>
      </div>
    </div>
  )
}

export default FaceRegistration
