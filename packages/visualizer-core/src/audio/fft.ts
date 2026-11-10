/**
 * Radix-2 FFT with a Hann window, producing amplitude-normalized magnitudes.
 *
 * Runs unchanged in the browser and in Node: no platform APIs are used.
 * A full-scale sine wave (amplitude 1.0) yields a magnitude of ~1.0 at its bin.
 */
export interface Fft {
  readonly size: number;
  /** Number of output bins: size / 2. */
  readonly binCount: number;
  /**
   * Computes magnitudes of `size` samples of `input` starting at `offset`.
   * Samples outside the input are treated as silence.
   */
  magnitudes(input: Float32Array, offset: number, out: Float32Array): void;
}

export function createFft(size: number): Fft {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError(`FFT size must be a power of two >= 2, got ${size}`);
  }
  const binCount = size / 2;
  const window = new Float64Array(size);
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    window[i] = w;
    windowSum += w;
  }
  // Scale so that a sine of amplitude A reports magnitude A.
  const scale = 2 / windowSum;

  const cos = new Float64Array(binCount);
  const sin = new Float64Array(binCount);
  for (let i = 0; i < binCount; i++) {
    const angle = (-2 * Math.PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  const reversed = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reversed[i] = r;
  }

  const re = new Float64Array(size);
  const im = new Float64Array(size);

  return {
    size,
    binCount,
    magnitudes(input, offset, out) {
      if (out.length < binCount) {
        throw new RangeError(`Output needs ${binCount} bins, got ${out.length}`);
      }
      for (let i = 0; i < size; i++) {
        const src = offset + i;
        const sample = src >= 0 && src < input.length ? input[src]! : 0;
        const dst = reversed[i]!;
        re[dst] = sample * window[i]!;
        im[dst] = 0;
      }
      for (let len = 2; len <= size; len <<= 1) {
        const half = len >> 1;
        const step = size / len;
        for (let start = 0; start < size; start += len) {
          for (let k = 0; k < half; k++) {
            const c = cos[k * step]!;
            const s = sin[k * step]!;
            const a = start + k;
            const b = a + half;
            const tr = re[b]! * c - im[b]! * s;
            const ti = re[b]! * s + im[b]! * c;
            re[b] = re[a]! - tr;
            im[b] = im[a]! - ti;
            re[a] = re[a]! + tr;
            im[a] = im[a]! + ti;
          }
        }
      }
      for (let i = 0; i < binCount; i++) {
        out[i] = Math.hypot(re[i]!, im[i]!) * scale;
      }
    },
  };
}
