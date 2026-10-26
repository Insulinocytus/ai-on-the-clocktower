<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ROLES } from '#shared/game/roles'
import { sample, setupCounts, validate } from '#shared/game/rules'
import type { RoleId } from '#shared/types/game'

const props = defineProps<{
  seatCount: number
  candidates: { type: 'setup' | 'seating'; sample: RoleId[]; roles?: RoleId[] }
}>()
const choice = defineModel<RoleId[]>()
const { t, locale } = useI18n()
const language = computed(() => (locale.value === 'zh' ? 'zh' : 'en'))
const selected = defineModel<string[]>('roles', { required: true })
const types = ['townsfolk', 'outsider', 'minion', 'demon'] as const
const available = computed(() =>
  Object.values(ROLES).filter(
    (role) => !props.candidates.roles || props.candidates.roles.includes(role.id),
  ),
)
const counts = computed(() => {
  const base = setupCounts(props.seatCount)
  const baron = selected.value.includes('baron') ? 2 : 0
  return {
    townsfolk: base.townsfolk - baron,
    outsider: base.outsiders + baron,
    minion: base.minions,
    demon: 1,
  }
})
const actualCounts = computed(() =>
  Object.fromEntries(
    types.map((type) => [
      type,
      selected.value.filter(
        (role) => Object.hasOwn(ROLES, role) && ROLES[role as RoleId].type === type,
      ).length,
    ]),
  ),
)
const complete = computed(() => selected.value.every((role) => role !== ''))
const errors = computed(() => {
  const assigned = selected.value.filter(Boolean)
  return validate(selected.value).filter((error) =>
    error.code === 'duplicate_role'
      ? new Set(assigned).size !== assigned.length
      : complete.value && error.code !== 'unsupported_role',
  )
})
if (selected.value.length !== props.seatCount)
  selected.value = Array.from({ length: props.seatCount }, () => '')
watch(
  selected,
  (roles) => {
    choice.value = complete.value && errors.value.length === 0 ? (roles as RoleId[]) : undefined
  },
  { deep: true, immediate: true },
)
function randomFill() {
  if (!props.candidates.roles) {
    selected.value = sample(Math.random, props.seatCount)
    return
  }
  const roles = [...props.candidates.roles]
  for (let index = roles.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    const a = roles[index]
    const b = roles[other]
    if (a && b) {
      roles[index] = b
      roles[other] = a
    }
  }
  selected.value = roles
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="font-semibold">{{ t('manual.setup') }}</h3>
      <Button type="button" variant="outline" size="sm" @click="randomFill">{{
        t('manual.randomFill')
      }}</Button>
    </div>
    <div class="flex flex-wrap gap-4 text-sm" aria-live="polite">
      <span v-for="type in types" :key="type">
        {{ t(`manual.${type}`) }}:
        {{ actualCounts[type] }}
        / {{ counts[type] }}
      </span>
    </div>
    <p v-if="selected.includes('baron')" class="text-sm text-ink2">{{ t('manual.baron') }}</p>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <div v-for="(_, index) in selected" :key="index" class="space-y-1.5">
        <Label :for="`setup-seat-${String(index + 1)}`">{{
          t('games.seat', { seat: index + 1 })
        }}</Label>
        <Select v-model="selected[index]">
          <SelectTrigger :id="`setup-seat-${String(index + 1)}`"
            ><SelectValue :placeholder="t('manual.selectRole')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="role in available" :key="role.id" :value="role.id">{{
              role.name[language]
            }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <div role="status" class="space-y-1 text-sm" aria-live="polite">
      <p v-if="!complete" class="text-muted-foreground">{{ t('manual.incomplete') }}</p>
      <p v-for="error in errors" :key="error.code" class="text-destructive">
        {{ t(`manual.errors.${error.code}`) }}
      </p>
      <p v-if="choice" class="text-ink2">{{ t('manual.validSetup') }}</p>
    </div>
  </section>
</template>
