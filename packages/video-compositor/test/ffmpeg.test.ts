import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDecodeArgs, buildEncodeArgs, decodeAudio, startEncoder } from '../src/index.ts';

const base = { width: 1080, height: 1920, fps: 30, audioPath: '/tmp/in.wav', outputPath: '/tmp/out.mp4' };

test('encode args describe the raw input and the mp4 output', () => {
  const args = buildEncodeArgs(base);
  assert.equal(args[args.indexOf('-s') + 1], '1080x1920');
  assert.equal(args[args.indexOf('-r') + 1], '30');
  assert.equal(args.at(-1), '/tmp/out.mp4');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('+faststart'));
});

test('encode args reject invalid dimensions, fps and quality', () => {
  assert.throws(() => buildEncodeArgs({ ...base, width: 1081 }), RangeError);
  assert.throws(() => buildEncodeArgs({ ...base, height: 100000 }), RangeError);
  assert.throws(() => buildEncodeArgs({ ...base, fps: 0 }), RangeError);
  assert.throws(() => buildEncodeArgs({ ...base, fps: 29.97 }), RangeError);
  // @ts-expect-error: quality outside the union must be rejected at runtime too.
  assert.throws(() => buildEncodeArgs({ ...base, quality: 'ultra' }), RangeError);
});

test('paths that look like options or URLs are rejected', () => {
  assert.throws(() => buildEncodeArgs({ ...base, audioPath: '-i' }), TypeError);
  assert.throws(() => buildEncodeArgs({ ...base, audioPath: 'http://example.com/a.mp3' }), TypeError);
  assert.throws(() => buildEncodeArgs({ ...base, outputPath: 'concat:a|b' }), TypeError);
  assert.throws(() => buildEncodeArgs({ ...base, outputPath: '' }), TypeError);
  assert.throws(() => buildDecodeArgs('file:///etc/passwd', 44100), TypeError);
});

test('decode args request mono float PCM at the given rate', () => {
  const args = buildDecodeArgs('/tmp/in.mp3', 44100);
  assert.equal(args[args.indexOf('-ar') + 1], '44100');
  assert.equal(args[args.indexOf('-ac') + 1], '1');
  assert.equal(args.at(-1), 'pipe:1');
});

test('decodes audio and encodes frames into a playable mp4', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compositor-test-'));
  try {
    const audioPath = join(dir, 'tone.wav');
    const outputPath = join(dir, 'out.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=1', '-ar', '44100', audioPath]);

    const samples = await decodeAudio(audioPath, 44100);
    assert.ok(Math.abs(samples.length - 44100) < 100, `decoded ${samples.length} samples`);

    const width = 64;
    const height = 64;
    const encoder = startEncoder({ width, height, fps: 10, audioPath, outputPath, quality: 'draft' });
    await assert.rejects(encoder.writeFrame(new Uint8Array(10)), RangeError);
    const frame = new Uint8Array(width * height * 4).fill(255);
    for (let i = 0; i < 10; i++) await encoder.writeFrame(frame);
    await encoder.finish();

    assert.ok(statSync(outputPath).size > 0);
    const probe = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', outputPath,
    ]).toString();
    assert.match(probe, /h264,64,64/);
    assert.match(probe, /aac/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing ffmpeg process rejects instead of hanging', async () => {
  const encoder = startEncoder({ ...base, width: 64, height: 64, audioPath: '/nonexistent/in.wav' });
  await assert.rejects(encoder.finish(), /ffmpeg exited/);
  await assert.rejects(decodeAudio('/nonexistent/in.wav', 44100), /ffmpeg exited/);
});
