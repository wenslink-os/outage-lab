// Logical clock. Simulated latencies are expressed in logical milliseconds;
// scale converts them to real wall-clock time (0.25 = four times faster than real time).

export function createScaledClock(scale = 1) {
  if (!(Number.isFinite(scale) && scale > 0)) throw new Error('Clock scale must be a positive number');
  const perf = globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance : Date;
  const origin = perf.now();
  return {
    scale,
    now() {
      return (perf.now() - origin) / scale;
    },
    sleep(ms) {
      const real = Math.max(0, ms * scale);
      return new Promise((resolve) => setTimeout(resolve, real));
    }
  };
}
