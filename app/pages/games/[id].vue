<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GameEvent } from '#shared/types/game'
import type { GameSummary } from '#shared/types/game-view'
import { channelBlocks } from '#shared/game/channels'
import { fold, foldPublic } from '#shared/game/rules'

definePageMeta({ spectator: true })
const route = useRoute()
const { t } = useI18n()
const id = String(route.params.id)
const { data: game, error: loadError, refresh } = await useFetch<GameSummary>(`/api/games/${id}`)
const events = ref<GameEvent[]>([])
const error = ref('')
const replay = computed(() => game.value?.status === 'ended' || game.value?.status === 'aborted')
const following = ref(!replay.value)
const selectedKey = ref<string>()
const aborting = ref(false)
let source: EventSource | undefined

const blocks = computed(() =>
  channelBlocks(events.value)
    .filter((block) => block.kind !== 'allocation')
    .map((block) => ({
      ...block,
      title:
        block.kind === 'room'
          ? t('spectator.blocks.room', { members: block.members?.join(', ') ?? '' }) +
            ((block.occurrence ?? 1) > 1 ? t('spectator.roundSuffix', { round: block.round }) : '')
          : t(`spectator.blocks.${block.kind}`),
    })),
)
const latest = computed(() =>
  blocks.value.reduce<(typeof blocks.value)[number] | undefined>(
    (last, block) => (!last || block.end > last.end ? block : last),
    undefined,
  ),
)
const selected = computed(() =>
  following.value
    ? latest.value
    : (blocks.value.find((block) => block.key === selectedKey.value) ?? blocks.value[0]),
)
const selectedIndex = computed(() =>
  blocks.value.findIndex((block) => block.key === selected.value?.key),
)
const prefix = computed(() =>
  events.value.filter((event) => event.seq <= (selected.value?.end ?? 0)),
)
const grimoire = computed(() => fold(prefix.value))
const publicState = computed(() => foldPublic(prefix.value, game.value?.config.seatCount ?? 5))

function select(key: string) {
  selectedKey.value = key
  following.value = !replay.value && key === latest.value?.key
}
function navigate(offset: number) {
  const block = blocks.value[selectedIndex.value + offset]
  if (block) select(block.key)
}
function follow() {
  following.value = true
  selectedKey.value = latest.value?.key
}

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
    void catchUp(events.value.at(-1)?.seq ?? 0)
  }
  source.onerror = () => {
    if (!replay.value) error.value = t('games.reconnecting')
  }
})
onUnmounted(() => source?.close())
</script>

<template>
  <section class="flex h-[calc(100dvh-61px)] min-h-[700px] min-w-[1160px] flex-col">
    <p v-if="loadError" role="alert" class="p-6 text-destructive">
      {{ apiErrorMessage(loadError) }}
    </p>
    <template v-if="game">
      <header class="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <NuxtLink to="/games" class="mr-1 text-sm text-muted-foreground underline">{{
          t('games.title')
        }}</NuxtLink>
        <h1 class="mr-2 font-semibold">{{ t('games.game') }} {{ id.slice(0, 8) }}</h1>
        <Badge variant="outline">{{ replay ? t('games.replay') : t('games.live') }}</Badge>
        <Badge variant="secondary">{{ t(`games.${game.status}`) }}</Badge>
        <div v-if="game.replayable" class="ml-auto flex items-center gap-2">
          <template v-if="replay">
            <Button
              variant="outline"
              size="sm"
              :disabled="selectedIndex <= 0"
              @click="navigate(-1)"
              >{{ t('spectator.previous') }}</Button
            >
            <span class="min-w-12 text-center text-xs tabular-nums text-muted-foreground"
              >{{ selectedIndex + 1 }} / {{ blocks.length }}</span
            >
            <Button
              variant="outline"
              size="sm"
              :disabled="selectedIndex >= blocks.length - 1"
              @click="navigate(1)"
              >{{ t('spectator.next') }}</Button
            >
          </template>
          <Button
            v-else-if="!following"
            variant="outline"
            size="sm"
            class="text-rose-700"
            @click="follow"
            >{{ t('spectator.returnLive') }}</Button
          >
          <span v-else class="mr-2 text-xs text-rose-700">{{ t('spectator.following') }}</span>
          <Button variant="outline" size="sm" as-child>
            <NuxtLink :to="{ path: '/games/new', query: { template: id } }">{{
              t('games.template')
            }}</NuxtLink>
          </Button>
        </div>
        <Button
          v-if="!replay"
          variant="destructive"
          size="sm"
          :disabled="aborting"
          @click="abort"
          >{{ t('games.abort') }}</Button
        >
      </header>
      <p v-if="!game.replayable" role="alert" class="p-6 text-destructive">
        {{ t('games.incompatible') }}
      </p>
      <p v-else-if="error" role="status" class="border-b px-5 py-2 text-sm text-destructive">
        {{ error }}
      </p>
      <div
        v-if="game.replayable"
        class="grid min-h-0 flex-1 grid-cols-[220px_minmax(460px,1fr)_minmax(420px,1.1fr)]"
      >
        <SpectatorChannels :blocks="blocks" :selected="selected?.key" @select="select" />
        <SpectatorRing
          :config="game.config"
          :grimoire="grimoire"
          :public-state="publicState"
          :title="selected?.title ?? t('spectator.loading')"
        />
        <SpectatorFeed
          :events="selected?.events ?? []"
          :title="selected?.title ?? t('spectator.loading')"
          :block-key="selected?.key"
          :following="following"
        />
      </div>
    </template>
  </section>
</template>
