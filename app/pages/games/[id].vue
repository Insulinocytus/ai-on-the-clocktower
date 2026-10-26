<script setup lang="ts">
import Badge from '@/components/grimoire/Badge.vue'
import Button from '@/components/grimoire/Button.vue'
import { abortGame, gameEvents, getGame, resumeGame, subscribeGame } from '@/api'
import type { GameEvent, Observer } from '#shared/types/game'
import type { GameSummary } from '#shared/types/game-view'
import { renderEvent } from '#shared/event-templates'
import { channelBlocks, channelTheme } from '#shared/game/channels'
import { fold, foldPublic } from '#shared/game/rules'
import { seatFootprint, spectatorRows } from '#shared/game/spectator'

definePageMeta({ spectator: true })
const route = useRoute()
const { t, locale } = useI18n()
const id = String(route.params.id)
const game = ref<GameSummary>()
const loadError = ref<unknown>()
async function refresh() {
  try {
    game.value = await getGame(id)
    loadError.value = undefined
  } catch (cause) {
    loadError.value = cause
  }
}
await refresh()
const events = ref<GameEvent[]>([])
const error = ref('')
const replay = computed(() => game.value?.status === 'ended' || game.value?.status === 'aborted')
const following = ref(!replay.value)
const selectedKey = ref<string>()
const aborting = ref(false)
const resuming = ref(false)
const observer = ref<Observer>('spectator')
const showLosing = ref(false)
const focusedSeat = ref<number>()
let generation = 0
let disposed = false
let unsubscribe: (() => void) | undefined
let unsubscribeManual: (() => void) | undefined
const manualEvents = ref<GameEvent[]>([])
const manualOpen = ref(false)
const pending = computed(() => {
  if (
    manualEvents.value.some((event) => event.type === 'game.ended' || event.type === 'game.aborted')
  )
    return undefined
  const request = manualEvents.value.findLast(
    (event) => event.type === 'discretion.requested' && event.source === 'manual',
  )
  return request?.type === 'discretion.requested' &&
    !manualEvents.value.some(
      (event) => event.type === 'discretion.resolved' && event.seq > request.seq,
    )
    ? request
    : undefined
})
const pauses = computed(() => {
  const since = manualEvents.value.findLastIndex(
    (event) =>
      event.type === 'game.resumed' || event.type === 'game.ended' || event.type === 'game.aborted',
  )
  if (since >= 0 && manualEvents.value[since]?.type !== 'game.resumed') return []
  return manualEvents.value
    .slice(since + 1)
    .flatMap((event) => (event.type === 'game.paused' ? [event] : []))
})
watch(
  () => pending.value?.seq,
  (seq) => {
    manualOpen.value = seq !== undefined
  },
)

function mergeManual(incoming: GameEvent[]) {
  const bySeq = new Map(manualEvents.value.map((entry) => [entry.seq, entry]))
  for (const entry of incoming) bySeq.set(entry.seq, entry)
  manualEvents.value = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  if (
    manualEvents.value.some((event) => event.type === 'game.ended' || event.type === 'game.aborted')
  )
    unsubscribeManual?.()
}
async function catchUpManual() {
  try {
    const incoming = await gameEvents(id, 'spectator', manualEvents.value.at(-1)?.seq ?? 0)
    if (disposed) return
    mergeManual(incoming)
    await refresh()
  } catch (cause) {
    if (!disposed) error.value = apiErrorMessage(cause)
  }
}
function connectManual() {
  if (replay.value || !game.value?.compatible) return
  try {
    const stop = subscribeGame(
      id,
      'spectator',
      0,
      (event) => {
        if (disposed) return
        mergeManual([event])
        if (
          event.type === 'discretion.requested' ||
          event.type === 'discretion.resolved' ||
          event.type === 'game.ended' ||
          event.type === 'game.aborted' ||
          event.type === 'game.paused' ||
          event.type === 'game.resumed'
        )
          void refresh()
      },
      (cause) => {
        if (!disposed) error.value = apiErrorMessage(cause)
      },
    )
    if (
      disposed ||
      manualEvents.value.some(
        (event) => event.type === 'game.ended' || event.type === 'game.aborted',
      )
    )
      stop()
    else unsubscribeManual = stop
  } catch (cause) {
    if (!disposed) error.value = apiErrorMessage(cause)
  }
}

