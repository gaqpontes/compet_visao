import { requireNativeModule } from 'expo-modules-core';
import { FrameResult, VideoAnalysisOptions } from './PoseTracker.types';

export interface PoseTrackerModuleInterface {
  analyzeVideo(uri: string, options?: VideoAnalysisOptions): Promise<FrameResult[]>;
}

export default requireNativeModule<PoseTrackerModuleInterface>('PoseTrackerModule');
