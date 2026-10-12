import * as React from 'react';
import { View, StyleSheet } from 'react-native';
import { PoseCameraViewProps, FrameResult, NormalizedLandmark, HandLandmarkResult } from './PoseTracker.types';
import { getLiveWebLandmarkers } from './PoseTrackerModule.web';

export function PoseCameraView({
  facing = 'front',
  active = true,
  onFrameResult,
  onCameraReady,
  style,
  ...viewProps
}: PoseCameraViewProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const animFrameRef = React.useRef<number | null>(null);

  const onFrameResultRef = React.useRef(onFrameResult);
  onFrameResultRef.current = onFrameResult;

  const onCameraReadyRef = React.useRef(onCameraReady);
  onCameraReadyRef.current = onCameraReady;

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let isCancelled = false;

    async function startCamera() {
      if (!active) return;
      try {
        const { poseLandmarker, handLandmarker } = await getLiveWebLandmarkers();
        if (isCancelled) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing === 'front' ? 'user' : 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
            const vw = videoRef.current.videoWidth;
            const vh = videoRef.current.videoHeight;
            onCameraReadyRef.current?.({
              width: vw,
              height: vh,
              aspectRatio: vw / vh,
            });
          }

          let lastVideoTime = -1;
          const processFrame = () => {
            if (isCancelled || !videoRef.current) return;

            if (videoRef.current.readyState >= 2 && videoRef.current.currentTime !== lastVideoTime) {
              lastVideoTime = videoRef.current.currentTime;
              const now = performance.now();
              try {
                const poseResult = poseLandmarker.detectForVideo(videoRef.current, now);
                const handResult = handLandmarker.detectForVideo(videoRef.current, now);

                const poses: NormalizedLandmark[][] = (poseResult.landmarks || []).map((landmarks: any[]) =>
                  landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility, presence: l.presence }))
                );

                const hands: HandLandmarkResult[] = (handResult.landmarks || []).map((landmarks: any[], index: number) => {
                  const handednessCategory =
                    handResult.handednesses?.[index]?.[0]?.categoryName ?? 'Hand';
                  return {
                    handedness: handednessCategory,
                    landmarks: landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z })),
                  };
                });

                onFrameResultRef.current?.({
                  nativeEvent: {
                    timestampMs: Math.round(now),
                    poses,
                    worldPoses: (poseResult.worldLandmarks || []).map((landmarks: any[]) =>
                      landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility, presence: l.presence }))
                    ),
                    imageSize: { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight },
                    hands,
                  },
                });
              } catch (error) {
                console.warn('Falha ao processar quadro da câmera:', error);
              }
            }

            animFrameRef.current = requestAnimationFrame(processFrame);
          };

          animFrameRef.current = requestAnimationFrame(processFrame);
        }
      } catch (err) {
        console.error('Erro ao iniciar câmera na web:', err);
      }
    }

    startCamera();

    return () => {
      isCancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facing, active]);

  return (
    <View style={[styles.container, style]} {...viewProps}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: facing === 'front' ? 'scaleX(-1)' : 'none',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#000',
  },
});
