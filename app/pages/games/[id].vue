<script setup lang="ts">
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GameEvent } from '#shared/types/game'
import type { GameSummary } from '#shared/types/game-view'
import { renderEvent } from '#shared/event-templates'

const route = useRoute()
const { t, locale } = useI18n()
const id = String(route.params.id)
const { data: game, error: loadError, refresh } = await useFetch<GameSummary>(`/api/games/${id}`)
const events = ref<GameEvent[]>([])
const error = ref('')
const replay = computed(() => game.value?.status === 'ended' || game.value?.status === 'aborted')
const aborting = ref(false)
let source: EventSource | undefined

function merge(incoming: GameEvent[]) {
  const bySeq = new Map(events.value.map((entry) => [entry.seq, entry]))
  for (const entry of incoming) bySeq.set(entry.seq, entry)
  events.value = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  if (events.value.some((entry) => entry.type === 'game.ended' || entry.type === 'game.aborted')) {
    source?.close()
    void refresh()
  }
}

async function catchUp(after: number) {
  try {
    merge(
      await $fetch<GameEvent[]>(`/api/games/${id}/events`, {
        query: { after, observer: 'spectator' },
      }),
    )
  } catch (cause) {
    error.value = apiErrorMessage(cause)
  }
}

async function abort() {
  aborting.value = true
  try {
    game.value = await $fetch<GameSummary>(`/api/games/${id}/abort`, { method: 'POST' })
    await catchUp(events.value.at(-1)?.seq ?? 0)
  } catch (cause) {
    error.value = apiErrorMessage(cause)
  } finally {
    aborting.value = false
  }
}

const completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        tool_calls: z.array(z.object({ function: z.object({ arguments: z.string() }) })).optional(),
      }),
    }),
  ),
})
const reasoningShape = z.object({ reasoning: z.string() })
function reasoning(entry: GameEvent): string {
  if (entry.type !== 'contestant.decision') return ''
  const parsed = completion.safeParse(entry.raw)
  const args = parsed.success
    ? parsed.data.choices[0]?.message.tool_calls?.[0]?.function.arguments
    : undefined
  if (!args) return ''
  try {
    const result = reasoningShape.safeParse(JSON.parse(args) as unknown)
    return result.success ? result.data.reasoning : ''
  } catch {
    return ''
  }
}

onMounted(() => {
  if (!game.value?.replayable) return
  if (replay.value) {
    void catchUp(0)
    return
  }
  const after = events.value.at(-1)?.seq ?? 0
  source = new EventSource(`/api/games/${id}/stream?observer=spectator&after=${String(after)}`)
  source.onmessage = (message) => {
    merge([JSON.parse(String(message.data)) as GameEvent])
  }
  source.onopen = () => {
    error.value = ''
    void catchUp(after)
  }
  source.onerror = () => {
    if (!replay.value) error.value = t('games.reconnecting')
  }
})
onUnmounted(() => source?.close())
</script>

<template>
  <section class="grid gap-6">
    <NuxtLink to="/games" class="text-sm underline">{{ t('games.title') }}</NuxtLink>
    <p v-if="loadError" role="alert" class="text-destructive">{{ apiErrorMessage(loadError) }}</p>
    <template v-if="game">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-xl font-semibold">{{ t('games.game') }} {{ id.slice(0, 8) }}</h1>
        <div class="flex gap-2">
          <Button
            v-if="!replay"
            variant="destructive"
            size="sm"
            :disabled="aborting"
            @click="abort"
          >
            {{ t('games.abort') }}
          </Button>
          <Button v-if="game.replayable" variant="outline" size="sm" as-child>
            <NuxtLink :to="{ path: '/games/new', query: { template: id } }">
              {{ t('games.template') }}
            </NuxtLink>
          </Button>
          <Badge variant="outline">{{ replay ? t('games.replay') : t('games.live') }}</Badge
          ><Badge variant="secondary">{{ t(`games.${game.status}`) }}</Badge>
        </div>
      </div>
      <p class="text-sm text-muted-foreground">
        {{ game.config.seats.map((seat, index) => `${index + 1}: ${seat.name}`).join(' / ') }}
      </p>
      <p v-if="!game.replayable" role="alert" class="text-destructive">
        {{ t('games.incompatible') }}
      </p>
      <p v-else-if="error" role="status" class="text-destructive">{{ error }}</p>
      <ol v-if="game.replayable" class="divide-y rounded-lg border px-5">
        <li v-for="entry in events" :key="entry.seq" class="grid grid-cols-[3rem_1fr] gap-3 py-4">
          <span class="text-sm tabular-nums text-muted-foreground">{{ entry.seq }}</span>
          <div class="grid gap-2">
            <p class="whitespace-pre-wrap break-words leading-7">
              {{ renderEvent(entry, locale === 'zh' ? 'zh' : 'en', 'spectator') }}
            </p>
            <details v-if="entry.type === 'contestant.decision'" class="text-sm">
              <summary class="cursor-pointer text-muted-foreground">
                {{ t('games.reasoning') }}
              </summary>
              <p class="mt-2 whitespace-pre-wrap leading-6">
                {{ reasoning(entry) || t('games.noReasoning') }}
              </p>
              <pre class="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{{
                JSON.stringify(entry.raw, null, 2)
              }}</pre>
            </details>
          </div>
        </li>
      </ol>
    </template>
  </section>
</template>
