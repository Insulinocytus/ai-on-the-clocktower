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
const hintId = useId()
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
  props.config.seats.map((preset, index) => {
    const state = props.grimoire.seats.find((seat) => seat.seat === index + 1)
    const publicSeat = props.publicState.seats.find((seat) => seat.seat === index + 1)
    return {
      number: index + 1,
      preset: preset.name,
      state,
      role: state?.role ?? toldRoles.value.get(index + 1),
      publicSeat,
      dead: !(state?.alive ?? publicSeat?.alive ?? true),
      reminders: state
        ? [
            {
              visible: state.poisoned,
              icon: characterIconUrl('poisoner'),
              label: t('spectator.poisoned'),
            },
            {
              visible: state.protected,
              icon: characterIconUrl('monk'),
              label: t('spectator.protected'),
            },
            { visible: state.abilityUsed, paper: '✓', label: t('spectator.abilityUsed') },
            {
              visible: state.master !== null,
              icon: characterIconUrl('butler'),
              label: t('spectator.master', { seat: state.master }),
            },
            {
              visible: props.grimoire.redHerring === index + 1,
              icon: characterIconUrl('fortuneteller'),
              label: t('spectator.redHerring'),
            },
            {
              visible: !!state.registeredRole,
              icon: state.registeredRole ? characterIconUrl(state.registeredRole) : undefined,
              label: state.registeredRole
                ? t('spectator.registeredRole', {
                    role: ROLES[state.registeredRole].name[language.value],
                  })
                : '',
            },
            {
              visible: !!state.registeredAlignment,
              paper: state.registeredAlignment ? t(`spectator.${state.registeredAlignment}`) : '',
              label: state.registeredAlignment
                ? t('spectator.registeredAlignment', {
                    alignment: t(`spectator.${state.registeredAlignment}`),
                  })
                : '',
            },
          ].filter((reminder) => reminder.visible)
        : [],
    }
  }),
)
function position(index: number, inner = false) {
  const angle =
    (index / props.config.seatCount) * Math.PI * 2 - Math.PI / 2 + (inner ? Math.PI / 4 : 0)
  const x = Math.cos(angle)
  const y = Math.sin(angle)
  return {
    left: `${String(50 + (inner ? 23 : 42) * x)}%`,
    top: `${String(44 + (inner ? 19 : 32) * (y / Math.max(Math.abs(x), Math.abs(y))))}%`,
  }
}
</script>

<template>
  <section class="grimoire-well" :aria-label="t('spectator.grimoire')">
    <header class="flex items-center justify-between text-xs text-muted">
      <h2 class="font-serif text-sm">{{ t('spectator.grimoire') }}</h2>
      <span>{{ t('spectator.atSeq', { seq: grimoire.seq }) }}</span>
    </header>
    <div class="grimoire-ring" :style="{ minHeight: config.seatCount > 10 ? '750px' : '550px' }">
      <div class="grimoire-center">
        <h3 class="font-serif text-2xl font-semibold">{{ title }}</h3>
        <p>{{ t('spectator.alive', { alive, total: config.seatCount }) }}</p>
        <p>{{ t('spectator.threshold', { count: Math.ceil(alive / 2) }) }}</p>
        <p v-if="publicState.aboutToBeExecuted !== null" class="text-xs text-accent">
          {{ t('spectator.executionSeat', { seat: publicState.aboutToBeExecuted }) }}
        </p>
        <p :id="hintId" class="mt-1 text-xs text-muted">{{ t('spectator.footprintHint') }}</p>
      </div>
      <ol>
        <li v-for="(seat, index) in seats" :key="seat.number" class="seat" :style="position(index)">
          <button
            type="button"
            class="seat-button"
            :class="{ 'seat-button--focused': focusedSeat === seat.number }"
            :aria-describedby="hintId"
            :aria-pressed="focusedSeat === seat.number"
            @click="$emit('focus', seat.number)"
          >
            <span class="seat-token round-token" :class="{ 'seat-token--dead': seat.dead }">
              <img
                v-if="seat.role"
                :src="characterIconUrl(seat.role, seat.state?.alignment)"
                alt=""
                :title="ROLES[seat.role].ability[language]"
              />
            </span>
            <span v-if="seat.dead" class="death-shroud" aria-hidden="true"></span>
            <span class="mt-2 block font-serif text-base">{{
              t('games.seat', { seat: seat.number })
            }}</span>
            <span class="block break-words text-xs text-muted">{{ seat.preset }}</span>
            <span class="block font-serif text-sm">{{
              seat.role ? ROLES[seat.role].name[language] : t('spectator.unknownRole')
            }}</span>
            <span v-if="seat.state?.believedRole" class="block text-xs text-ink2">{{
              t('spectator.believes', { role: ROLES[seat.state.believedRole].name[language] })
            }}</span>
            <span v-if="seat.dead" class="block text-xs text-ink2">
              {{ t('spectator.dead') }} ·
              {{
                t(
                  (seat.state?.voteUsed ?? seat.publicSeat?.voteUsed)
                    ? 'spectator.voteUsed'
                    : 'spectator.voteAvailable',
                )
              }}
            </span>
            <span
              v-if="publicState.aboutToBeExecuted === seat.number"
              class="block text-xs text-accent"
              >{{ t('spectator.execution') }}</span
            >
          </button>
        </li>
      </ol>
      <div
        v-for="(seat, index) in seats"
        :key="`reminders-${seat.number}`"
        class="reminders"
        :style="position(index, true)"
      >
        <span v-for="reminder in seat.reminders" :key="reminder.label" class="reminder">
          <img v-if="reminder.icon" class="round-token" :src="reminder.icon" alt="" />
          <span v-else class="reminder-paper round-token">{{ reminder.paper }}</span>
          <span>{{ reminder.label }}</span>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grimoire-well {
  overflow: auto;
  min-height: 0;
  padding: 16px 24px;
  background: var(--paper2);
  border-radius: var(--radius-well);
}
.grimoire-ring {
  position: relative;
  height: calc(100% - 28px);
  margin-top: 12px;
}
.grimoire-center {
  position: absolute;
  inset: 39% 32% auto;
  text-align: center;
  font-family: var(--font-family-serif);
  font-size: 14px;
  line-height: 1.8;
}
.seat {
  position: absolute;
  width: 140px;
  transform: translate(-50%, -42px);
}
.seat-button {
  position: relative;
  display: block;
  width: 100%;
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
}
.seat-button--focused {
  transform: translateY(-8px);
}
.seat-button--focused .seat-token {
  outline: 8px solid var(--paper3);
}
.seat-token {
  display: block;
  width: var(--size-seat-token);
  height: var(--size-seat-token);
  margin: auto;
  box-shadow: 0 3px 7px rgb(0 0 0 / 30%);
}
.seat-token img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.seat-token--dead {
  opacity: 0.35;
}
.death-shroud {
  position: absolute;
  top: -7px;
  left: calc(50% - 14px);
  width: 28px;
  height: 48px;
  background: var(--token-ink);
  border: 1px solid var(--token-rule);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
}
.reminders {
  position: absolute;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  width: 148px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.reminder {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 62px;
  gap: 3px;
  text-align: center;
  font-size: 11px;
  line-height: 1.3;
}
.reminder img,
.reminder-paper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-reminder-token);
  height: var(--size-reminder-token);
}
</style>
