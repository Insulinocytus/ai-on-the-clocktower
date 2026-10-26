<script setup lang="ts">
import { toast } from 'vue-sonner'
import Button from '@/components/grimoire/Button.vue'
import Dialog from '@/components/grimoire/Dialog.vue'
import Select from '@/components/grimoire/Select.vue'
import { ManualDiscretionConflictError, submitManualDiscretion } from '@/api'
import { ROLES } from '#shared/game/roles'
import { fold } from '#shared/game/rules'
import type { GameConfig, GameEvent, RoleId } from '#shared/types/game'

const props = defineProps<{
  gameId: string
  config: GameConfig
  request: Extract<GameEvent, { type: 'discretion.requested' }>
  events: GameEvent[]
  aborting: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submitted: []; abort: [] }>()
const { t, locale } = useI18n()
const language = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))
const grimoire = computed(() => fold(props.events.filter((event) => event.seq < props.request.seq)))
const selected = ref<string>()
const setupChoice = ref<RoleId[]>()
const setupRoles = ref<string[]>([])
const busy = ref(false)
const candidates = computed(() => props.request.candidates)
const choice = computed(() =>
  Array.isArray(candidates.value)
    ? selected.value === undefined
      ? undefined
      : candidates.value[Number(selected.value)]
    : setupChoice.value,
)
watch(
  () => props.request.seq,
  () => {
    selected.value = undefined
    setupChoice.value = undefined
    setupRoles.value = []
  },
  { immediate: true },
)
function describe(value: unknown): string {
  if (typeof value === 'string')
    return Object.hasOwn(ROLES, value)
      ? ROLES[value as RoleId].name[language.value]
      : value === 'good' || value === 'evil'
        ? t(`spectator.${value}`)
        : value
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no')
  if (Array.isArray(value)) return value.map((entry: unknown) => describe(entry)).join(', ')
  if (value !== null && typeof value === 'object')
    return Object.entries(value)
      .map(([key, entry]: [string, unknown]) => `${t(`manual.fields.${key}`)}: ${describe(entry)}`)
      .join('; ')
  return String(value)
}
async function submit() {
  if (choice.value === undefined || busy.value) return
  busy.value = true
  try {
    await submitManualDiscretion(props.gameId, props.request.seq, choice.value)
    emit('submitted')
  } catch (cause) {
    if (cause instanceof ManualDiscretionConflictError) {
      const accepted = cause.data.choice
      toast.info(
        t('manual.conflict', {
          choice: accepted === undefined ? t('manual.expired') : describe(accepted),
        }),
      )
      emit('submitted')
    } else toast.error(apiErrorMessage(cause))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="t('manual.title', { discretion: request.discretion })"
    :description="t('manual.help')"
    size="discretion"
    @interact-outside.prevent
  >
    <div class="space-y-5">
      <section class="space-y-2">
        <h3 class="font-serif font-medium">{{ t('manual.grimoire') }}</h3>
        <div class="max-h-52 overflow-auto rounded-thought border border-rule">
          <table class="manual-table w-full text-left text-sm">
            <thead class="sticky top-0 bg-paper3 text-muted">
              <tr>
                <th class="p-2">{{ t('manual.seat') }}</th>
                <th>{{ t('manual.role') }}</th>
                <th>{{ t('manual.alignment') }}</th>
                <th>{{ t('games.models') }}</th>
                <th>{{ t('games.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(preset, index) in config.seats"
                :key="index"
                class="border-t border-rule"
                :class="request.context?.seat === index + 1 ? 'bg-paper3' : ''"
              >
                <td class="p-2">{{ index + 1 }}</td>
                <template v-for="state in [grimoire.seats[index]]" :key="state?.seat ?? 0">
                  <td>
                    <span class="flex items-center gap-2">
                      <img
                        v-if="state"
                        class="manual-role-token round-token"
                        :src="characterIconUrl(state.role, state.alignment)"
                        alt=""
                      />
                      {{ state ? ROLES[state.role].name[language] : '—' }}
                    </span>
                    <span v-if="state?.believedRole" class="block text-xs text-ink2">{{
                      t('spectator.believes', { role: ROLES[state.believedRole].name[language] })
                    }}</span>
                  </td>
                  <td>{{ state ? t(`spectator.${state.alignment}`) : '—' }}</td>
                  <td>{{ preset.name }}</td>
                  <td class="space-x-1 py-2 text-xs">
                    <span v-if="state && !state.alive">{{ t('spectator.dead') }}</span>
                    <span v-if="state?.poisoned">{{ t('spectator.poisoned') }}</span>
                    <span v-if="state?.protected">{{ t('spectator.protected') }}</span>
                    <span v-if="state?.abilityUsed">{{ t('spectator.abilityUsed') }}</span>
                    <span v-if="state?.voteUsed">{{ t('spectator.voteUsed') }}</span>
                    <span v-if="state?.master">{{
                      t('spectator.master', { seat: state.master })
                    }}</span>
                    <span v-if="grimoire.redHerring === index + 1">{{
                      t('spectator.redHerring')
                    }}</span>
                    <span v-if="state?.registeredRole">{{
                      t('spectator.registeredRole', {
                        role: ROLES[state.registeredRole].name[language],
                      })
                    }}</span>
                    <span v-if="state?.registeredAlignment">{{
                      t('spectator.registeredAlignment', {
                        alignment: t(`spectator.${state.registeredAlignment}`),
                      })
                    }}</span>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="space-y-2 rounded-thought bg-paper3 p-4 text-sm leading-6 text-ink2">
        <h3 class="font-serif font-semibold text-ink">{{ t('manual.truth') }}</h3>
        <p v-if="request.context?.seat">
          {{ t('games.seat', { seat: request.context.seat })
          }}<span v-if="request.context.role">
            — {{ ROLES[request.context.role].name[language] }}</span
          >
        </p>
        <p>{{ request.context?.truth ? describe(request.context.truth) : t('manual.noTruth') }}</p>
        <h3 class="pt-1 font-serif font-semibold text-ink">{{ t('manual.advice') }}</h3>
        <p>{{ t(`manual.adviceById.${request.discretion}`) }}</p>
      </section>
      <SpectatorSetup
        v-if="!Array.isArray(candidates)"
        v-model="setupChoice"
        v-model:roles="setupRoles"
        :seat-count="config.seatCount"
        :candidates="candidates"
      />
      <section v-else class="space-y-2">
        <h3 class="font-serif font-medium">
          {{ t('manual.candidates', { count: candidates.length }) }}
        </h3>
        <Select
          id="manual-choice"
          v-model="selected"
          :aria-label="t('manual.choose')"
          :placeholder="t('manual.choose')"
          :options="
            candidates.map((candidate, index) => ({
              value: String(index),
              label: describe(candidate),
            }))
          "
        />
      </section>
    </div>
    <template #footer>
      <Button class="mr-auto" :disabled="aborting" @click="emit('abort')">{{
        t('games.abort')
      }}</Button>
      <Button variant="secondary" @click="open = false">{{ t('manual.collapse') }}</Button>
      <Button :disabled="busy || choice === undefined" @click="submit">{{
        t('manual.submit')
      }}</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.manual-table th,
.manual-table td {
  padding: 8px 12px;
}
.manual-table th {
  font-weight: 400;
}
.manual-role-token {
  width: 28px;
  height: 28px;
}
</style>
