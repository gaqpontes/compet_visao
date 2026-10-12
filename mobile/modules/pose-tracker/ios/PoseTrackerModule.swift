import ExpoModulesCore
import AVFoundation
import CoreImage
import CoreVideo
import MediaPipeTasksVision

func poseTrackerModelPath(named name: String) -> String? {
  let containingBundles = [Bundle.main, Bundle(for: PoseTrackerModule.self)]
  for bundle in containingBundles {
    if let path = bundle.path(forResource: name, ofType: "task") {
      return path
    }
    if let resourcesURL = bundle.url(forResource: "PoseTrackerResources", withExtension: "bundle"),
       let resourcesBundle = Bundle(url: resourcesURL),
       let path = resourcesBundle.path(forResource: name, ofType: "task") {
      return path
    }
  }
  return nil
}

func poseTrackerLandmarkData(_ landmark: NormalizedLandmark) -> [String: Any] {
  var point: [String: Any] = [
    "x": landmark.x, "y": landmark.y, "z": landmark.z,
    "visibility": landmark.visibility?.doubleValue ?? 1.0
  ]
  if let presence = landmark.presence { point["presence"] = presence.doubleValue }
  return point
}

private func scaledPixelBuffer(
  from source: CVPixelBuffer,
  factor: Double,
  preferredTransform: CGAffineTransform,
  context: CIContext
) -> CVPixelBuffer? {
  let sourceImage = CIImage(cvPixelBuffer: source).transformed(by: preferredTransform)
  let extent = sourceImage.extent.integral
  let width = max(1, Int((Double(extent.width) * factor).rounded()))
  let height = max(1, Int((Double(extent.height) * factor).rounded()))
  if factor == 1.0 && preferredTransform.isIdentity { return source }

  var output: CVPixelBuffer?
  let attributes: [String: Any] = [
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    kCVPixelBufferIOSurfacePropertiesKey as String: [:]
  ]
  guard CVPixelBufferCreate(
    kCFAllocatorDefault,
    width,
    height,
    kCVPixelFormatType_32BGRA,
    attributes as CFDictionary,
    &output
  ) == kCVReturnSuccess, let output else { return nil }

  let uprightImage = sourceImage.transformed(
    by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY)
  )
  let image = uprightImage.transformed(
    by: CGAffineTransform(scaleX: CGFloat(factor), y: CGFloat(factor))
  )
  context.render(
    image,
    to: output,
    bounds: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)),
    colorSpace: CGColorSpaceCreateDeviceRGB()
  )
  return output
}

