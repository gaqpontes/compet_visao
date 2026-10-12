import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { getLandmarkConfidence } from '../../modules/pose-tracker/src/landmark-confidence';
import { NormalizedLandmark, HandLandmarkResult } from 'pose-tracker';

const POSE_CONNECTIONS: [number, number][] = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // Tronco
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Braço esquerdo
  [11, 13], [13, 15],
  // Braço direito
  [12, 14], [14, 16],
  // Perna esquerda
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  // Perna direita
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Polegar
  [0, 5], [5, 6], [6, 7], [7, 8],       // Indicador
  [0, 9], [9, 10], [10, 11], [11, 12],  // Médio
  [0, 13], [13, 14], [14, 15], [15, 16],// Anelar
  [0, 17], [17, 18], [18, 19], [19, 20],// Mínimo
  [5, 9], [9, 13], [13, 17],            // Palma
];

const isVisible = (point: NormalizedLandmark) =>
  getLandmarkConfidence(point) !== null &&
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  point.x >= 0 && point.x <= 1 &&
  point.y >= 0 && point.y <= 1;

export type PoseOverlayProps = {
  poses?: NormalizedLandmark[][];
  hands?: HandLandmarkResult[];
  width: number;
  height: number;
  mirrored?: boolean;
};

export default function PoseOverlay({ poses, hands, width, height, mirrored = false }: PoseOverlayProps) {
  if ((!poses || poses.length === 0) && (!hands || hands.length === 0)) {
    return null;
  }

  const getX = (normalizedX: number) => {
    return mirrored ? (1 - normalizedX) * width : normalizedX * width;
  };

  return (
    <View pointerEvents="none" style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        {/* Conexões de Pose */}
        {poses?.map((personLandmarks, pIdx) => (
          <React.Fragment key={`pose-conn-${pIdx}`}>
            {POSE_CONNECTIONS.map(([start, end], cIdx) => {
              const p1 = personLandmarks[start];
              const p2 = personLandmarks[end];
              if (!p1 || !p2 || !isVisible(p1) || !isVisible(p2)) {
                return null;
              }
              return (
                <Line
                  key={`p-line-${cIdx}`}
                  x1={getX(p1.x)}
                  y1={p1.y * height}
                  x2={getX(p2.x)}
                  y2={p2.y * height}
                  stroke={(p1.visibility ?? 1) < 0.3 || (p2.visibility ?? 1) < 0.3 ? '#FBBF24' : '#00E5FF'}
                  strokeDasharray={(p1.visibility ?? 1) < 0.3 || (p2.visibility ?? 1) < 0.3 ? '5 4' : undefined}
                  strokeWidth="3"
                />
              );
            })}
          </React.Fragment>
        ))}

        {/* Pontos de Pose */}
        {poses?.map((personLandmarks, pIdx) => (
          <React.Fragment key={`pose-pts-${pIdx}`}>
            {personLandmarks.map((lm, ptIdx) => {
              if (!isVisible(lm)) return null;
              return (
                <Circle
                  key={`p-pt-${ptIdx}`}
                  cx={getX(lm.x)}
                  cy={lm.y * height}
                  r="4"
                  fill={(lm.visibility ?? 1) < 0.3 ? '#FBBF24' : '#FF0055'}
                />
              );
            })}
          </React.Fragment>
        ))}

        {/* Conexões de Mãos */}
        {hands?.map((hand, hIdx) => (
          <React.Fragment key={`hand-conn-${hIdx}`}>
            {HAND_CONNECTIONS.map(([start, end], cIdx) => {
              const p1 = hand.landmarks[start];
              const p2 = hand.landmarks[end];
              if (!p1 || !p2 || !isVisible(p1) || !isVisible(p2)) return null;
              return (
                <Line
                  key={`h-line-${hIdx}-${cIdx}`}
                  x1={getX(p1.x)}
                  y1={p1.y * height}
                  x2={getX(p2.x)}
                  y2={p2.y * height}
                  stroke="#00FF66"
                  strokeWidth="2"
                />
              );
            })}
          </React.Fragment>
        ))}

        {/* Pontos de Mãos */}
        {hands?.map((hand, hIdx) => (
          <React.Fragment key={`hand-pts-${hIdx}`}>
            {hand.landmarks.map((lm, ptIdx) => {
              if (!isVisible(lm)) return null;
              return <Circle
                key={`h-pt-${hIdx}-${ptIdx}`}
                cx={getX(lm.x)}
                cy={lm.y * height}
                r="3"
                fill="#FFDD00"
              />;
            })}
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
