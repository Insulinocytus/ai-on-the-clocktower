<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import type { SpectatorRow } from '#shared/game/spectator'
import type { Observer } from '#shared/types/game'

const props = defineProps<{
  groups: { key: string; title: string; rows: SpectatorRow[] }[]
  title: string
  blockKey: string | undefined
  following: boolean
  observer: Observer
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
  <section class="flex min-h-0 flex-col" :aria-label="t('spectator.content')">
    <header class="flex min-h-11 items-center justify-between gap-2 border-b border-rule pb-2">
      <h2 class="font-serif text-2xl">{{ title }}</h2>
      <Button v-if="focused" variant="secondary" @click="$emit('clearFocus')">
        {{ t('spectator.backToChannel') }}
      </Button>
    </header>
    <div ref="feed" class="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
      <section v-for="group in groups" :key="group.key">
        <h3 v-if="focused" class="sticky top-0 border-b bg-paper py-3 text-sm">
          {{ group.title }}
        </h3>
        <ol class="divide-y divide-rule">
          <SpectatorEvent
            v-for="row in group.rows"
            :key="`${observer}:${String(row.event.seq)}`"
            :row="row"
            :observer="observer"
          />
        </ol>
      </section>
      <p v-if="!groups.some((group) => group.rows.length)" class="py-5 text-sm text-muted">
        {{ t('spectator.noEvents') }}
      </p>
    </div>
  </section>
</template>
