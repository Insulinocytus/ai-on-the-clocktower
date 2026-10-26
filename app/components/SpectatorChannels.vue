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
    navigation.value
      ?.querySelector('[aria-current]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
  { flush: 'post' },
)
</script>

<template>
  <nav
    class="spectator-channels flex items-center border-b border-rule"
    :aria-label="t('spectator.channels')"
  >
    <h2 class="shrink-0 text-sm text-ink2">{{ t('spectator.channels') }}</h2>
    <div ref="navigation" class="min-w-0 flex-1 overflow-x-auto py-2">
      <ol class="flex w-max gap-1">
        <li v-for="block in blocks" :key="block.key">
          <button
            type="button"
            class="channel-block text-left"
            :class="{ 'bg-accent text-accent-ink': selected === block.key }"
            :aria-current="selected === block.key ? 'step' : undefined"
            @click="$emit('select', block.key)"
          >
            <span class="block text-sm font-medium">{{ block.title }}</span>
            <span class="channel-meta mt-0.5 flex items-center gap-3 text-xs">
              {{ t('spectator.day', { day: block.day }) }}
              <span class="font-serif tabular-nums">#{{ block.end }}</span>
            </span>
          </button>
        </li>
      </ol>
      <p v-if="!blocks.length" class="px-3 text-sm text-muted">
        {{ t('spectator.loading') }}
      </p>
    </div>
  </nav>
</template>

<style scoped>
.spectator-channels {
  min-height: 70px;
  gap: var(--space-6);
  padding-inline: var(--space-10);
}

.channel-block {
  min-width: 98px;
  padding: 6px var(--space-3);
  border-radius: 16px;
  cursor: pointer;
}

.channel-meta {
  color: var(--muted);
}

[aria-current] .channel-meta {
  color: var(--accent-ink);
}
</style>
