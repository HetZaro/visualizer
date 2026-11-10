import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnalyzer, createFft } from '../src/index.ts';

const SAMPLE_RATE = 44100;

function sine(hz: number, seconds: number, amplitude = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  }
  return out;
}

test('fft rejects sizes that are not a power of two', () => {
  assert.throws(() => createFft(1000), RangeError);
  assert.throws(() => createFft(0), RangeError);
});

test('fft finds the bin and amplitude of a sine wave', () => {
  const fft = createFft(2048);
  const out = new Float32Array(fft.binCount);
  // Bin-centred frequency so the whole amplitude lands in one bin.
  const bin = 46;
  const hz = (bin * SAMPLE_RATE) / fft.size;
  fft.magnitudes(sine(hz, 0.2, 0.5), 0, out);
  const peak = out.indexOf(Math.max(...out));
  assert.equal(peak, bin);
  assert.ok(Math.abs(out[bin]! - 0.5) < 0.01, `magnitude ${out[bin]}`);
});

test('fft treats samples outside the input as silence', () => {
  const fft = createFft(1024);
  const out = new Float32Array(fft.binCount);
  fft.magnitudes(new Float32Array(10), -5000, out);
  assert.ok(out.every((v) => v === 0));
});

test('analyzer reports the frame count for the track length', () => {
  const analyzer = createAnalyzer({ samples: sine(440, 2), sampleRate: SAMPLE_RATE, fps: 30 });
  assert.equal(analyzer.frameCount, 60);
});

test('analyzer puts a 1 kHz tone in the band that contains 1 kHz', () => {
  const bandCount = 32;
  const minHz = 30;
  const maxHz = 16000;
  const analyzer = createAnalyzer({
    samples: sine(1000, 1),
    sampleRate: SAMPLE_RATE,
    fps: 30,
    bandCount,
    minHz,
    maxHz,
  });
  const { bands } = analyzer.frame(15);
  const loudest = bands.indexOf(Math.max(...bands));
  const expected = Math.floor((Math.log(1000 / minHz) / Math.log(maxHz / minHz)) * bandCount);
  assert.ok(Math.abs(loudest - expected) <= 1, `loudest ${loudest}, expected ~${expected}`);
  assert.equal(bands[loudest], 1);
});

test('analyzer returns zeros for silence', () => {
  const analyzer = createAnalyzer({
    samples: new Float32Array(SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    fps: 30,
  });
  const frame = analyzer.frame(10);
  assert.ok(frame.bands.every((v) => v === 0));
  assert.equal(frame.rms, 0);
  assert.equal(frame.bass, 0);
});

test('analyzer measures rms of a full-scale sine as ~0.707', () => {
  const analyzer = createAnalyzer({ samples: sine(440, 1), sampleRate: SAMPLE_RATE, fps: 30 });
  assert.ok(Math.abs(analyzer.frame(15).rms - Math.SQRT1_2) < 0.01);
});

test('analyzer output depends only on the frame index, not on call order', () => {
  const samples = new Float32Array(SAMPLE_RATE * 2);
  // Tone that starts halfway, so neighbouring frames differ and decay matters.
  samples.set(sine(220, 1), SAMPLE_RATE);
  const options = { samples, sampleRate: SAMPLE_RATE, fps: 30 };

  const sequential = createAnalyzer(options);
  let expected = sequential.frame(0);
  for (let i = 1; i <= 40; i++) expected = sequential.frame(i);

  const seeking = createAnalyzer(options);
  seeking.frame(59);
  seeking.frame(3);
  const actual = seeking.frame(40);

  assert.deepEqual(actual.bands, expected.bands);
  assert.deepEqual(actual.waveform, expected.waveform);
  assert.equal(actual.rms, expected.rms);
});

test('analyzer holds a falling band for a few frames, then releases it', () => {
  const samples = new Float32Array(SAMPLE_RATE * 2);
  samples.set(sine(1000, 1), 0);
  const analyzer = createAnalyzer({ samples, sampleRate: SAMPLE_RATE, fps: 30, decay: 0.75 });
  const during = Math.max(...analyzer.frame(20).bands);
  const justAfter = Math.max(...analyzer.frame(33).bands);
  const longAfter = Math.max(...analyzer.frame(50).bands);
  assert.equal(during, 1);
  assert.ok(justAfter > 0 && justAfter < 1, `just after: ${justAfter}`);
  assert.equal(longAfter, 0);
});

test('analyzer validates its options', () => {
  const samples = new Float32Array(100);
  assert.throws(() => createAnalyzer({ samples, sampleRate: 0, fps: 30 }), RangeError);
  assert.throws(() => createAnalyzer({ samples, sampleRate: SAMPLE_RATE, fps: 0 }), RangeError);
  assert.throws(
    () => createAnalyzer({ samples, sampleRate: SAMPLE_RATE, fps: 30, decay: 1 }),
    RangeError,
  );
  assert.throws(() => createAnalyzer({ samples, sampleRate: SAMPLE_RATE, fps: 30 }).frame(-1), RangeError);
});
