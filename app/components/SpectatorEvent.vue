<script setup lang="ts">
import type { GameConfig, GameEvent, Lang, Observer } from '#shared/rules/types'
import { canSee } from '#shared/rules'
import { renderEvent } from '#shared/templates'
const props = defineProps<{ event: GameEvent; events: GameEvent[]; config: GameConfig; observer: Observer; reasoning: boolean }>()
const { t, locale } = useI18n()
const isSpeech = computed(() => props.event.type === 'public.speech' || props.event.type === 'whisper.speech')
const isDecision = computed(() => props.event.type === 'contestant.decision' || props.event.type === 'storyteller.decision')
const decision = computed(() => {
  const current = props.event
  if (current.type === 'contestant.decision' || current.type === 'storyteller.decision') return current
  if ('decisionSeq' in current && current.decisionSeq !== null) return props.events.find(event => event.seq === current.decisionSeq && (event.type === 'contestant.decision' || event.type === 'storyteller.decision'))
  if (current.type === 'nomination') return props.events.findLast(event => event.seq < current.seq && event.type === 'contestant.decision' && event.seat === current.nominator && event.request.kind === 'nominate' && event.outcome.ok && event.outcome.call.args.nominee === current.nominee)
  return undefined
})
const innerReasoning = computed(() => {
  const record = decision.value
  if (!props.reasoning || !record || !canSee(record, props.observer) || !('outcome' in record) || !record.outcome.ok) return null
  const text = record.outcome.call.args.reasoning
  return typeof text === 'string' ? text : null
})
const text = computed(() => {
  const event = props.event
  if (event.type !== 'contestant.decision' && event.type !== 'storyteller.decision') return renderEvent(event, { lang: locale.value as Lang, person: 'spectator' })
  if (!event.outcome.ok) return `${t('spectator.invalid')}: ${event.outcome.error}`
  const { reasoning: _reasoning, memo: _memo, ...args } = event.outcome.call.args
  if ('speech' in args) return typeof args.speech === 'string' ? args.speech : t('spectator.pass')
  return `${event.outcome.call.tool}: ${JSON.stringify(args)}`
})
const falseInformation = computed(() => {
  const current = props.event
  if (current.type !== 'told' || current.kind !== 'ability' || (props.observer.kind !== 'spectator' && props.observer.kind !== 'storyteller')) return false
  const prior = props.events.findLast(event => event.seq < current.seq && event.type === 'ability.resolved' && event.seat === current.seat && event.as === current.ability)
  return prior?.type === 'ability.resolved' && prior.told?.deviates
})
</script>

<template>
  <article v-if="text !== null" class="event-item" :class="{ speech: isSpeech, whisper: event.type === 'whisper.speech', losing: isDecision }">
    <div v-if="'seat' in event && event.seat !== undefined" class="event-author">{{ t('spectator.seat', { n: event.seat }) }} <span class="muted">{{ config.seats[event.seat - 1]?.name }}</span><span v-if="isDecision" class="seat-status">{{ t('spectator.unadopted') }}</span></div>
    <span v-if="!isSpeech" class="event-seq">#{{ event.seq }}</span><span class="event-text">{{ text }}</span>
    <span v-if="falseInformation" class="seat-status error">{{ t('spectator.falseInfo') }}</span>
    <details v-if="innerReasoning" class="reasoning"><summary>{{ t('spectator.reasoning') }} <span v-if="decision && 'durationMs' in decision" class="muted">{{ (decision.durationMs / 1000).toFixed(1) }}s · {{ decision.model }}</span></summary>{{ innerReasoning }}</details>
    <details v-if="isDecision && 'response' in event" class="reasoning"><summary>{{ t('spectator.raw') }}</summary><pre>{{ JSON.stringify(event.response, null, 2) }}</pre></details>
  </article>
</template>
