export function normalizeQueueLimit(value) {
  const n=typeof value==='number' || typeof value==='string' && value.trim()!==''?Number(value):NaN;
  return Number.isFinite(n)?Math.max(0,Math.min(12,Math.floor(n))):6;
}
