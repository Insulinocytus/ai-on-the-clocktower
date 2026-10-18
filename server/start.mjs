// Set before importing Nitro: its node-server entry reads the host during module evaluation.
process.env.NITRO_HOST ??= process.env.HOST ?? '127.0.0.1'
await import('../.output/server/index.mjs')
