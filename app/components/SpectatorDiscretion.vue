<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"
      :show-close-button="false"
      @interact-outside.prevent
    >
      <DialogHeader>
        <DialogTitle>{{ t('manual.title', { discretion: request.discretion }) }}</DialogTitle>
        <DialogDescription>{{ t('manual.help') }}</DialogDescription>
      </DialogHeader>
      <section class="space-y-2">
        <h3 class="font-semibold">{{ t('manual.grimoire') }}</h3>
        <div class="max-h-52 overflow-auto rounded-md border">
          <table class="w-full text-left text-sm">
            <thead class="bg-muted">
              <tr>
                <th class="p-2">{{ t('manual.seat') }}</th>
                <th>{{ t('manual.role') }}</th>
                <th>{{ t('manual.alignment') }}</th>
                <th>{{ t('games.models') }}</th>
                <th>{{ t('games.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(preset, index) in config.seats" :key="index" class="border-t">
                <td class="p-2">{{ index + 1 }}</td>
                <template v-for="state in [grimoire.seats[index]]" :key="state?.seat ?? 0">
                  <td>
                    {{ state ? ROLES[state.role].name[language] : '—'
                    }}<span v-if="state?.believedRole" class="block text-xs text-ink2">{{
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
      <section class="space-y-2 rounded-md bg-paper2 p-3 text-sm">
        <h3 class="font-semibold">{{ t('manual.truth') }}</h3>
        <p v-if="request.context?.seat">
          {{ t('games.seat', { seat: request.context.seat })
          }}<span v-if="request.context.role">
            — {{ ROLES[request.context.role].name[language] }}</span
          >
        </p>
        <p>{{ request.context?.truth ? describe(request.context.truth) : t('manual.noTruth') }}</p>
        <h3 class="pt-2 font-semibold">{{ t('manual.advice') }}</h3>
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
        <h3 class="font-semibold">{{ t('manual.candidates', { count: candidates.length }) }}</h3>
        <Select v-model="selected">
          <SelectTrigger id="manual-choice" :aria-label="t('manual.choose')"
            ><SelectValue :placeholder="t('manual.choose')"
          /></SelectTrigger>
          <SelectContent class="max-h-72">
            <SelectItem
              v-for="(candidate, index) in candidates"
              :key="index"
              :value="String(index)"
              >{{ describe(candidate) }}</SelectItem
            >
          </SelectContent>
        </Select>
      </section>
      <DialogFooter class="mt-2 sm:justify-between">
        <Button variant="destructive" :disabled="aborting" @click="emit('abort')">{{
          t('games.abort')
        }}</Button>
        <div class="flex gap-2">
          <Button variant="outline" @click="open = false">{{ t('manual.collapse') }}</Button>
          <Button :disabled="busy || choice === undefined" @click="submit">{{
            t('manual.submit')
          }}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
