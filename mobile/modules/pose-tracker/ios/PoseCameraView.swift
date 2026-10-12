import ExpoModulesCore
import UIKit
import AVFoundation
import MediaPipeTasksVision

public class PoseCameraView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate, PoseLandmarkerLiveStreamDelegate, HandLandmarkerLiveStreamDelegate {
  public let onFrameResult = EventDispatcher()
  public let onCameraReady = EventDispatcher()
  private var lastImageWidth = 0
  private var lastImageHeight = 0
  private var inputDimensions: [Int: [String: Int]] = [:]

  private var captureSession: AVCaptureSession?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private let sessionQueue = DispatchQueue(label: "pose.tracker.sessionQueue")

  private var poseLandmarker: PoseLandmarker?
  private var handLandmarker: HandLandmarker?

  private var facingFront: Bool = true
  private var isActive: Bool = true
  private var viewAttached = false

  private let resultLock = NSLock()
  private var pendingPoseResults: [Int: [String: Any]] = [:]
  private var pendingHandResults: [Int: [[String: Any]]] = [:]
  private var lastFrameTimestampMs = 0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    setupLandmarkers()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
  }

  func setFacing(_ facing: String) {
    let newFacing = facing == "front"
    if facingFront != newFacing {
      facingFront = newFacing
      restartCamera()
    }
  }

  func setActive(_ active: Bool) {
    if isActive != active {
      isActive = active
      if active {
        startCamera()
      } else {
        stopCamera()
      }
    }
  }

  private func setupLandmarkers() {
    guard let poseModelPath = poseTrackerModelPath(named: "pose_landmarker_lite"),
          let handModelPath = poseTrackerModelPath(named: "hand_landmarker") else {
      return
    }

    let poseOptions = PoseLandmarkerOptions()
    poseOptions.baseOptions.modelAssetPath = poseModelPath
    poseOptions.runningMode = .liveStream
    poseOptions.numPoses = 1
    poseOptions.minPoseDetectionConfidence = 0.4
    poseOptions.minPosePresenceConfidence = 0.5
    poseOptions.minTrackingConfidence = 0.4
    poseOptions.poseLandmarkerLiveStreamDelegate = self
    poseLandmarker = try? PoseLandmarker(options: poseOptions)

    let handOptions = HandLandmarkerOptions()
    handOptions.baseOptions.modelAssetPath = handModelPath
    handOptions.runningMode = .liveStream
    handOptions.numHands = 2
    handOptions.handLandmarkerLiveStreamDelegate = self
    handLandmarker = try? HandLandmarker(options: handOptions)
  }

  public func poseLandmarker(_ poseLandmarker: PoseLandmarker, didFinishDetection result: PoseLandmarkerResult?, timestampInMilliseconds: Int, error: Error?) {
    guard let result = result else { return }
    var poses: [[ [String: Any] ]] = []
    for landmarkList in result.landmarks {
      let points = landmarkList.map(poseTrackerLandmarkData)
      poses.append(points)
    }
    resultLock.lock()
    pendingPoseResults[timestampInMilliseconds] = [
      "poses": poses,
      "worldPoses": result.worldLandmarks.map { landmarks in landmarks.map { ["x": $0.x, "y": $0.y, "z": $0.z] } },
      "imageSize": inputDimensions.removeValue(forKey: timestampInMilliseconds) ?? [:]
    ]
    trimPendingResults()
    resultLock.unlock()
    emitFrameIfReady(timestampInMilliseconds)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(80)) { [weak self] in
      self?.emitFrameIfReady(timestampInMilliseconds, allowWithoutHands: true)
    }
  }

  public func handLandmarker(_ handLandmarker: HandLandmarker, didFinishDetection result: HandLandmarkerResult?, timestampInMilliseconds: Int, error: Error?) {
    guard let result = result else { return }
    var hands: [[String: Any]] = []
    for (index, landmarkList) in result.landmarks.enumerated() {
      let handedness = result.handednesses[safe: index]?.first?.categoryName ?? "Hand"
      let points = landmarkList.map { lm -> [String: Any] in
        return [
          "x": lm.x,
          "y": lm.y,
          "z": lm.z
        ]
      }
      hands.append([
        "handedness": handedness,
        "landmarks": points
      ])
    }

    resultLock.lock()
    pendingHandResults[timestampInMilliseconds] = hands
    trimPendingResults()
    resultLock.unlock()
    emitFrameIfReady(timestampInMilliseconds)
  }

  private func trimPendingResults() {
    if pendingPoseResults.count > 8, let oldest = pendingPoseResults.keys.min() {
      pendingPoseResults.removeValue(forKey: oldest)
    }
    if pendingHandResults.count > 8, let oldest = pendingHandResults.keys.min() {
      pendingHandResults.removeValue(forKey: oldest)
    }
  }

  private func emitFrameIfReady(_ timestamp: Int, allowWithoutHands: Bool = false) {
    resultLock.lock()
    let poses = pendingPoseResults[timestamp]
    let hands = pendingHandResults[timestamp] ?? (allowWithoutHands ? [] : nil)
    if poses != nil && hands != nil {
      pendingPoseResults.removeValue(forKey: timestamp)
      pendingHandResults.removeValue(forKey: timestamp)
    }
    resultLock.unlock()

    guard let poses = poses, let hands = hands else { return }
    var eventData = poses
    eventData["timestampMs"] = timestamp
    eventData["hands"] = hands
    DispatchQueue.main.async { [weak self] in
      self?.onFrameResult(eventData)
    }
  }

  private func startCamera() {
    sessionQueue.async { [weak self] in
      guard let self = self, self.isActive, self.viewAttached, self.captureSession == nil else { return }
      let session = AVCaptureSession()
      session.beginConfiguration()
      session.sessionPreset = .vga640x480

      let position: AVCaptureDevice.Position = self.facingFront ? .front : .back
      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input) else {
        session.commitConfiguration()
        return
      }

      session.addInput(input)

      let output = AVCaptureVideoDataOutput()
      output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      output.alwaysDiscardsLateVideoFrames = true
      output.setSampleBufferDelegate(self, queue: self.sessionQueue)

      if session.canAddOutput(output) {
        session.addOutput(output)
        if let connection = output.connection(with: .video) {
          if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
          if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = false
          }
        }
      }

      session.commitConfiguration()
      session.startRunning()

      self.captureSession = session

      DispatchQueue.main.async {
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        if let connection = preview.connection {
          if connection.isVideoOrientationSupported { connection.videoOrientation = .portrait }
          if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = self.facingFront
          }
        }
        preview.frame = self.bounds
        self.layer.addSublayer(preview)
        self.previewLayer = preview
      }
    }
  }

  private func stopCamera() {
    sessionQueue.async { [weak self] in
      self?.captureSession?.stopRunning()
      self?.captureSession = nil
      DispatchQueue.main.async {
        self?.previewLayer?.removeFromSuperlayer()
        self?.previewLayer = nil
      }
    }
  }

  private func restartCamera() {
    stopCamera()
    startCamera()
  }

  public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    guard let image = try? MPImage(pixelBuffer: pixelBuffer) else { return }
    let clockTimestamp = Int(ProcessInfo.processInfo.systemUptime * 1000)
    let timestamp = max(clockTimestamp, lastFrameTimestampMs + 1)
    lastFrameTimestampMs = timestamp
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    resultLock.lock()
    inputDimensions[timestamp] = ["width": width, "height": height]
    if inputDimensions.count > 8, let oldest = inputDimensions.keys.min() { inputDimensions.removeValue(forKey: oldest) }
    resultLock.unlock()
    if width != lastImageWidth || height != lastImageHeight {
      lastImageWidth = width
      lastImageHeight = height
      DispatchQueue.main.async { [weak self] in
        self?.onCameraReady(["width": width, "height": height, "aspectRatio": Double(width) / Double(height)])
      }
    }

    try? poseLandmarker?.detectAsync(image: image, timestampInMilliseconds: timestamp)
    try? handLandmarker?.detectAsync(image: image, timestampInMilliseconds: timestamp)
  }

  public override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    viewAttached = newWindow != nil
    if newWindow != nil && isActive {
      startCamera()
    } else {
      stopCamera()
    }
  }
}

private extension Collection {
  subscript(safe index: Index) -> Element? {
    return indices.contains(index) ? self[index] : nil
  }
}
