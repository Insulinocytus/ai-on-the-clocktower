<script setup lang="ts">
import { z } from 'zod'
import type { GameEvent } from '#shared/types/game'
import { renderEvent } from '#shared/event-templates'

const props = defineProps<{
  events: GameEvent[]
  title: string
  blockKey: string | undefined
  following: boolean
}>()
const { t, locale } = useI18n()
const feed = useTemplateRef<HTMLOListElement>('feed')
const completion = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        tool_calls: z.array(z.object({ function: z.object({ arguments: z.string() }) })).optional(),
      }),
    }),
  ),
})
const reasoningShape = z.object({ reasoning: z.string() })
function reasoning(entry: GameEvent): string {
  if (entry.type !== 'contestant.decision' && entry.type !== 'storyteller.decision') return ''
  const parsed = completion.safeParse(entry.raw)
  const args = parsed.success
    ? parsed.data.choices[0]?.message.tool_calls?.[0]?.function.arguments
    : undefined
  if (!args) return ''
  try {
    const result = reasoningShape.safeParse(JSON.parse(args) as unknown)
    return result.success ? result.data.reasoning : ''
  } catch {
    return ''
  }
}
watch(
  [() => props.blockKey, () => props.events.length, () => props.following],
  async ([key], [previous]) => {
    await nextTick()
    if (!feed.value) return
    if (props.following) feed.value.scrollTop = feed.value.scrollHeight
    else if (key !== previous) feed.value.scrollTop = 0
  },
  { flush: 'post' },
)
</script>

<template>
  <section class="flex min-h-0 flex-col border-l" :aria-label="t('spectator.content')">
    <h2 class="border-b px-5 py-3 text-sm font-medium">{{ title }}</h2>
    <ol ref="feed" class="min-h-0 flex-1 divide-y overflow-y-auto px-5" aria-live="polite">
      <li v-for="entry in events" :key="entry.seq" class="grid grid-cols-[2.5rem_1fr] gap-3 py-4">
        <span class="pt-1 text-xs tabular-nums text-muted-foreground">{{ entry.seq }}</span>
        <div class="min-w-0">
          <p
            class="whitespace-pre-wrap break-words text-sm leading-7"
            :class="
              entry.type === 'public.speech' || entry.type === 'whisper.speech'
                ? 'rounded-lg bg-slate-50 px-3 py-2 text-slate-900'
                : 'text-muted-foreground'
            "
          >
            {{ renderEvent(entry, locale === 'zh' ? 'zh' : 'en', 'spectator') }}
          </p>
          <details
            v-if="entry.type === 'contestant.decision' || entry.type === 'storyteller.decision'"
            class="mt-2 text-sm"
          >
            <summary class="cursor-pointer text-muted-foreground">
              {{ t('games.reasoning') }}
            </summary>
            <p class="mt-2 whitespace-pre-wrap break-words leading-6">
              {{ reasoning(entry) || t('games.noReasoning') }}
            </p>
            <pre class="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{{
              JSON.stringify(entry.raw, null, 2)
            }}</pre>
          </details>
        </div>
      </li>
    </ol>
  </section>
</template>
