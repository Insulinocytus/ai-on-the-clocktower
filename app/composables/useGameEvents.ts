import type { GameEvent } from '#shared/rules/types'

export function useGameEvents(id: string) {
  const events = shallowRef<GameEvent[]>([])
  const disconnected = ref(false)
  const error = ref('')
  const loading = ref(true)
  let source: EventSource | undefined
  let disposed = false
  const merge = (incoming: GameEvent[]) => {
    if (disposed) return
    const bySeq = new Map(events.value.map(event => [event.seq, event]))
    for (const event of incoming) bySeq.set(event.seq, event)
    events.value = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
    if (incoming.some(event => event.type === 'game.ended' || event.type === 'game.aborted')) { source?.close(); disconnected.value = false }
  }
  const backfill = async () => {
    let contiguous = 0
    for (const event of events.value) { if (event.seq !== contiguous + 1) break; contiguous = event.seq }
    try {
      merge(await $fetch<GameEvent[]>(`/api/games/${encodeURIComponent(id)}/events`, { query: { observer: 'spectator', after: contiguous }, headers: { Accept: 'application/json' } }))
      error.value = ''
    } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
    finally { loading.value = false }
  }
  const start = async (live: boolean) => {
    if (!live) { await backfill(); return }
    source = new EventSource(`/api/games/${encodeURIComponent(id)}/events?observer=spectator&after=0`)
    source.onopen = () => { disconnected.value = false; void backfill() }
    source.onmessage = message => {
      try { merge([JSON.parse(message.data) as GameEvent]) }
      catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
    }
    source.onerror = () => { disconnected.value = true; loading.value = false }
  }
  onUnmounted(() => { disposed = true; source?.close() })
  return { events, disconnected, error, loading, start, backfill }
}
