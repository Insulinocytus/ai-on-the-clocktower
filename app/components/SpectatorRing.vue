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
// Above this many seats, tokens shrink and preset names and reminder labels collapse to tooltips.
const compact = computed(() => props.config.seatCount > 7)
const stage = useTemplateRef<HTMLElement>('stage')
const available = ref<number>()
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) available.value = Math.min(entry.contentRect.width, entry.contentRect.height)
  })
  if (stage.value) observer.observe(stage.value)
})
onBeforeUnmount(() => observer?.disconnect())
const ringStyle = computed(() => {
  const [pitch, reach] = compact.value ? [130, 80] : [220, 112]
  const radius = Math.max(200, pitch / (2 * Math.sin(Math.PI / props.config.seatCount)))
  const needed = Math.ceil(2 * (radius + reach))
  // Too small to space the seats apart: lay out at the needed size and zoom the whole ring down.
  const fit =
    available.value !== undefined && available.value < needed
      ? { width: `${String(needed)}px`, zoom: available.value / needed }
      : {}
  return { '--ring-reach': `${String(reach)}px`, ...fit }
})
function position(index: number) {
  const angle = (index / props.config.seatCount) * Math.PI * 2
  return {
    left: `calc(50% + ${String(Math.sin(angle))} * var(--ring-radius))`,
    top: `calc(50% - ${String(Math.cos(angle))} * var(--ring-radius))`,
  }
}
function reminderPosition(index: number, count: number) {
  // Token radius + reminder radius + a 6px gap that leaves room for the focused ring.
  const [radius, spacing] = compact.value ? [45, 26] : [68, 64]
  const angle = -Math.PI / 2 + (index - (count - 1) / 2) * (spacing / radius)
  return {
    left: `calc(50% + ${String(radius * Math.cos(angle))}px)`,
    top: `calc(var(--size-seat-token) / 2 + ${String(radius * Math.sin(angle))}px)`,
  }
}
</script>

<template>
  <section class="grimoire-well" :aria-label="t('spectator.grimoire')">
    <header class="flex items-center justify-between text-xs text-muted">
      <h2 class="font-serif text-sm">{{ t('spectator.grimoire') }}</h2>
      <span>{{ t('spectator.atSeq', { seq: grimoire.seq }) }}</span>
    </header>
    <div ref="stage" class="grimoire-stage">
      <div class="grimoire-ring" :class="{ 'grimoire-ring--compact': compact }" :style="ringStyle">
        <div class="grimoire-center">
          <h3 class="font-serif text-2xl">{{ title }}</h3>
          <p>{{ t('spectator.alive', { alive, total: config.seatCount }) }}</p>
          <p>{{ t('spectator.threshold', { count: Math.ceil(alive / 2) }) }}</p>
          <p v-if="publicState.aboutToBeExecuted !== null" class="text-xs text-accent">
            {{ t('spectator.executionSeat', { seat: publicState.aboutToBeExecuted }) }}
          </p>
          <p :id="hintId" class="mt-1 text-xs text-muted">{{ t('spectator.footprintHint') }}</p>
        </div>
        <ol>
          <li
            v-for="(seat, index) in seats"
            :key="seat.number"
            class="seat"
            :style="position(index)"
          >
            <button
              type="button"
              class="seat-button"
              :class="{ 'seat-button--focused': focusedSeat === seat.number }"
              :title="compact ? seat.preset : undefined"
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
              <span class="mt-2 block font-serif" :class="compact ? 'text-sm' : 'text-base'">{{
                t('games.seat', { seat: seat.number })
              }}</span>
              <span class="block break-words text-xs text-muted" :class="{ 'sr-only': compact }">{{
                seat.preset
              }}</span>
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
            <span
              v-for="(reminder, reminderIndex) in seat.reminders"
              :key="reminder.label"
              class="reminder"
              :title="compact ? reminder.label : undefined"
              :style="reminderPosition(reminderIndex, seat.reminders.length)"
            >
              <img v-if="reminder.icon" class="round-token" :src="reminder.icon" alt="" />
              <span v-else class="reminder-paper round-token">{{ reminder.paper }}</span>
              <span :class="{ 'sr-only': compact }">{{ reminder.label }}</span>
            </span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grimoire-well {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  min-height: 0;
  padding: 16px 24px;
  background: var(--paper2);
  border-radius: var(--radius-well);
}
.grimoire-stage {
  display: grid;
  place-items: center;
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  container-type: size;
}
.grimoire-ring {
  --ring-radius: calc(50cqw - var(--ring-reach));
  --seat-width: 140px;
  position: relative;
  width: min(100cqw, 100cqh);
  container-type: inline-size;
  aspect-ratio: 1;
}
.grimoire-ring--compact {
  --seat-width: 104px;
  --size-seat-token: 56px;
  --size-reminder-token: 22px;
}
.grimoire-center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 36%;
  transform: translate(-50%, -50%);
  text-align: center;
  font-family: var(--font-family-serif);
  font-size: 14px;
  line-height: 1.8;
}
.seat {
  position: absolute;
  width: var(--seat-width);
  transform: translate(-50%, calc(var(--size-seat-token) / -2));
}
.seat-button {
  position: relative;
  display: block;
  width: 100%;
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
}
.seat-button--focused .seat-token {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
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
  left: calc(50% - var(--size-seat-token) / 6);
  width: calc(var(--size-seat-token) / 3);
  height: calc(var(--size-seat-token) * 4 / 7);
  background: var(--token-ink);
  border: 1px solid var(--token-rule);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
}
.grimoire-ring--compact .reminder {
  pointer-events: auto;
}
.reminder {
  position: absolute;
  transform: translate(-50%, calc(-100% + var(--size-reminder-token) / 2));
  pointer-events: none;
  display: flex;
  flex-direction: column-reverse;
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
