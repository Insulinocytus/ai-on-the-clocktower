<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Observer } from '#shared/types/game'

defineProps<{ seatCount: number }>()
const observer = defineModel<Observer>('observer', { required: true })
const reasoning = defineModel<boolean>('reasoning', { required: true })
const losing = defineModel<boolean>('losing', { required: true })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-6 border-b bg-slate-50/50 px-5 py-2.5">
    <div class="flex items-center gap-2">
      <Label for="spectator-observer">{{ t('spectator.perspective') }}</Label>
      <Select v-model="observer">
        <SelectTrigger id="spectator-observer" class="w-44 bg-white">
          <SelectValue>
            {{
              observer.startsWith('seat:')
                ? t('spectator.seatView', { seat: observer.slice(5) })
                : t(
                    `spectator.${observer === 'spectator' ? 'omniscient' : observer === 'public' ? 'publicOnly' : 'storyteller'}`,
                  )
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="spectator">{{ t('spectator.omniscient') }}</SelectItem>
          <SelectItem value="storyteller">{{ t('spectator.storyteller') }}</SelectItem>
          <SelectItem v-for="seat in seatCount" :key="seat" :value="`seat:${String(seat)}`">
            {{ t('spectator.seatView', { seat }) }}
          </SelectItem>
          <SelectItem value="public">{{ t('spectator.publicOnly') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div class="flex items-center gap-2">
      <Checkbox id="spectator-reasoning" v-model="reasoning" />
      <Label for="spectator-reasoning">{{ t('spectator.reasoning') }}</Label>
    </div>
    <div class="flex items-center gap-2">
      <Checkbox id="spectator-losing" v-model="losing" />
      <Label for="spectator-losing">{{ t('spectator.losing') }}</Label>
    </div>
  </div>
</template>
