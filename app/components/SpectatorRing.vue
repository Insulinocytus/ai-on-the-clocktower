<script setup lang="ts">
import { ROLES } from '#shared/game/roles'
import type { GameConfig, GameEvent, Grimoire, PublicState, RoleId } from '#shared/types/game'

const props = defineProps<{
  config: GameConfig
  grimoire: Grimoire
  publicState: PublicState
  title: string
  events: GameEvent[]
  focusedSeat: number | undefined
}>()
defineEmits<{ focus: [seat: number] }>()
const { t, locale } = useI18n()
const language = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))
const alive = computed(() =>
  props.grimoire.seats.length
    ? props.grimoire.seats.filter((seat) => seat.alive).length
    : props.publicState.seats.filter((seat) => seat.alive).length,
)
const toldRoles = computed(() => {
  const roles = new Map<number, RoleId>()
  for (const event of props.events) {
    if (
      event.type === 'told' &&
      (event.kind === 'role' || event.kind === 'imp') &&
      'role' in event.content
    )
      roles.set(event.seat, event.content.role)
  }
  return roles
})
const seats = computed(() =>
  props.config.seats.map((preset, index) => ({
    number: index + 1,
    preset: preset.name,
    state: props.grimoire.seats.find((seat) => seat.seat === index + 1),
    role:
      props.grimoire.seats.find((seat) => seat.seat === index + 1)?.role ??
      toldRoles.value.get(index + 1),
    publicSeat: props.publicState.seats.find((seat) => seat.seat === index + 1),
  })),
)
function position(index: number) {
  const angle = (index / props.config.seatCount) * Math.PI * 2 - Math.PI / 2
  return {
    left: `${String(50 + 39 * Math.cos(angle))}%`,
    top: `${String(50 + 39 * Math.sin(angle))}%`,
  }
}
</script>

<template>
  <section class="min-h-0 overflow-auto bg-paper2 px-3 py-6" :aria-label="t('spectator.grimoire')">
    <div
      class="mx-auto mb-4 flex max-w-xl items-center justify-between text-xs text-muted-foreground"
    >
      <h2 class="font-medium">{{ t('spectator.grimoire') }}</h2>
      <span>{{ t('spectator.atSeq', { seq: grimoire.seq }) }}</span>
    </div>
    <div
      class="relative mx-auto aspect-square w-full max-w-[640px]"
      :style="{ minWidth: config.seatCount > 10 ? '600px' : '420px' }"
    >
      <div
        class="pointer-events-none absolute inset-[11%] rounded-full border border-dashed border-rule"
      ></div>
      <div class="absolute inset-[30%] flex flex-col items-center justify-center gap-3 text-center">
        <h3 class="text-lg font-semibold leading-snug">{{ title }}</h3>
        <p class="text-sm text-muted-foreground">
          {{ t('spectator.alive', { alive, total: config.seatCount }) }}
        </p>
        <p class="text-sm">{{ t('spectator.threshold', { count: Math.ceil(alive / 2) }) }}</p>
        <p v-if="publicState.aboutToBeExecuted !== null" class="text-xs font-medium text-accent">
          {{ t('spectator.executionSeat', { seat: publicState.aboutToBeExecuted }) }}
        </p>
        <p class="text-xs text-muted-foreground">{{ t('spectator.footprintHint') }}</p>
      </div>
      <ol>
        <li
          v-for="(seat, index) in seats"
          :key="seat.number"
          class="absolute w-[118px] -translate-x-1/2 -translate-y-1/2"
          :style="position(index)"
        >
          <button
            type="button"
            class="w-full rounded-xl border-2 bg-paper2 p-2.5 text-center text-xs shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            :aria-label="t('spectator.footprint', { seat: seat.number })"
            :aria-pressed="focusedSeat === seat.number"
            :class="[
              seat.state?.alignment === 'evil'
                ? 'border-accent'
                : seat.role
                  ? 'border-ink2'
                  : 'border-rule',
              !(seat.state?.alive ?? seat.publicSeat?.alive ?? true)
                ? 'bg-paper3 text-muted-foreground'
                : '',
              focusedSeat === seat.number ? 'ring-2 ring-accent2 ring-offset-2' : '',
              publicState.aboutToBeExecuted === seat.number
                ? 'outline-2 outline-offset-4 outline-accent2'
                : '',
            ]"
            @click="$emit('focus', seat.number)"
          >
            <p class="font-semibold">{{ t('games.seat', { seat: seat.number }) }}</p>
            <p class="my-1 break-words font-medium text-ink2">{{ seat.preset }}</p>
            <p :title="seat.role ? ROLES[seat.role].ability[language] : undefined">
              {{ seat.role ? ROLES[seat.role].name[language] : t('spectator.unknownRole') }}
            </p>
            <p v-if="seat.state?.believedRole" class="mt-1 text-ink2">
              {{ t('spectator.believes', { role: ROLES[seat.state.believedRole].name[language] }) }}
            </p>
            <div
              v-if="!seat.state && seat.publicSeat && !seat.publicSeat.alive"
              class="mt-1 text-[10px]"
            >
              {{ t('spectator.dead') }} ·
              {{ t(seat.publicSeat.voteUsed ? 'spectator.voteUsed' : 'spectator.voteAvailable') }}
            </div>
            <div
              v-if="seat.state"
              class="mt-1 flex flex-wrap justify-center gap-x-1.5 gap-y-1 text-[10px]"
            >
              <span v-if="!seat.state.alive" class="font-semibold">{{ t('spectator.dead') }}</span>
              <span v-if="!seat.state.alive">{{
                t(seat.state.voteUsed ? 'spectator.voteUsed' : 'spectator.voteAvailable')
              }}</span>
              <span v-if="seat.state.poisoned" class="text-ink2">{{
                t('spectator.poisoned')
              }}</span>
              <span v-if="seat.state.protected" class="text-ink2">{{
                t('spectator.protected')
              }}</span>
              <span v-if="seat.state.abilityUsed">{{ t('spectator.abilityUsed') }}</span>
              <span v-if="seat.state.master !== null">{{
                t('spectator.master', { seat: seat.state.master })
              }}</span>
              <span v-if="grimoire.redHerring === seat.number">{{
                t('spectator.redHerring')
              }}</span>
              <span v-if="seat.state.registeredRole">{{
                t('spectator.registeredRole', {
                  role: ROLES[seat.state.registeredRole].name[language],
                })
              }}</span>
              <span v-if="seat.state.registeredAlignment">{{
                t('spectator.registeredAlignment', {
                  alignment: t(`spectator.${seat.state.registeredAlignment}`),
                })
              }}</span>
            </div>
            <p
              v-if="publicState.aboutToBeExecuted === seat.number"
              class="mt-1 font-semibold text-accent"
            >
              {{ t('spectator.execution') }}
            </p>
          </button>
        </li>
      </ol>
    </div>
  </section>
</template>
