export function average(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export function poissonProbabilityOver(lambda, line) {
  if (!Number.isFinite(lambda) || lambda < 0 || !Number.isFinite(line)) return null;
  const threshold = Math.floor(line);
  let cumulative = 0;
  let term = Math.exp(-lambda);
  cumulative = term;
  for (let k = 1; k <= Math.max(0, threshold); k++) {
    term *= lambda / k;
    cumulative += term;
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

export function confidence(sampleCount) {
  if (sampleCount >= 10) return "media";
  if (sampleCount >= 5) return "bassa";
  return "insufficiente";
}
