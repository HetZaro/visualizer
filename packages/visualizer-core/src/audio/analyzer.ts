import { createFft } from './fft.ts';

/** Audio features for a single video frame. All values are normalized to 0..1. */
export interface AudioFrame {
  /** Log-spaced frequency bands, low to high, with peak-hold decay applied. */
  readonly bands: Float32Array;
  /** Time-domain samples centred on the frame, range -1..1. */
  readonly waveform: Float32Array;
  /** Root-mean-square level of the analysis window. */
  readonly rms: number;
  /** Mean level of the lowest, middle and highest thirds of `bands`. */
  readonly bass: number;
  readonly mid: number;
  readonly high: number;
}

export interface AnalyzerOptions {
  /** Mono PCM, range -1..1. */
  samples: Float32Array;
  sampleRate: number;
  fps: number;
  fftSize?: number;
  bandCount?: number;
  waveformSize?: number;
  minHz?: number;
  maxHz?: number;
  /** Level mapped to 0. */
  minDb?: number;
  /** Level mapped to 1. */
  maxDb?: number;
  /** Per-frame multiplier for falling bands (0 = no hold, closer to 1 = slower fall). */
  decay?: number;
}

export interface Analyzer {
  readonly frameCount: number;
  readonly bandCount: number;
  /**
   * Returns features for a frame. The result depends only on the frame index,
   * never on call order, so preview seeking and server rendering agree.
   */
  frame(index: number): AudioFrame;
}

/** Frames of history that contribute to the peak-hold decay. */
const HOLD_FRAMES = 8;
const CACHE_LIMIT = 64;

export function createAnalyzer(options: AnalyzerOptions): Analyzer {
  const {
    samples,
    sampleRate,
    fps,
    fftSize = 2048,
    bandCount = 64,
    waveformSize = 512,
    minHz = 30,
    minDb = -80,
    maxDb = -10,
    decay = 0.75,
  } = options;
  const maxHz = Math.min(options.maxHz ?? 16000, sampleRate / 2);

  if (!(sampleRate > 0)) throw new RangeError('sampleRate must be positive');
  if (!(fps > 0)) throw new RangeError('fps must be positive');
  if (!Number.isInteger(bandCount) || bandCount < 1) {
    throw new RangeError('bandCount must be a positive integer');
  }
  if (!(minHz > 0 && minHz < maxHz)) throw new RangeError('Require 0 < minHz < maxHz');
  if (!(decay >= 0 && decay < 1)) throw new RangeError('decay must be in [0, 1)');

  const fft = createFft(fftSize);
  const magnitudes = new Float32Array(fft.binCount);
  const hzPerBin = sampleRate / fftSize;
  const frameCount = Math.ceil((samples.length / sampleRate) * fps);

  // Band edges as FFT bin indices, log-spaced; every band covers at least one bin.
  const edges = new Uint32Array(bandCount + 1);
  for (let b = 0; b <= bandCount; b++) {
    const hz = minHz * Math.pow(maxHz / minHz, b / bandCount);
    const bin = Math.round(hz / hzPerBin);
    const floor = b === 0 ? 1 : edges[b - 1]! + 1;
    edges[b] = Math.min(fft.binCount, Math.max(floor, bin));
  }

  const rawCache = new Map<number, Float32Array>();

  function centreSample(index: number): number {
    return Math.round((index / fps) * sampleRate);
  }

  function rawBands(index: number): Float32Array {
    const cached = rawCache.get(index);
    if (cached) return cached;
    const out = new Float32Array(bandCount);
    fft.magnitudes(samples, centreSample(index) - fftSize / 2, magnitudes);
    for (let b = 0; b < bandCount; b++) {
      let peak = 0;
      for (let i = edges[b]!; i < edges[b + 1]!; i++) {
        if (magnitudes[i]! > peak) peak = magnitudes[i]!;
      }
      const db = 20 * Math.log10(peak + 1e-9);
      out[b] = Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
    }
    if (rawCache.size >= CACHE_LIMIT) {
      rawCache.delete(rawCache.keys().next().value!);
    }
    rawCache.set(index, out);
    return out;
  }

  function mean(values: Float32Array, from: number, to: number): number {
    if (to <= from) return 0;
    let sum = 0;
    for (let i = from; i < to; i++) sum += values[i]!;
    return sum / (to - from);
  }

  return {
    frameCount,
    bandCount,
    frame(index) {
      if (!Number.isInteger(index) || index < 0) {
        throw new RangeError(`Frame index must be a non-negative integer, got ${index}`);
      }
      const bands = new Float32Array(bandCount);
      let weight = 1;
      for (let k = 0; k <= HOLD_FRAMES && index - k >= 0; k++) {
        const raw = rawBands(index - k);
        for (let b = 0; b < bandCount; b++) {
          const held = raw[b]! * weight;
          if (held > bands[b]!) bands[b] = held;
        }
        weight *= decay;
      }

      const centre = centreSample(index);
      const waveform = new Float32Array(waveformSize);
      const waveStart = centre - waveformSize / 2;
      for (let i = 0; i < waveformSize; i++) {
        const src = Math.floor(waveStart + i);
        waveform[i] = src >= 0 && src < samples.length ? samples[src]! : 0;
      }

      let sumSquares = 0;
      const rmsStart = centre - fftSize / 2;
      for (let i = 0; i < fftSize; i++) {
        const src = rmsStart + i;
        const s = src >= 0 && src < samples.length ? samples[src]! : 0;
        sumSquares += s * s;
      }

      const third = Math.max(1, Math.floor(bandCount / 3));
      return {
        bands,
        waveform,
        rms: Math.min(1, Math.sqrt(sumSquares / fftSize)),
        bass: mean(bands, 0, third),
        mid: mean(bands, third, Math.min(bandCount, 2 * third)),
        high: mean(bands, Math.min(bandCount, 2 * third), bandCount),
      };
    },
  };
}
