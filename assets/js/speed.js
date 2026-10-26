export function formatSpeed(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s';
  const unit = bytes < 1024 ? 0 : bytes < 1048576 ? 1 : 2;
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB'][unit]}/s`;
}

export class SpeedMeter {
  samples = new Map();
  update(id, bytes, hidden = false) {
    const now = Date.now();
    const old = this.samples.get(id);
    if (hidden) { this.clear(id); return {downloadSpeed:0, speedFormatted:''}; }
    bytes = Math.max(0, Number(bytes) || 0);
    if (!old || bytes < old.bytes) {
      this.samples.set(id, {bytes, time:now, speed:0});
      return {downloadSpeed:0, speedFormatted:'0 B/s'};
    }
    if (now - old.time >= 200) {
      const measured = (bytes - old.bytes) * 1000 / (now - old.time);
      old.speed = measured > 0 && old.speed > 0 ? old.speed * 0.35 + measured * 0.65 : measured;
      old.bytes = bytes;
      old.time = now;
    }
    return {downloadSpeed:old.speed, speedFormatted:formatSpeed(old.speed)};
  }
  clear(id) { this.samples.delete(id); }
}
