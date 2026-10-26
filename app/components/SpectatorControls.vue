<script setup lang="ts">
import Checkbox from '@/components/grimoire/Checkbox.vue'
import Select from '@/components/grimoire/Select.vue'
import type { Observer } from '#shared/types/game'

const props = defineProps<{ seatCount: number }>()
const observer = defineModel<Observer>('observer', { required: true })
const losing = defineModel<boolean>('losing', { required: true })
const { t } = useI18n()
const perspectives = computed<{ value: Observer; label: string }[]>(() => [
  { value: 'spectator', label: t('spectator.omniscient') },
  { value: 'storyteller', label: t('spectator.storyteller') },
  ...Array.from({ length: props.seatCount }, (_, index) => ({
    value: `seat:${String(index + 1)}` as Observer,
    label: t('spectator.seatView', { seat: index + 1 }),
  })),
  { value: 'public', label: t('spectator.publicOnly') },
])
</script>

<template>
  <div class="spectator-controls flex shrink-0 items-center">
    <div class="flex items-center gap-3">
      <label for="spectator-observer" class="text-ink2">{{ t('spectator.perspective') }}</label>
      <Select
        id="spectator-observer"
        v-model="observer"
        :options="perspectives"
        content-class="spectator-perspective-menu"
        compact
      />
    </div>
    <div class="flex items-center gap-3">
      <Checkbox id="spectator-losing" v-model="losing" />
      <label for="spectator-losing">{{ t('spectator.losing') }}</label>
    </div>
  </div>
</template>

<style scoped>
.spectator-controls {
  gap: var(--space-6);
  font-size: var(--font-size-ui);
}
</style>

<style>
.spectator-perspective-menu {
  width: 240px;
}
</style>
