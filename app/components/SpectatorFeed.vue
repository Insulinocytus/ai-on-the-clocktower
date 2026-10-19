<script setup lang="ts">
import { Button } from '@/components/ui/button'
import type { SpectatorRow } from '#shared/game/spectator'
import type { Observer } from '#shared/types/game'

const props = defineProps<{
  groups: { key: string; title: string; rows: SpectatorRow[]; muted: boolean }[]
  title: string
  blockKey: string | undefined
  following: boolean
  observer: Observer
  reasoning: boolean
  focused: boolean
}>()
defineEmits<{ clearFocus: [] }>()
const { t } = useI18n()
const feed = useTemplateRef<HTMLElement>('feed')
watch(
  [() => props.blockKey, () => props.groups, () => props.following, () => props.focused],
  async ([key, , , focused], [previous, , , wasFocused]) => {
    await nextTick()
    if (!feed.value) return
    if (props.following) feed.value.scrollTop = feed.value.scrollHeight
    else if (key !== previous || focused !== wasFocused) feed.value.scrollTop = 0
  },
  { flush: 'post' },
)
</script>

<template>
  <section class="flex min-h-0 flex-col border-l" :aria-label="t('spectator.content')">
    <header class="flex items-center justify-between gap-2 border-b px-5 py-3">
      <h2 class="text-sm font-medium">{{ title }}</h2>
      <Button v-if="focused" variant="outline" size="sm" @click="$emit('clearFocus')">
        {{ t('spectator.backToChannel') }}
      </Button>
    </header>
    <div ref="feed" class="min-h-0 flex-1 overflow-y-auto px-5" aria-live="polite">
      <section v-for="group in groups" :key="group.key" :class="group.muted ? 'opacity-55' : ''">
        <h3 v-if="focused" class="sticky top-0 border-b bg-white py-3 text-sm font-medium">
          {{ group.title }}
        </h3>
        <ol class="divide-y">
          <SpectatorEvent
            v-for="row in group.rows"
            :key="`${observer}:${String(row.event.seq)}`"
            :row="row"
            :observer="observer"
            :reasoning="reasoning"
          />
        </ol>
      </section>
      <p
        v-if="!groups.some((group) => group.rows.length)"
        class="py-5 text-sm text-muted-foreground"
      >
        {{ t('spectator.noEvents') }}
      </p>
    </div>
  </section>
</template>
