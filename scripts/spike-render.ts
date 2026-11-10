/**
 * Iteration 0 spike: audio file -> analyzer -> RGBA frames -> FFmpeg -> MP4.
 *
 * Frames are drawn straight into a byte buffer because no canvas library is
 * installed yet. The next step replaces `drawBars` with real layers on
 * @napi-rs/canvas and re-measures; everything else stays as is.
 *
 * Usage: node scripts/spike-render.ts [audio-file] [vertical|horizontal|square] [out.mp4]
 * Without an audio file a 20-second test signal is generated.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createAnalyzer } from '../packages/visualizer-core/src/index.ts';
import type { AudioFrame } from '../packages/visualizer-core/src/index.ts';
import { decodeAudio, startEncoder } from '../packages/video-compositor/src/index.ts';

const FORMATS = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;

const FPS = 30;
const SAMPLE_RATE = 44100;
const BACKGROUND = [9, 7, 17] as const;
const PRIMARY = [141, 101, 255] as const;

const [audioArg, formatArg = 'vertical', outArg = `out/spike-${formatArg}.mp4`] = process.argv.slice(2);
if (!(formatArg in FORMATS)) {
  console.error(`Unknown format "${formatArg}". Use: ${Object.keys(FORMATS).join(', ')}`);
  process.exit(1);
}
const { width, height } = FORMATS[formatArg as keyof typeof FORMATS];
const outputPath = resolve(outArg);
mkdirSync(dirname(outputPath), { recursive: true });

const workDir = mkdtempSync(join(tmpdir(), 'visualizer-spike-'));
try {
  let audioPath = audioArg ? resolve(audioArg) : '';
  if (!audioPath) {
    audioPath = join(workDir, 'test-signal.wav');
    execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=110:d=20',
      '-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:a=0.4',
      '-filter_complex', '[0][1]amix=2,tremolo=f=2:d=0.9', '-ar', String(SAMPLE_RATE), audioPath,
    ]);
  }

  const started = performance.now();
  const samples = await decodeAudio(audioPath, SAMPLE_RATE);
  const analyzer = createAnalyzer({ samples, sampleRate: SAMPLE_RATE, fps: FPS, bandCount: 48 });
  const encoder = startEncoder({ width, height, fps: FPS, audioPath, outputPath });

  const background = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) background.set([...BACKGROUND, 255], i * 4);
  const frame = new Uint8Array(background.length);

  let drawMs = 0;
  for (let index = 0; index < analyzer.frameCount; index++) {
    const t0 = performance.now();
    frame.set(background);
    drawBars(frame, analyzer.frame(index));
    drawMs += performance.now() - t0;
    await encoder.writeFrame(frame);
  }
  await encoder.finish();

  const seconds = (performance.now() - started) / 1000;
  const duration = analyzer.frameCount / FPS;
  console.log(
    `${width}x${height}: ${analyzer.frameCount} frames in ${seconds.toFixed(1)}s ` +
      `(${(duration / seconds).toFixed(1)}x realtime), ` +
      `analysis+draw ${(drawMs / analyzer.frameCount).toFixed(1)} ms/frame -> ${outputPath}`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function drawBars(target: Uint8Array, audio: AudioFrame): void {
  const count = audio.bands.length;
  const areaWidth = Math.floor(width * 0.8);
  const slot = Math.floor(areaWidth / count);
  const barWidth = Math.max(1, slot - 4);
  const left = Math.floor((width - slot * count) / 2);
  const baseline = Math.floor(height * 0.7);
  const maxBar = Math.floor(height * 0.35);
  for (let b = 0; b < count; b++) {
    const barHeight = Math.max(4, Math.round(audio.bands[b]! * maxBar));
    const x0 = left + b * slot;
    for (let y = baseline - barHeight; y < baseline; y++) {
      let offset = (y * width + x0) * 4;
      for (let x = 0; x < barWidth; x++, offset += 4) {
        target[offset] = PRIMARY[0];
        target[offset + 1] = PRIMARY[1];
        target[offset + 2] = PRIMARY[2];
      }
    }
  }
}
