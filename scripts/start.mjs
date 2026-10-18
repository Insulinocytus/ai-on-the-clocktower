// Production entry for `pnpm start`: load `.env`, default to listening on 127.0.0.1 only, then boot the built Nitro server.
try {
  process.loadEnvFile()
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
// Nitro reads NITRO_HOST first, then HOST; without either it would listen on every interface.
process.env.HOST ??= '127.0.0.1'
await import('../.output/server/index.mjs')
