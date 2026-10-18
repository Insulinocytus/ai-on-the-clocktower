<script setup lang="ts">
import type { GameDetail } from '#shared/api'
import type { EventOf, GameEvent, Lang, Observer, RoleId } from '#shared/rules/types'
import { canSee, foldGrimoire, foldPublic, parseObserver, project } from '#shared/rules'
import { phaseLabel, roleName } from '#shared/templates'
import { adoptedDecisions, channelBlocks, involvesSeat, type ChannelBlock } from '~/lib/spectator'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
definePageMeta({ key: route => route.fullPath })
const route = useRoute()
const id = String(route.params.id)
const { t, locale } = useI18n()
const lang = computed(() => locale.value as Lang)
const { data: detail, error: detailError } = await useFetch<GameDetail>(`/api/games/${encodeURIComponent(id)}`)
const { events, disconnected, error, loading, start, backfill } = useGameEvents(id)
const live = ref(detail.value ? !['ended', 'aborted'].includes(detail.value.summary.status) : false)
const following = ref(live.value)
const selectedKey = ref('')
const focusSeat = ref<number | null>(null)
const observerParam = ref('spectator')
const observer = computed<Observer>(() => parseObserver(observerParam.value) ?? { kind: 'spectator' })
const showReasoning = ref(false)
const showLosing = ref(false)
const manualOpen = ref(false)
const submittedSeq = ref<number | null>(null)
const aborting = ref(false)
const abortError = ref('')
const feed = ref<HTMLElement>()
const config = computed(() => detail.value?.config)
const finished = computed(() => events.value.some(event => event.type === 'game.ended' || event.type === 'game.aborted') || detail.value?.summary.status === 'ended' || detail.value?.summary.status === 'aborted')
const pending = computed<EventOf<'discretion.requested'> | null>(() => {
  if (finished.value) return null
  const resolved = new Set(events.value.filter(event => event.type === 'discretion.resolved').map(event => event.requestSeq))
  return events.value.findLast(event => event.type === 'discretion.requested' && event.source === 'manual' && !resolved.has(event.seq)) as EventOf<'discretion.requested'> | undefined ?? null
})
watch(() => pending.value?.seq, seq => { if (seq) manualOpen.value = true })
const projected = computed(() => project(events.value, observer.value))
const adopted = computed(() => adoptedDecisions(events.value))
function visible(event: GameEvent): boolean {
  if (!canSee(event, observer.value)) return false
  if (event.type === 'contestant.decision') return showLosing.value && !adopted.value.has(event.seq)
  if (event.type === 'storyteller.decision') return false
  return event.type !== 'game.created'
}
const blocks = computed(() => channelBlocks(events.value).filter(block => (block.kind !== 'allocation' || showLosing.value) && (block.events.some(visible) || block.kind === 'phase')))
const selected = computed(() => following.value && live.value ? blocks.value.at(-1) : blocks.value.find(block => block.key === selectedKey.value) ?? blocks.value[0])
const cursor = computed(() => selected.value?.end ?? 0)
const publicState = computed(() => foldPublic(events.value, cursor.value))
const grimoire = computed(() => foldGrimoire(events.value, cursor.value))
const full = computed(() => observer.value.kind === 'spectator' || observer.value.kind === 'storyteller')
const seats = computed(() => (config.value?.seats ?? []).map((preset, index) => {
  const n = index + 1
  const truth = grimoire.value.seats[index]
  let role: RoleId | null = full.value ? truth?.role ?? null : null
  if (observer.value.kind === 'seat' && observer.value.seat === n) {
    const told = projected.value.findLast(event => event.seq <= cursor.value && event.type === 'told' && event.seat === n && (event.kind === 'role' || event.kind === 'became_imp'))
    if (told?.type === 'told') role = told.kind === 'role' ? told.role : 'imp'
  }
  const statuses: string[] = []
  if (full.value && truth) {
    if (truth.poisonedBy !== null) statuses.push('poisoned')
    if (truth.protectedBy !== null) statuses.push('protected')
    if (truth.abilityUsed) statuses.push('used')
    if (truth.masterOf !== null) statuses.push('master')
    if (grimoire.value.redHerring === n) statuses.push('redHerring')
  }
  const alive = full.value && truth ? truth.alive : publicState.value.alive[index] ?? true
  const ghostUsed = full.value && truth ? truth.voteTokenUsed : publicState.value.voteTokenUsed[index] ?? false
  return { n, name: preset.name, role, alignment: full.value ? truth?.alignment : null, alive, ghostUsed, statuses, believes: full.value && role === 'drunk' ? grimoire.value.drunkBelieves : null, doomed: publicState.value.aboutToDie?.seat === n }
}))
const aliveCount = computed(() => seats.value.filter(seat => seat.alive).length)
const items = computed(() => selected.value?.events.filter(visible) ?? [])
const footprint = computed(() => blocks.value.slice(0, blocks.value.indexOf(selected.value!) + 1).map(block => ({ block, events: block.events.filter(event => event.seq <= cursor.value && visible(event) && focusSeat.value !== null && involvesSeat(event, focusSeat.value)) })).filter(group => group.events.length))
function title(block: ChannelBlock): string {
  if (block.kind === 'setup') return t('spectator.setup')
  if (block.kind === 'allocation') return t('spectator.allocation', { day: block.day, round: block.round })
  if (block.kind === 'room') return t('spectator.room', { day: block.day, members: block.members?.map(n => t('spectator.seat', { n })).join(', ') }) + (block.repeated ? t('spectator.repeat', { round: block.round }) : '')
  return phaseLabel(block.phase!, block.day, lang.value)
}
function select(block: ChannelBlock) {
  selectedKey.value = block.key
  focusSeat.value = null
  following.value = live.value && block.key === blocks.value.at(-1)?.key
}
function step(direction: number) {
  const index = blocks.value.findIndex(block => block.key === selected.value?.key)
  const block = blocks.value[index + direction]
  if (block) select(block)
}
async function abortGame() {
  if (finished.value || aborting.value || !confirm(t('spectator.abortConfirm'))) return
  aborting.value = true; abortError.value = ''
  try { await $fetch(`/api/games/${encodeURIComponent(id)}/abort`, { method: 'POST' }); await backfill() }
  catch (caught) { abortError.value = caught instanceof Error ? caught.message : String(caught) }
  finally { aborting.value = false }
}
watch(() => [items.value.length, selected.value?.key, focusSeat.value], async () => {
  await nextTick()
  if (feed.value && following.value && !focusSeat.value) feed.value.scrollTop = feed.value.scrollHeight
})
watch(blocks, (current, previous) => {
  if (!following.value && selectedKey.value && !current.some(block => block.key === selectedKey.value)) {
    const oldEnd = previous?.find(block => block.key === selectedKey.value)?.end ?? 0
    selectedKey.value = current.findLast(block => block.end <= oldEnd)?.key ?? current[0]?.key ?? ''
  }
})
onMounted(async () => { if (detail.value?.summary.replayable) await start(live.value) })
</script>

