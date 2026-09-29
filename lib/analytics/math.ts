function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    sum += value;
  }
  return finiteOrNull(sum / values.length);
}

export function variance(values: readonly number[]): number | null {
  const avg = mean(values);
  if (avg === null) return null;
  let sumOfSquares = 0;
  for (const value of values) {
    const deviation = value - avg;
    sumOfSquares += deviation * deviation;
  }
  return finiteOrNull(sumOfSquares / values.length);
}

export function sampleVariance(values: readonly number[]): number | null {
  const avg = mean(values);
  if (avg === null || values.length < 2) return null;
  let sumOfSquares = 0;
  for (const value of values) {
    const deviation = value - avg;
    sumOfSquares += deviation * deviation;
  }
  return finiteOrNull(sumOfSquares / (values.length - 1));
}

export function standardDeviation(values: readonly number[]): number | null {
  const weightedVariance = variance(values);
  if (weightedVariance === null) return null;
  return finiteOrNull(Math.sqrt(weightedVariance));
}

export function sampleStandardDeviation(values: readonly number[]): number | null {
  const weightedSampleVariance = sampleVariance(values);
  if (weightedSampleVariance === null) return null;
  return finiteOrNull(Math.sqrt(weightedSampleVariance));
}

export function covariance(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  if (xs.length !== ys.length) return null;
  const meanX = mean(xs);
  const meanY = mean(ys);
  if (meanX === null || meanY === null) return null;
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) {
    total += (xs[i] - meanX) * (ys[i] - meanY);
  }
  return finiteOrNull(total / xs.length);
}

export function sampleCovariance(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  if (xs.length !== ys.length) return null;
  if (xs.length < 2) return null;
  const population = covariance(xs, ys);
  if (population === null) return null;
  return finiteOrNull((population * xs.length) / (xs.length - 1));
}