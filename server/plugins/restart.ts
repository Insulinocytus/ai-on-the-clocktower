import { cleanupRestart } from '../utils/db'

export default defineNitroPlugin(() => { cleanupRestart() })