<template>
  <main v-if="detailError" class="page"><p class="error" role="alert">{{ detailError.message }}</p><Button as-child variant="outline"><NuxtLink to="/">{{ t('app.games') }}</NuxtLink></Button></main>
  <main v-else-if="detail && !detail.summary.replayable" class="page"><p class="error">{{ t('spectator.notReplayable') }}</p></main>
  <main v-else-if="detail && config">
    <div class="spectator-toolbar">
      <Badge variant="secondary">{{ t(live ? 'spectator.live' : 'spectator.replay') }}</Badge>
      <strong>{{ t('games.seats', { n: config.seatCount }) }}</strong>
      <Button v-if="live && !following" size="sm" @click="following = true; focusSeat = null">{{ t('spectator.backLive') }}</Button>
      <label>{{ t('spectator.view') }} <select v-model="observerParam"><option value="spectator">{{ t('spectator.spectator') }}</option><option value="storyteller">{{ t('spectator.storyteller') }}</option><option v-for="n in config.seatCount" :key="n" :value="`seat:${n}`">{{ t('spectator.seatView', { n }) }}</option><option value="public">{{ t('spectator.public') }}</option></select></label>
      <label><input v-model="showReasoning" type="checkbox">{{ t('spectator.reasoning') }}</label>
      <label><input v-model="showLosing" type="checkbox">{{ t('spectator.losing') }}</label>
      <Button v-if="pending && submittedSeq !== pending.seq" size="sm" variant="outline" class="status-awaiting_manual" @click="manualOpen = true">{{ t('spectator.pending', { id: pending.discretion }) }}</Button>
      <Button variant="outline" size="sm" as-child style="margin-left:auto"><NuxtLink :to="{ path: '/games/new', query: { from: id } }">{{ t('games.template') }}</NuxtLink></Button>
      <Button variant="destructive" size="sm" :disabled="finished || aborting" @click="abortGame">{{ t('spectator.abort') }}</Button>
    </div>
    <p v-if="error || abortError" class="error" role="alert" style="padding:8px 20px">{{ error || abortError }} <Button v-if="error" size="sm" variant="outline" @click="backfill">{{ t('app.retry') }}</Button></p>
    <p v-if="disconnected && !finished" class="muted" role="status" style="padding:8px 20px">{{ t('spectator.connection') }}</p>
    <div class="spectator-grid" :class="{ dense: config.seatCount > 10 }">
      <aside class="channels"><h2>{{ t('spectator.channels') }}</h2><button v-for="block in blocks" :key="block.key" class="channel" :class="{ active: selected?.key === block.key, room: block.kind === 'room', allocation: block.kind === 'allocation' }" @click="select(block)">{{ title(block) }}</button><p v-if="!blocks.length" class="muted">{{ t(loading ? 'app.loading' : 'spectator.waiting') }}</p></aside>
      <section class="board"><div class="seat-ring">
        <button v-for="(seat, index) in seats" :key="seat.n" class="seat-token" :class="[seat.alignment, { dead: !seat.alive, focus: focusSeat === seat.n, doomed: seat.doomed }]" :style="{ left: `${50 + 48 * Math.cos(index / seats.length * 2 * Math.PI - Math.PI / 2)}%`, top: `${50 + 48 * Math.sin(index / seats.length * 2 * Math.PI - Math.PI / 2)}%` }" :aria-label="t('spectator.footprint', { n: seat.n })" @click="focusSeat = focusSeat === seat.n ? null : seat.n">
          <div class="seat-number">{{ seat.n }}</div><div class="seat-role">{{ seat.role ? roleName(seat.role, lang) : t('spectator.unknown') }}</div><div class="seat-model">{{ seat.name }}</div><div v-if="seat.believes" class="seat-model">{{ t('spectator.believes', { role: roleName(seat.believes, lang) }) }}</div>
          <span v-for="status in seat.statuses" :key="status" class="seat-status">{{ t(`spectator.${status}`) }}</span><span v-if="!seat.alive" class="seat-status">{{ t(seat.ghostUsed ? 'spectator.ghostUsed' : 'spectator.ghost') }}</span><span v-if="seat.doomed" class="seat-status status-awaiting_manual">{{ t('spectator.aboutToDie') }}</span>
        </button>
        <div class="ring-center"><h2>{{ selected ? title(selected) : t('spectator.setup') }}</h2><p class="muted">{{ t('spectator.alive', { alive: aliveCount, total: config.seatCount }) }}</p><p class="muted">{{ t('spectator.majority', { n: Math.ceil(aliveCount / 2) }) }}</p><p class="muted" style="font-size:10px">{{ t('spectator.hint') }}</p></div>
      </div></section>
      <section class="event-pane">
        <header class="pane-heading"><template v-if="focusSeat"><Button size="sm" variant="ghost" @click="focusSeat = null">{{ t('spectator.backChannel') }}</Button><h2>{{ t('spectator.footprint', { n: focusSeat }) }}</h2></template><template v-else><h2>{{ selected ? title(selected) : t('spectator.waiting') }}</h2><div class="actions"><Button size="sm" variant="outline" :disabled="!selected || selected.key === blocks[0]?.key" @click="step(-1)">{{ t('spectator.prev') }}</Button><Button size="sm" variant="outline" :disabled="!selected || selected.key === blocks.at(-1)?.key" @click="step(1)">{{ t('spectator.next') }}</Button></div></template></header>
        <div ref="feed" class="event-feed">
          <template v-if="focusSeat"><section v-for="group in footprint" :key="group.block.key"><h3 class="footprint-heading">{{ title(group.block) }}</h3><SpectatorEvent v-for="event in group.events" :key="event.seq" :event="event" :events="events" :config="config" :observer="observer" :reasoning="showReasoning" /></section></template>
          <template v-else><SpectatorEvent v-for="event in items" :key="event.seq" :event="event" :events="events" :config="config" :observer="observer" :reasoning="showReasoning" /><p v-if="!items.length" class="muted">{{ t('spectator.empty') }}</p></template>
        </div>
      </section>
    </div>
    <ManualDiscretion v-if="pending && submittedSeq !== pending.seq" v-model:open="manualOpen" :game-id="id" :pending="pending" :events="events" :seat-count="config.seatCount" @submitted="seq => { submittedSeq = seq; backfill() }" @abort="abortGame" />
  </main>
</template>
