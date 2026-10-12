package expo.modules.posetracker

import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.interfaces.permissions.PermissionsStatus
import java.util.concurrent.Executors

class PoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    // PreviewView owns Android children; React Native only sizes this outer view.
    override val shouldUseAndroidLayout = true
    val onFrameResult by EventDispatcher()
    val onCameraReady by EventDispatcher()
    private var lastImageWidth = 0
    private var lastImageHeight = 0

    private val previewView = PreviewView(context)
    private var cameraExecutor = Executors.newSingleThreadExecutor()

    private var poseLandmarker: PoseLandmarker? = null
    private var handLandmarker: HandLandmarker? = null

    private var facingFront = true
    private var isActive = true
    private var viewAttached = false
    private var permissionRequestInFlight = false

    init {
        // TextureView supports the rounded, scrollable container and pose overlay.
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        addView(
            previewView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        initLandmarkers()
    }

    fun setFacing(facing: String) {
        val newFacingFront = facing == "front"
        if (facingFront != newFacingFront) {
            facingFront = newFacingFront
            startCamera()
        }
    }

    fun setActive(active: Boolean) {
        if (isActive != active) {
            isActive = active
            if (active) {
                startCamera()
            } else {
                stopCamera()
            }
        }
    }

    private fun initLandmarkers() {
        if (poseLandmarker != null && handLandmarker != null) return
        var newPoseLandmarker: PoseLandmarker? = null
        var newHandLandmarker: HandLandmarker? = null
        try {
            val poseBase = BaseOptions.builder().setModelAssetPath("pose_landmarker_lite.task").build()
            val poseOptions = PoseLandmarker.PoseLandmarkerOptions.builder()
                .setBaseOptions(poseBase)
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumPoses(1)
                .setMinPoseDetectionConfidence(0.4f)
                .setMinPosePresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.4f)
                .setResultListener { result: PoseLandmarkerResult, _: MPImage ->
                    handlePoseResult(result)
                }
                .setErrorListener { error ->
                    Log.e("PoseCameraView", "PoseLandmarker error: ${error.message}")
                }
                .build()
            newPoseLandmarker = PoseLandmarker.createFromOptions(context, poseOptions)

            val handBase = BaseOptions.builder().setModelAssetPath("hand_landmarker.task").build()
            val handOptions = HandLandmarker.HandLandmarkerOptions.builder()
                .setBaseOptions(handBase)
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumHands(2)
                .setResultListener { result: HandLandmarkerResult, _: MPImage ->
                    handleHandResult(result)
                }
                .setErrorListener { error ->
                    Log.e("PoseCameraView", "HandLandmarker error: ${error.message}")
                }
                .build()
            newHandLandmarker = HandLandmarker.createFromOptions(context, handOptions)
            poseLandmarker = newPoseLandmarker
            handLandmarker = newHandLandmarker
        } catch (e: Exception) {
            newHandLandmarker?.close()
            newPoseLandmarker?.close()
            Log.e("PoseCameraView", "Failed to init landmarkers: ${e.message}")
        }
    }

    private val resultLock = Any()
    private val pendingPoses = mutableMapOf<Long, Map<String, Any>>()
    private val inputDimensions = mutableMapOf<Long, Map<String, Int>>()
    private val pendingHands = mutableMapOf<Long, List<Map<String, Any>>>()
    private var lastFrameTimestampMs = 0L

    private fun handlePoseResult(result: PoseLandmarkerResult) {
        val posesList = mutableListOf<List<Map<String, Any>>>()
        result.landmarks().forEach { landmarkList ->
            val points = landmarkList.map { lm ->
                mutableMapOf<String, Any>(
                    "x" to lm.x(), "y" to lm.y(), "z" to lm.z(),
                    "visibility" to lm.visibility().orElse(1.0f)
                ).apply { lm.presence().ifPresent { put("presence", it) } }
            }
            posesList.add(points)
        }
        synchronized(resultLock) {
            pendingPoses[result.timestampMs()] = mapOf(
                "poses" to posesList,
                "worldPoses" to result.worldLandmarks().map { points -> points.map { lm ->
                    mapOf("x" to lm.x(), "y" to lm.y(), "z" to lm.z())
                } },
                "imageSize" to (inputDimensions.remove(result.timestampMs()) ?: emptyMap<String, Int>())
            )
            trimPendingResults()
        }
        emitFrameIfReady(result.timestampMs())
        postDelayed({ emitFrameIfReady(result.timestampMs(), allowWithoutHands = true) }, 80)
    }

    private fun handleHandResult(result: HandLandmarkerResult) {
        val handsList = mutableListOf<Map<String, Any>>()
        result.landmarks().forEachIndexed { index, landmarkList ->
            val handedness = try {
                result.handednesses()[index][0].categoryName()
            } catch (e: Exception) {
                "Hand"
            }
            val points = landmarkList.map { lm ->
                mapOf(
                    "x" to lm.x(),
                    "y" to lm.y(),
                    "z" to lm.z()
                )
            }
            handsList.add(
                mapOf(
                    "handedness" to handedness,
                    "landmarks" to points
                )
            )
        }

        synchronized(resultLock) {
            pendingHands[result.timestampMs()] = handsList
            trimPendingResults()
        }
        emitFrameIfReady(result.timestampMs())
    }

    private fun trimPendingResults() {
        while (pendingPoses.size > 8) {
            val oldest = pendingPoses.keys.minOrNull() ?: break
            pendingPoses.remove(oldest)
        }
        while (pendingHands.size > 8) {
            val oldest = pendingHands.keys.minOrNull() ?: break
            pendingHands.remove(oldest)
        }
    }

    private fun emitFrameIfReady(timestampMs: Long, allowWithoutHands: Boolean = false) {
        val eventData = synchronized(resultLock) {
            val poses = pendingPoses[timestampMs] ?: return
            val hands = pendingHands[timestampMs] ?: if (allowWithoutHands) emptyList() else return
            pendingPoses.remove(timestampMs)
            pendingHands.remove(timestampMs)
            poses + mapOf("timestampMs" to timestampMs, "hands" to hands)
        }
        post { onFrameResult(eventData) }
    }

    private fun startCamera() {
        if (!viewAttached || !isActive) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestCameraPermission()
            return
        }
        val lifecycleOwner = appContext.currentActivity as? LifecycleOwner ?: return
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)

        cameraProviderFuture.addListener({
            if (!viewAttached || !isActive) return@addListener
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .build()

            imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                processImageProxy(imageProxy)
            }

            val cameraSelector = if (facingFront) {
                CameraSelector.DEFAULT_FRONT_CAMERA
            } else {
                CameraSelector.DEFAULT_BACK_CAMERA
            }

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageAnalysis
                )
            } catch (exc: Exception) {
                Log.e("PoseCameraView", "Use case binding failed", exc)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun requestCameraPermission() {
        if (permissionRequestInFlight) return
        val permissions = appContext.permissions
        if (permissions == null) {
            Log.e("PoseCameraView", "Expo permissions service is unavailable")
            return
        }
        permissionRequestInFlight = true
        permissions.askForPermissions({ result ->
            permissionRequestInFlight = false
            if (result[Manifest.permission.CAMERA]?.status == PermissionsStatus.GRANTED) {
                startCamera()
            } else {
                Log.w("PoseCameraView", "Camera permission was not granted")
            }
        }, Manifest.permission.CAMERA)
    }

    private fun processImageProxy(imageProxy: ImageProxy) {
        try {
            val source = imageProxy.toBitmap()
            val rotation = imageProxy.imageInfo.rotationDegrees
            val bitmap = if (rotation == 0) source else Bitmap.createBitmap(
                source, 0, 0, source.width, source.height,
                Matrix().apply { postRotate(rotation.toFloat()) }, true
            )
            if (bitmap !== source) source.recycle()
            if (bitmap.width != lastImageWidth || bitmap.height != lastImageHeight) {
                lastImageWidth = bitmap.width
                lastImageHeight = bitmap.height
                val dimensions = mapOf("width" to bitmap.width, "height" to bitmap.height, "aspectRatio" to bitmap.width.toDouble() / bitmap.height)
                post { onCameraReady(dimensions) }
            }
            val mpImage = BitmapImageBuilder(bitmap).build()
            val timestamp = synchronized(resultLock) {
                val current = SystemClock.elapsedRealtime()
                maxOf(current, lastFrameTimestampMs + 1).also { lastFrameTimestampMs = it }
            }

            synchronized(resultLock) {
                inputDimensions[timestamp] = mapOf("width" to bitmap.width, "height" to bitmap.height)
                while (inputDimensions.size > 8) {
                    val oldest = inputDimensions.keys.minOrNull() ?: break
                    inputDimensions.remove(oldest)
                }
            }
            poseLandmarker?.detectAsync(mpImage, timestamp)
            handLandmarker?.detectAsync(mpImage, timestamp)
        } catch (e: Exception) {
            Log.e("PoseCameraView", "Failed to process camera frame", e)
        } finally {
            imageProxy.close()
        }
    }

    private fun stopCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            cameraProvider.unbindAll()
        }, ContextCompat.getMainExecutor(context))
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        viewAttached = true
        if (cameraExecutor.isShutdown) {
            cameraExecutor = Executors.newSingleThreadExecutor()
        }
        initLandmarkers()
        if (isActive) {
            startCamera()
        }
    }

    override fun onDetachedFromWindow() {
        viewAttached = false
        super.onDetachedFromWindow()
        stopCamera()
        cameraExecutor.shutdown()
        poseLandmarker?.close()
        handLandmarker?.close()
        poseLandmarker = null
        handLandmarker = null
    }
}
