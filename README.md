# Visualizer

SaaS platform that turns an audio track into a music visualization video:
upload audio, pick a template and format, press Generate, get an MP4.

Status: iteration 0 (render pipeline spike). No web app yet.

## Architecture in one paragraph

A Next.js modular monolith (`apps/web`) creates render jobs; stateless render
workers (`apps/renderer`) pick them up from BullMQ. The rendering engine draws
frames on a Canvas 2D–compatible surface, so the same layer code runs in the
browser preview and on the server, and pipes raw frames into FFmpeg. PostgreSQL
(Supabase) is the source of truth for jobs and credits; files live in
S3-compatible storage.

## Layout

```text
packages/
  visualizer-core/     engine core, browser + Node (currently: audio analysis)
  video-compositor/    Node only: FFmpeg argument builders and process runners
scripts/
  spike-render.ts      end-to-end pipeline spike with timing
```

Planned and not created yet: `apps/web`, `apps/renderer`, `packages/shared`,
`packages/visualizer-effects`, `packages/visualizer-templates`, `packages/config`.

## Requirements

- Node.js >= 22.18 (TypeScript runs directly through type stripping)
- FFmpeg and ffprobe on `PATH`, built with libx264 and AAC

## Commands

```bash
npm test            # unit + integration tests (node:test)
npm run typecheck   # tsc on visualizer-core
npm run spike       # render a 20 s test signal to out/spike-vertical.mp4
node scripts/spike-render.ts track.mp3 horizontal out/track.mp4
```

There are no runtime dependencies yet, so no install step is needed.

## Conventions

- Code, identifiers and docs are in English.
- FFmpeg is always spawned with an argument array built from validated values;
  user input never reaches a shell or a filtergraph string.
- Audio analysis is deterministic: a frame's features depend only on its index.