const blocks = computed(() =>
  channelBlocks(events.value).map((block) => ({
    ...block,
    title:
      block.kind === 'room'
        ? t('spectator.blocks.room', { members: block.members?.join(', ') ?? '' }) +
          ((block.occurrence ?? 1) > 1 ? t('spectator.roundSuffix', { round: block.round }) : '')
        : block.kind === 'allocation'
          ? t('spectator.blocks.allocation', { round: block.round })
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
const theme = computed(() => channelTheme(selected.value?.kind))
useHead({ htmlAttrs: { 'data-theme': theme } })
const selectedIndex = computed(() =>
  blocks.value.findIndex((block) => block.key === selected.value?.key),
)
const prefix = computed(() =>
  events.value.filter((event) => event.seq <= (selected.value?.end ?? 0)),
)
const grimoire = computed(() => fold(prefix.value))
const publicState = computed(() => foldPublic(prefix.value, game.value?.config.seatCount ?? 5))
const rows = computed(
  () => new Map(spectatorRows(prefix.value, showLosing.value).map((row) => [row.event.seq, row])),
)
const groups = computed(() => {
  const shown =
    focusedSeat.value === undefined
      ? selected.value
        ? [selected.value]
        : []
      : seatFootprint(
          blocks.value.slice(0, selectedIndex.value + 1),
          focusedSeat.value,
          selected.value?.end ?? 0,
        )
  return shown.map((block) => ({
    key: block.key,
    title: block.title,
    rows: block.events.flatMap((event) => {
      const row = rows.value.get(event.seq)
      return row ? [row] : []
    }),
  }))
})

function select(key: string) {
  focusedSeat.value = undefined
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
    unsubscribe?.()
    void refresh()
  }
}

async function catchUp(after: number) {
  const current = generation
  try {
    const incoming = await gameEvents(id, observer.value, after)
    if (current === generation) merge(incoming)
  } catch (cause) {
    if (current === generation) error.value = apiErrorMessage(cause)
  }
}

async function abort() {
  aborting.value = true
  try {
    game.value = await abortGame(id)
    await catchUp(events.value.at(-1)?.seq ?? 0)
    await catchUpManual()
  } catch (cause) {
    error.value = apiErrorMessage(cause)
  } finally {
    aborting.value = false
  }
}

async function resume() {
  resuming.value = true
  try {
    game.value = await resumeGame(id)
    await catchUpManual()
  } catch (cause) {
    error.value = apiErrorMessage(cause)
  } finally {
    resuming.value = false
  }
}

async function connect() {
  const current = ++generation
  unsubscribe?.()
  unsubscribe = undefined
  events.value = []
  focusedSeat.value = undefined
  if (!game.value?.compatible) return
  error.value = ''
  if (replay.value) {
    await catchUp(0)
    return
  }
  try {
    const stop = subscribeGame(
      id,
      observer.value,
      0,
      (event) => {
        if (current === generation) merge([event])
      },
      (cause) => {
        if (current === generation) error.value = apiErrorMessage(cause)
      },
    )
    if (
      current !== generation ||
      events.value.some((event) => event.type === 'game.ended' || event.type === 'game.aborted')
    )
      stop()
    else unsubscribe = stop
  } catch (cause) {
    if (current === generation) error.value = apiErrorMessage(cause)
  }
}
onMounted(() => {
  void connect()
  connectManual()
})
watch(observer, connect)
onUnmounted(() => {
  disposed = true
  generation++
  unsubscribe?.()
  unsubscribeManual?.()
})
</script>

<template>
  <section class="spectator-shell flex flex-col bg-paper text-ink" :data-theme="theme">
    <p v-if="loadError" role="alert" class="p-6 text-accent">
      {{ apiErrorMessage(loadError) }}
    </p>
    <template v-if="game">
      <header class="spectator-header flex items-center gap-3 border-b border-rule">
        <NuxtLink to="/games" class="text-sm text-ink2 underline">{{ t('games.title') }}</NuxtLink>
        <h1 class="spectator-title font-medium">{{ t('games.game') }} {{ id.slice(0, 8) }}</h1>
        <Badge>{{ replay ? t('games.replay') : t('games.live') }}</Badge>
        <Badge>{{ t(`games.${game.status}`) }}</Badge>
        <Button
          v-if="pending && game.status !== 'paused' && !manualOpen"
          variant="secondary"
          @click="manualOpen = true"
          >{{ t('manual.waiting', { discretion: pending.discretion }) }}</Button
        >
        <div v-if="game.compatible" class="ml-auto flex items-center gap-2">
          <template v-if="replay">
            <Button variant="secondary" :disabled="selectedIndex <= 0" @click="navigate(-1)">
              {{ t('spectator.previous') }}
            </Button>
            <span class="min-w-9 text-center font-serif text-xs tabular-nums text-ink2">
              {{ selectedIndex + 1 }} / {{ blocks.length }}
            </span>
            <Button
              variant="secondary"
              :disabled="selectedIndex >= blocks.length - 1"
              @click="navigate(1)"
              >{{ t('spectator.next') }}</Button
            >
          </template>
          <Button v-else-if="!following" variant="secondary" @click="follow">
            {{ t('spectator.returnLive') }}
          </Button>
          <span v-else class="mr-1 text-xs text-accent">
            {{ t('spectator.following') }}
          </span>
          <Button variant="secondary" as-child>
            <NuxtLink :to="{ path: '/games/new', query: { template: id } }">{{
              t('games.template')
            }}</NuxtLink>
          </Button>
        </div>
        <Button v-if="!replay" :disabled="aborting" @click="abort">{{ t('games.abort') }}</Button>
      </header>
      <div
        v-if="game.compatible && game.status === 'paused'"
        role="alert"
        class="spectator-pause flex items-center gap-6 border-b border-rule bg-paper3 text-sm text-ink2"
      >
        <ul v-if="pauses.length" class="flex-1 space-y-1">
          <li v-for="entry in pauses" :key="entry.seq" class="break-all">
            {{ renderEvent(entry, locale === 'zh' ? 'zh' : 'en', 'spectator') }}
          </li>
        </ul>
        <p v-else class="flex-1">{{ t('games.pageClosedPause') }}</p>
        <Button :disabled="resuming" @click="resume">{{ t('games.resume') }}</Button>
      </div>
      <SpectatorControls
        v-if="game.compatible"
        v-model:observer="observer"
        v-model:losing="showLosing"
        :seat-count="game.config.seatCount"
        :theme="theme"
      />
      <p v-if="!game.compatible" role="alert" class="p-6 text-accent">
        {{ t('games.incompatible') }}
      </p>
      <p
        v-else-if="error"
        role="status"
        class="border-b border-rule px-10 py-2 text-sm text-accent"
      >
        {{ error }}
      </p>
      <SpectatorChannels
        v-if="game.compatible"
        :blocks="blocks"
        :selected="selected?.key"
        @select="select"
      />
      <div v-if="game.compatible" class="spectator-frame grid min-h-0 flex-1">
        <SpectatorRing
          class="spectator-well"
          :config="game.config"
          :grimoire="grimoire"
          :public-state="publicState"
          :title="selected?.title ?? t('spectator.loading')"
          :events="prefix"
          :focused-seat="focusedSeat"
          @focus="focusedSeat = focusedSeat === $event ? undefined : $event"
        />
        <SpectatorFeed
          :groups="groups"
          :title="
            focusedSeat === undefined
              ? (selected?.title ?? t('spectator.loading'))
              : t('spectator.footprint', { seat: focusedSeat })
          "
          :block-key="selected?.key"
          :following="following"
          :observer="observer"
          :focused="focusedSeat !== undefined"
          @clear-focus="focusedSeat = undefined"
        />
      </div>
      <SpectatorDiscretion
        v-if="pending && game.status !== 'paused'"
        :key="pending.seq"
        v-model:open="manualOpen"
        :game-id="id"
        :config="game.config"
        :request="pending"
        :events="manualEvents"
        :aborting="aborting"
        @submitted="catchUpManual"
        @abort="abort"
      />
    </template>
  </section>
</template>

<style scoped>
.spectator-shell {
  height: calc(100dvh - var(--layout-topbar-height));
  min-height: 700px;
  min-width: 1160px;
}

.spectator-header {
  min-height: 68px;
  padding: var(--space-4) var(--space-10);
}

.spectator-title {
  font-size: var(--font-size-title);
  line-height: var(--line-height-heading);
}

.spectator-pause {
  min-height: 58px;
  padding: 10px var(--space-10);
}

.spectator-frame {
  grid-template-columns: minmax(0, var(--layout-grimoire-well)) minmax(0, var(--layout-feed-width));
  gap: var(--layout-gutter);
  padding: var(--space-4) var(--space-10);
  justify-content: center;
}

.spectator-well {
  border-radius: var(--radius-well);
}
</style>

<style>
html[data-theme] body,
html[data-theme] body *,
html[data-theme] .grain::after {
  transition-property: color, background-color, border-color, opacity;
  transition-duration: 600ms;
}

@media (prefers-reduced-motion: reduce) {
  html[data-theme] body,
  html[data-theme] body *,
  html[data-theme] .grain::after {
    transition: none;
  }
}
</style>
