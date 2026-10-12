package expo.modules.posetracker

import android.media.MediaMetadataRetriever
import android.net.Uri
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

class PoseTrackerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("PoseTrackerModule")

        View(PoseCameraView::class) {
            Events("onFrameResult", "onCameraReady")

            Prop("facing") { view: PoseCameraView, facing: String ->
                view.setFacing(facing)
            }

            Prop("active") { view: PoseCameraView, active: Boolean ->
                view.setActive(active)
            }
        }

        AsyncFunction("analyzeVideo") Coroutine { uriString: String, options: Map<String, Any>? ->
            val mediaUri = Uri.parse(uriString)
            require(mediaUri.scheme in setOf("file", "content") && (mediaUri.scheme != "file" || mediaUri.host.isNullOrEmpty())) {
                "Selecione um vídeo local. URLs remotas não são permitidas."
            }
            val context = appContext.reactContext ?: throw Exception("Context not found")
            val requestedFps = (options?.get("fps") as? Number)?.toDouble() ?: 8.0
            require(requestedFps.isFinite() && requestedFps in 1.0..60.0 && requestedFps % 1.0 == 0.0) {
                "A taxa de quadros deve ser um inteiro entre 1 e 60 FPS."
            }
            val fps = requestedFps.roundToInt()
            val intervalUs = 1_000_000L / fps
            val detectHands = options?.get("detectHands") as? Boolean ?: false
            val poseModel = options?.get("poseModel") as? String ?: "full"
            require(poseModel in setOf("lite", "full", "heavy")) { "Modelo de pose inválido." }
            val scaleFactor = when (options?.get("scale") as? String ?: "one-third") {
                "one-third" -> 1.0 / 3.0
                "two-thirds" -> 2.0 / 3.0
                "original" -> 1.0
                else -> throw IllegalArgumentException("Escala de processamento inválida")
            }

            withContext(Dispatchers.IO) {
                val retriever = MediaMetadataRetriever()
                var poseLandmarker: PoseLandmarker? = null
                var handLandmarker: HandLandmarker? = null
                try {
                    retriever.setDataSource(context, mediaUri)

                    val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    val durationMs = durationStr?.toLongOrNull() ?: 0L
                    val durationUs = durationMs * 1000L
                    val requestedStart = (options?.get("startTime") as? Number)?.toDouble() ?: 0.0
                    require(requestedStart.isFinite() && requestedStart >= 0.0) {
                        "O início do intervalo é inválido."
                    }
                    val startUs = (requestedStart * 1_000_000.0).toLong().coerceAtMost(durationUs)
                    val requestedEnd = (options?.get("endTime") as? Number)?.toDouble() ?: durationMs / 1000.0
                    require(requestedEnd.isFinite()) { "O fim do intervalo é inválido." }
                    val endUs = (requestedEnd * 1_000_000.0).toLong().coerceAtMost(durationUs)
                    require(endUs > startUs) { "O fim do intervalo precisa ser posterior ao início." }
                    require((endUs - startUs).toDouble() / 1_000_000.0 * fps + 1 <= 4800) {
                        "Trecho muito longo. Reduza o intervalo ou a taxa de quadros (máximo 4800 amostras)."
                    }

                    val poseBase = BaseOptions.builder().setModelAssetPath("pose_landmarker_${poseModel}.task").build()
                    val poseOptions = PoseLandmarker.PoseLandmarkerOptions.builder()
                        .setBaseOptions(poseBase)
                        .setRunningMode(RunningMode.VIDEO)
                        .setNumPoses(1)
                        .setMinPoseDetectionConfidence(0.4f)
                        .setMinPosePresenceConfidence(0.5f)
                        .setMinTrackingConfidence(0.4f)
                        .build()
                    poseLandmarker = PoseLandmarker.createFromOptions(context, poseOptions)

                    if (detectHands) {
                        val handBase = BaseOptions.builder().setModelAssetPath("hand_landmarker.task").build()
                        val handOptions = HandLandmarker.HandLandmarkerOptions.builder()
                            .setBaseOptions(handBase)
                            .setRunningMode(RunningMode.VIDEO)
                            .setNumHands(2)
                            .build()
                        handLandmarker = HandLandmarker.createFromOptions(context, handOptions)
                    }

                    val results = mutableListOf<Map<String, Any>>()
                    val totalFrames = ((endUs - startUs) / intervalUs).toInt() + 1

                    for (frameIndex in 0 until totalFrames) {
                        val currentUs = startUs + frameIndex * intervalUs
                        val sourceBitmap = retriever.getFrameAtTime(
                            currentUs,
                            MediaMetadataRetriever.OPTION_CLOSEST
                        ) ?: continue
                        val scaledWidth = (sourceBitmap.width * scaleFactor).roundToInt().coerceAtLeast(1)
                        val scaledHeight = (sourceBitmap.height * scaleFactor).roundToInt().coerceAtLeast(1)
                        val processingBitmap = if (
                            scaledWidth == sourceBitmap.width && scaledHeight == sourceBitmap.height
                        ) sourceBitmap else Bitmap.createScaledBitmap(
                            sourceBitmap,
                            scaledWidth,
                            scaledHeight,
                            true
                        )
                        val mpImage = BitmapImageBuilder(processingBitmap).build()
                        val timestampMs = currentUs / 1000L

                        try {
                            val poseResult = poseLandmarker!!.detectForVideo(mpImage, timestampMs)
                            val handResult = handLandmarker?.detectForVideo(mpImage, timestampMs)

                            val posesList = poseResult.landmarks().map { landmarkList ->
                                landmarkList.map { lm ->
                                    mutableMapOf<String, Any>(
                                        "x" to lm.x(), "y" to lm.y(), "z" to lm.z(),
                                        "visibility" to lm.visibility().orElse(1.0f)
                                    ).apply { lm.presence().ifPresent { put("presence", it) } }
                                }
                            }

                            val handsList = handResult?.let { result ->
                                result.landmarks().mapIndexed { index, landmarkList ->
                                    val handedness = try {
                                        result.handednesses()[index][0].categoryName()
                                    } catch (e: Exception) {
                                        "Hand"
                                    }
                                    mapOf(
                                        "handedness" to handedness,
                                        "landmarks" to landmarkList.map { lm ->
                                            mapOf("x" to lm.x(), "y" to lm.y(), "z" to lm.z())
                                        }
                                    )
                                }
                            } ?: emptyList()

                            results.add(
                                mapOf(
                                    "timestampMs" to timestampMs,
                                    "poses" to posesList,
                                    "worldPoses" to poseResult.worldLandmarks().map { points -> points.map { lm ->
                                        mapOf("x" to lm.x(), "y" to lm.y(), "z" to lm.z())
                                    } },
                                    "imageSize" to mapOf("width" to processingBitmap.width, "height" to processingBitmap.height),
                                    "hands" to handsList
                                )
                            )
                        } finally {
                            if (processingBitmap !== sourceBitmap) processingBitmap.recycle()
                            sourceBitmap.recycle()
                        }
                    }
                    results
                } finally {
                    retriever.release()
                    poseLandmarker?.close()
                    handLandmarker?.close()
                }
            }
        }
    }
}