public class PoseTrackerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PoseTrackerModule")

    View(PoseCameraView.self) {
      Events("onFrameResult", "onCameraReady")

      Prop("facing") { (view: PoseCameraView, facing: String) in
        view.setFacing(facing)
      }

      Prop("active") { (view: PoseCameraView, active: Bool) in
        view.setActive(active)
      }
    }

    AsyncFunction("analyzeVideo") { (uriString: String, options: [String: Any]?, promise: Promise) in
      guard let url = URL(string: uriString), url.isFileURL, url.host == nil || url.host == "" else {
        promise.reject("INVALID_URI", "Selecione um vídeo local. URLs remotas não são permitidas.")
        return
      }

      let poseModel = options?["poseModel"] as? String ?? "full"
      guard ["lite", "full", "heavy"].contains(poseModel) else {
        promise.reject("INVALID_POSE_MODEL", "Modelo de pose inválido.")
        return
      }
      guard let poseModelPath = poseTrackerModelPath(named: "pose_landmarker_\(poseModel)") else {
        promise.reject("MODEL_NOT_FOUND", "Modelo de pose \(poseModel) não encontrado no app")
        return
      }

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let detectHands = (options?["detectHands"] as? Bool) ?? false
          let handModelPath = detectHands ? poseTrackerModelPath(named: "hand_landmarker") : nil
          if detectHands && handModelPath == nil {
            promise.reject("MODEL_NOT_FOUND", "Modelo de mãos não encontrado")
            return
          }

          let requestedFps = (options?["fps"] as? NSNumber)?.doubleValue ?? 8.0
          guard requestedFps.isFinite,
                (1.0...60.0).contains(requestedFps),
                requestedFps.rounded() == requestedFps else {
            promise.reject("INVALID_FPS", "A taxa de quadros deve ser um inteiro entre 1 e 60 FPS.")
            return
          }
          let fps = requestedFps
          let frameDuration = 1.0 / fps
          let scaleName = options?["scale"] as? String ?? "one-third"
          let scaleFactor: Double
          switch scaleName {
          case "one-third": scaleFactor = 1.0 / 3.0
          case "two-thirds": scaleFactor = 2.0 / 3.0
          case "original": scaleFactor = 1.0
          default:
            promise.reject("INVALID_SCALE", "Escala de processamento inválida")
            return
          }

          let asset = AVURLAsset(url: url)
          let durationSeconds = asset.duration.seconds
          let requestedStart = (options?["startTime"] as? NSNumber)?.doubleValue ?? 0.0
          let requestedEnd = (options?["endTime"] as? NSNumber)?.doubleValue ?? durationSeconds
          guard requestedStart.isFinite, requestedStart >= 0.0,
                requestedEnd.isFinite, durationSeconds.isFinite else {
            promise.reject("INVALID_TIME_RANGE", "O intervalo de análise é inválido.")
            return
          }
          let startTime = requestedStart
          let endTime = min(durationSeconds, requestedEnd)
          guard durationSeconds.isFinite, endTime > startTime else {
            promise.reject("INVALID_TIME_RANGE", "O fim do intervalo precisa ser posterior ao início.")
            return
          }

          guard (endTime - startTime) * fps + 1 <= 4800 else {
            promise.reject("ANALYSIS_LIMIT", "Trecho muito longo. Reduza o intervalo ou a taxa de quadros (máximo 4800 amostras).")
            return
          }

          guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            promise.reject("NO_VIDEO_TRACK", "Trilha de vídeo não encontrada")
            return
          }

          let reader = try AVAssetReader(asset: asset)
          let outputSettings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
          ]
          let readerOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: outputSettings)
          guard reader.canAdd(readerOutput) else {
            promise.reject("READER_OUTPUT_UNAVAILABLE", "Não foi possível preparar a leitura do vídeo.")
            return
          }
          reader.add(readerOutput)
          reader.timeRange = CMTimeRange(
            start: CMTime(seconds: startTime, preferredTimescale: 600),
            duration: CMTime(seconds: endTime - startTime, preferredTimescale: 600)
          )
          defer {
            if reader.status == .reading {
              reader.cancelReading()
            }
          }

          let poseOptions = PoseLandmarkerOptions()
          poseOptions.baseOptions.modelAssetPath = poseModelPath
          poseOptions.runningMode = .video
          poseOptions.numPoses = 1
          poseOptions.minPoseDetectionConfidence = 0.4
          poseOptions.minPosePresenceConfidence = 0.5
          poseOptions.minTrackingConfidence = 0.4
          let poseLandmarker = try PoseLandmarker(options: poseOptions)

          var handLandmarker: HandLandmarker?
          if detectHands, let handModelPath = handModelPath {
            let handOptions = HandLandmarkerOptions()
            handOptions.baseOptions.modelAssetPath = handModelPath
            handOptions.runningMode = .video
            handOptions.numHands = 2
            handLandmarker = try HandLandmarker(options: handOptions)
          }
          guard reader.startReading() else {
            throw reader.error ?? NSError(
              domain: "PoseTrackerModule",
              code: 1,
              userInfo: [NSLocalizedDescriptionKey: "Não foi possível iniciar a leitura do vídeo."]
            )
          }

          var lastAnalyzedTime = -1.0

          var results: [[String: Any]] = []
          let imageContext = CIContext(options: [.useSoftwareRenderer: false])
          let preferredTransform = videoTrack.preferredTransform

          while let sampleBuffer = readerOutput.copyNextSampleBuffer() {
            let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
            if timestamp < startTime { continue }
            if timestamp > endTime { break }
            if lastAnalyzedTime < 0 || (timestamp - lastAnalyzedTime) >= frameDuration {
              lastAnalyzedTime = timestamp

              if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer),
                 let processingBuffer = scaledPixelBuffer(
                  from: pixelBuffer,
                  factor: scaleFactor,
                  preferredTransform: preferredTransform,
                  context: imageContext
                 ),
                 let image = try? MPImage(pixelBuffer: processingBuffer) {
                let timestampMs = Int(timestamp * 1000)

                let poseResult = try? poseLandmarker.detect(videoFrame: image, timestampInMilliseconds: timestampMs)
                var poses: [[ [String: Any] ]] = []
                if let pRes = poseResult {
                  for landmarkList in pRes.landmarks {
                    poses.append(landmarkList.map(poseTrackerLandmarkData))
                  }
                }

                var hands: [[String: Any]] = []
                if let handLandmarker = handLandmarker,
                   let hRes = try? handLandmarker.detect(videoFrame: image, timestampInMilliseconds: timestampMs) {
                  for (idx, landmarkList) in hRes.landmarks.enumerated() {
                    let handedness = (idx < hRes.handednesses.count ? hRes.handednesses[idx].first?.categoryName : nil) ?? "Hand"
                    hands.append([
                      "handedness": handedness,
                      "landmarks": landmarkList.map { lm in
                        [
                          "x": lm.x,
                          "y": lm.y,
                          "z": lm.z
                        ]
                      }
                    ])
                  }
                }

                results.append([
                  "timestampMs": timestampMs,
                  "poses": poses,
                  "worldPoses": poseResult?.worldLandmarks.map { landmarks in
                    landmarks.map { ["x": $0.x, "y": $0.y, "z": $0.z] }
                  } ?? [],
                  "imageSize": ["width": CVPixelBufferGetWidth(processingBuffer), "height": CVPixelBufferGetHeight(processingBuffer)],
                  "hands": hands
                ])
              }
            }
          }

          if reader.status == .failed {
            throw reader.error ?? NSError(
              domain: "PoseTrackerModule",
              code: 2,
              userInfo: [NSLocalizedDescriptionKey: "Falha durante a leitura do vídeo."]
            )
          }

          promise.resolve(results)
        } catch {
          promise.reject("ERROR", error.localizedDescription)
        }
      }
    }
  }
}
