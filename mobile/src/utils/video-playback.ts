export type VideoSeekRequest = {
  timestampMs: number;
  id: number;
  /** When present, play this segment and pause at its end. */
  endTimestampMs?: number;
};
