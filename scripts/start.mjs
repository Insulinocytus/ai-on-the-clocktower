import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import sirv from 'sirv'

try {
  process.loadEnvFile()
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const port = Number(process.env.PORT ?? 3000)
const assets = sirv(fileURLToPath(new URL('../.output/public', import.meta.url)), { single: true })
createServer(assets).listen(port, '127.0.0.1', () => {
  console.log(`Listening on http://127.0.0.1:${String(port)}`)
})
