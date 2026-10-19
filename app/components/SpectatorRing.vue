<script setup lang="ts">
import { ROLES } from '#shared/game/roles'
import type { GameConfig, Grimoire, PublicState } from '#shared/types/game'

const props = defineProps<{
  config: GameConfig
  grimoire: Grimoire
  publicState: PublicState
  title: string
}>()
const { t, locale } = useI18n()
const language = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))
const alive = computed(() =>
  props.grimoire.seats.length
    ? props.grimoire.seats.filter((seat) => seat.alive).length
    : props.config.seatCount,
)
const seats = computed(() =>
  props.config.seats.map((preset, index) => ({
    number: index + 1,
    preset: preset.name,
    state: props.grimoire.seats.find((seat) => seat.seat === index + 1),
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
  <section
    class="min-h-0 overflow-auto bg-slate-50/30 px-3 py-6"
    :aria-label="t('spectator.grimoire')"
  >
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
        class="pointer-events-none absolute inset-[11%] rounded-full border border-dashed border-slate-300"
      ></div>
      <div class="absolute inset-[30%] flex flex-col items-center justify-center gap-3 text-center">
        <h3 class="text-lg font-semibold leading-snug">{{ title }}</h3>
        <p class="text-sm text-muted-foreground">
          {{ t('spectator.alive', { alive, total: config.seatCount }) }}
        </p>
        <p class="text-sm">{{ t('spectator.threshold', { count: Math.ceil(alive / 2) }) }}</p>
        <p v-if="publicState.aboutToBeExecuted !== null" class="text-xs font-medium text-rose-700">
          {{ t('spectator.executionSeat', { seat: publicState.aboutToBeExecuted }) }}
        </p>
      </div>
      <ol>
        <li
          v-for="(seat, index) in seats"
          :key="seat.number"
          class="absolute w-[118px] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 bg-white p-2.5 text-center text-xs shadow-sm"
          :class="[
            seat.state?.alignment === 'evil' ? 'border-rose-300' : 'border-blue-200',
            seat.state && !seat.state.alive ? 'bg-slate-100 text-slate-500' : '',
            publicState.aboutToBeExecuted === seat.number
              ? 'outline-2 outline-offset-4 outline-rose-600'
              : '',
          ]"
          :style="position(index)"
        >
          <p class="font-semibold">{{ t('games.seat', { seat: seat.number }) }}</p>
          <p class="my-1 break-words font-medium text-slate-800">{{ seat.preset }}</p>
          <p :title="seat.state ? ROLES[seat.state.role].ability[language] : undefined">
            {{ seat.state ? ROLES[seat.state.role].name[language] : t('spectator.unknownRole') }}
          </p>
          <p v-if="seat.state?.believedRole" class="mt-1 text-violet-700">
            {{ t('spectator.believes', { role: ROLES[seat.state.believedRole].name[language] }) }}
          </p>
          <div
            v-if="seat.state"
            class="mt-1 flex flex-wrap justify-center gap-x-1.5 gap-y-1 text-[10px]"
          >
            <span v-if="!seat.state.alive" class="font-semibold">{{ t('spectator.dead') }}</span>
            <span v-if="!seat.state.alive">{{
              t(seat.state.voteUsed ? 'spectator.voteUsed' : 'spectator.voteAvailable')
            }}</span>
            <span v-if="seat.state.poisoned" class="text-violet-700">{{
              t('spectator.poisoned')
            }}</span>
            <span v-if="seat.state.protected" class="text-blue-700">{{
              t('spectator.protected')
            }}</span>
            <span v-if="seat.state.abilityUsed">{{ t('spectator.abilityUsed') }}</span>
            <span v-if="seat.state.master !== null">{{
              t('spectator.master', { seat: seat.state.master })
            }}</span>
            <span v-if="grimoire.redHerring === seat.number">{{ t('spectator.redHerring') }}</span>
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
            class="mt-1 font-semibold text-rose-700"
          >
            {{ t('spectator.execution') }}
          </p>
        </li>
      </ol>
    </div>
  </section>
</template>
