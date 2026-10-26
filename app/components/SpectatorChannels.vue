<script setup lang="ts">
import type { ChannelBlock } from '#shared/game/channels'

const { t } = useI18n()
const props = defineProps<{
  blocks: (ChannelBlock & { title: string })[]
  selected: string | undefined
}>()
defineEmits<{ select: [key: string] }>()
const navigation = useTemplateRef<HTMLElement>('navigation')
watch(
  () => props.selected,
  async () => {
    await nextTick()
    navigation.value?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' })
  },
  { flush: 'post' },
)
</script>

<template>
  <nav
    ref="navigation"
    class="min-h-0 overflow-y-auto border-r bg-paper2"
    :aria-label="t('spectator.channels')"
  >
    <h2 class="sticky top-0 border-b bg-paper2 px-4 py-3 text-sm font-medium">
      {{ t('spectator.channels') }}
    </h2>
    <ol class="grid gap-1 p-2">
      <li v-for="block in blocks" :key="block.key">
        <button
          type="button"
          class="w-full rounded-md border border-transparent px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          :class="[
            selected === block.key ? 'border-accent bg-accent text-accent-ink' : 'hover:bg-paper3',
            block.kind === 'room' ? 'pl-6' : '',
          ]"
          :aria-current="selected === block.key ? 'step' : undefined"
          @click="$emit('select', block.key)"
        >
          <span class="block font-medium">{{ block.title }}</span>
          <span class="mt-1 block text-xs text-muted-foreground">
            {{ t('spectator.day', { day: block.day }) }}
            <span class="float-right tabular-nums">#{{ block.end }}</span>
          </span>
        </button>
      </li>
    </ol>
    <p v-if="!blocks.length" class="p-4 text-sm text-muted-foreground">
      {{ t('spectator.loading') }}
    </p>
  </nav>
</template>
