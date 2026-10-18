<script setup lang="ts">
import type { DiscretionConflict } from '#shared/api'
import type { DiscretionValue, EventOf, GameEvent, Lang, RoleId } from '#shared/rules/types'
import { createRng, foldGrimoire, isCandidate, sampleSetup, setupCounts, validateSetup } from '#shared/rules'
import { ROLES } from '#shared/rules/roles'
import { DISCRETION_TEXT } from '#shared/rules/discretions'
import { roleName } from '#shared/templates'
import { valueLabel } from '~/lib/spectator'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { toast } from 'vue-sonner'
const props = defineProps<{ gameId: string; pending: EventOf<'discretion.requested'>; events: GameEvent[]; seatCount: number }>()
const open = defineModel<boolean>('open', { default: true })
const emit = defineEmits<{ submitted: [seq: number]; abort: [] }>()
const { t, locale } = useI18n()
const lang = computed(() => locale.value as Lang)
const roles = ref<RoleId[]>([])
const chosen = ref('')
const busy = ref(false)
const error = ref('')
const grimoire = computed(() => foldGrimoire(props.events, props.pending.seq))
const value = computed<DiscretionValue>(() => props.pending.candidates.kind === 'list' ? props.pending.candidates.values[Number(chosen.value)] ?? {} : { roles: roles.value })
const valid = computed(() => !setupError.value && (chosen.value !== '' || props.pending.candidates.kind !== 'list') && isCandidate(props.pending.candidates, value.value, props.seatCount))
const setupError = computed(() => props.pending.candidates.kind === 'setup' ? validateSetup(roles.value, props.seatCount) : null)
const counts = computed(() => setupCounts(props.seatCount, roles.value.includes('baron')))
const actualCounts = computed(() => Object.fromEntries(['townsfolk', 'outsider', 'minion', 'demon'].map(type => [type, roles.value.filter(id => ROLES.find(role => role.id === id)?.type === type).length])))
const suggestion = computed(() => DISCRETION_TEXT[props.pending.discretion][lang.value][2])
watch(() => props.pending.seq, () => {
  chosen.value = ''; error.value = ''
  roles.value = props.pending.candidates.kind === 'seating' ? [...props.pending.candidates.roles] : Array.from({ length: props.seatCount }, () => 'washerwoman' as RoleId)
}, { immediate: true })
function randomize() {
  const rng = createRng(crypto.randomUUID())
  roles.value = props.pending.candidates.kind === 'seating' ? rng.shuffle(props.pending.candidates.roles) : sampleSetup(props.seatCount, rng)
}
async function submit() {
  if (!valid.value || busy.value) return
  busy.value = true; error.value = ''
  const requestSeq = props.pending.seq
  try {
    await $fetch(`/api/games/${encodeURIComponent(props.gameId)}/discretions/${requestSeq}`, { method: 'POST', body: { value: value.value } })
    if (props.pending.seq === requestSeq) open.value = false
    emit('submitted', requestSeq)
  } catch (caught) {
    const failure = caught as { statusCode?: number; data?: DiscretionConflict & { message?: string } }
    if (failure.statusCode === 409 || failure.data?.error === 'conflict') {
      const resolved = failure.data?.value
      const ConflictNotice = markRaw(defineComponent({ setup: () => () => h('span', t('spectator.conflict', { value: resolved ? valueLabel(resolved, locale.value as Lang) : t('spectator.noValue') })) }))
      toast(ConflictNotice, { duration: 8000 })
      if (props.pending.seq === requestSeq) open.value = false
      emit('submitted', requestSeq)
    } else error.value = failure.data?.message ?? (caught instanceof Error ? caught.message : String(caught))
  } finally { busy.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[960px]">
      <DialogHeader><DialogTitle>{{ t('spectator.manualTitle', { id: pending.discretion }) }}</DialogTitle><DialogDescription>{{ t('spectator.manualDescription') }}</DialogDescription></DialogHeader>
      <div class="manual-body">
        <section>
          <h3>{{ t('spectator.grimoire') }}</h3>
          <table class="grimoire-table"><tbody>
            <tr v-for="n in seatCount" :key="n"><td>{{ t('spectator.seat', { n }) }}</td><td>{{ grimoire.seats[n - 1] ? roleName(grimoire.seats[n - 1]!.role, lang) : t('spectator.unknown') }}</td><td>
              <template v-if="grimoire.seats[n - 1]">
                <span v-if="!grimoire.seats[n - 1]!.alive">{{ t('spectator.dead') }} </span>
                <span v-if="grimoire.seats[n - 1]!.poisonedBy !== null">{{ t('spectator.poisoned') }} </span>
                <span v-if="grimoire.seats[n - 1]!.protectedBy !== null">{{ t('spectator.protected') }} </span>
                <span v-if="grimoire.seats[n - 1]!.abilityUsed">{{ t('spectator.used') }} </span>
                <span v-if="grimoire.seats[n - 1]!.voteTokenUsed">{{ t('spectator.ghostUsed') }} </span>
                <span v-if="grimoire.seats[n - 1]!.masterOf !== null">{{ t('spectator.master') }} {{ grimoire.seats[n - 1]!.masterOf }} </span>
                <span v-if="grimoire.redHerring === n">{{ t('spectator.redHerring') }}</span>
              </template>
            </td></tr>
          </tbody></table>
          <p v-if="grimoire.drunkBelieves" class="muted">{{ roleName('drunk', lang) }} · {{ t('spectator.believes', { role: roleName(grimoire.drunkBelieves, lang) }) }}</p>
          <p v-if="grimoire.spyRegisters" class="muted">{{ roleName('spy', lang) }} · {{ t('manual.registers') }} {{ t(`spectator.${grimoire.spyRegisters.alignment}`) }} / {{ roleName(grimoire.spyRegisters.role, lang) }}</p>
          <p v-if="grimoire.recluseRegisters" class="muted">{{ roleName('recluse', lang) }} · {{ t('manual.registers') }} {{ t(`spectator.${grimoire.recluseRegisters.alignment}`) }} / {{ roleName(grimoire.recluseRegisters.role, lang) }}</p>
          <p v-if="grimoire.bluffs.length" class="muted">{{ t('manual.bluffs') }}: {{ grimoire.bluffs.map(role => roleName(role, lang)).join(', ') }}</p>
          <p v-if="pending.context.subject" class="muted">{{ t('spectator.seat', { n: pending.context.subject }) }}<span v-if="pending.context.ability"> · {{ roleName(pending.context.ability, lang) }}</span></p>
          <template v-if="pending.context.truth"><h3>{{ t('spectator.truth') }}</h3><p>{{ valueLabel(pending.context.truth, lang) }}</p></template>
          <template v-if="suggestion"><h3>{{ t('spectator.advice') }}</h3><p>{{ suggestion }}</p></template>
        </section>
        <section>
          <h3>{{ t('spectator.candidates') }}</h3>
          <template v-if="pending.candidates.kind !== 'list'">
            <div class="setup-seats"><label v-for="(_, index) in roles" :key="index" class="setup-seat"><span>{{ index + 1 }}</span><select v-model="roles[index]" :aria-label="t('spectator.seat', { n: index + 1 })"><option v-for="role in ROLES" :key="role.id" :value="role.id" :disabled="pending.candidates.kind === 'seating' && !pending.candidates.roles.includes(role.id)">{{ role.name[lang] }}</option></select></label></div>
            <p class="muted">{{ t('spectator.counts', { townsfolk: `${actualCounts.townsfolk}/${counts[0]}`, outsider: `${actualCounts.outsider}/${counts[1]}`, minion: `${actualCounts.minion}/${counts[2]}`, demon: `${actualCounts.demon}/${counts[3]}` }) }}</p>
            <p :class="valid ? 'muted' : 'error'">{{ valid ? t('spectator.valid') : t('manual.validation') }}</p>
            <Button variant="outline" @click="randomize">{{ t('spectator.random') }}</Button>
          </template>
          <select v-else v-model="chosen" style="width:100%" :aria-label="t('spectator.candidates')"><option value="" disabled>{{ t('spectator.candidates') }} ({{ pending.candidates.values.length }})</option><option v-for="(candidate, index) in pending.candidates.values" :key="index" :value="String(index)">{{ valueLabel(candidate, lang) }}</option></select>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </section>
      </div>
      <DialogFooter><Button variant="destructive" @click="emit('abort')">{{ t('spectator.abort') }}</Button><Button variant="outline" @click="open = false">{{ t('spectator.minimize') }}</Button><Button :disabled="!valid || busy" @click="submit">{{ busy ? t('app.loading') : t('spectator.submit') }}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
