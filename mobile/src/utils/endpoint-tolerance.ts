/** Fraction of the configured angular range, never a probability of accuracy. */
export const DEFAULT_ENDPOINT_TOLERANCE_PERCENT = 20;
export const MAX_ENDPOINT_TOLERANCE_PERCENT = 40;

export function getEndpointThresholds(min: number, max: number, tolerancePercent?: number) {
  if (tolerancePercent !== undefined && (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > MAX_ENDPOINT_TOLERANCE_PERCENT)) {
    throw new Error('A tolerância deve estar entre 0% e 40%.');
  }
  // Preserve historical callers that do not opt into the configurable percentage.
  const margin = tolerancePercent === undefined ? null : (max - min) * tolerancePercent / 100;
  const flexion = min + (margin ?? 5);
  const extension = max - (margin ?? 12);
  return {
    flexion, extension,
    flexionRelease: margin === null ? min + 12 : Math.min(flexion + 12, (flexion + extension) / 2),
    extensionCancel: margin === null ? max - 5 : extension,
    flexionReturn: margin === null ? min : flexion,
  };
}
