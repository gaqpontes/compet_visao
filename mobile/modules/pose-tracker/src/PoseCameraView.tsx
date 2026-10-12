import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { PoseCameraViewProps } from './PoseTracker.types';

type NativeCameraProps = Omit<PoseCameraViewProps, 'onCameraReady'> & {
  onCameraReady?: (event: { nativeEvent: { width: number; height: number; aspectRatio: number } }) => void;
};
const NativePoseCameraView = requireNativeViewManager<NativeCameraProps>('PoseTrackerModule');

export function PoseCameraView(props: PoseCameraViewProps) {
  return <NativePoseCameraView {...props} onCameraReady={(event) => props.onCameraReady?.(event.nativeEvent)} />;
}
