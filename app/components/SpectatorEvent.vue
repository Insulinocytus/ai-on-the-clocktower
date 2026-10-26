<script setup lang="ts">
import Badge from '@/components/grimoire/Badge.vue'
import { renderEvent } from '#shared/event-templates'
import type { SpectatorRow } from '#shared/game/spectator'
import type { Observer } from '#shared/types/game'

defineProps<{ row: SpectatorRow; observer: Observer }>()
const { t, locale } = useI18n()
</script>

<template>
  <li class="grid grid-cols-[2.25rem_1fr] gap-3 py-4" :class="row.losing ? 'opacity-50' : ''">
    <span class="pt-1 font-serif text-xs tabular-nums text-muted">{{ row.event.seq }}</span>
    <div class="min-w-0">
      <p v-if="row.losing" class="mb-1 text-xs text-muted">
        {{ t('spectator.notSelected') }}
      </p>
      <template
        v-if="row.event.type === 'contestant.decision' || row.event.type === 'storyteller.decision'"
      >
        <p class="text-xs text-muted">
          {{
            row.event.type === 'contestant.decision'
              ? t('spectator.seatSummary', { seat: row.event.seat })
              : t('spectator.storytellerSummary')
          }}
        </p>
        <p
          v-if="row.reasoningSummary"
          class="mt-1 whitespace-pre-wrap break-words font-serif text-sm leading-7 text-ink2"
        >
          {{ row.reasoningSummary }}
        </p>
        <p
          v-if="row.speech !== undefined"
          class="mt-1 whitespace-pre-wrap break-words font-serif text-sm leading-7 text-ink2"
        >
          {{ row.speech === null ? t('spectator.pass') : row.speech }}
        </p>
        <p v-if="row.nominee !== undefined" class="mt-1 text-sm">
          {{
            row.nominee === null
              ? t('spectator.pass')
              : t('spectator.proposedNomination', { seat: row.nominee })
          }}
        </p>
        <p class="mt-1 text-xs text-muted">
          {{ row.event.model }} · {{ Math.round(row.event.durationMs) }} ms ·
          {{ t('spectator.attempt', { attempt: row.event.attempt }) }}
        </p>
        <details class="mt-1">
          <summary class="cursor-pointer text-xs text-muted">
            {{ t('trial.raw') }}
          </summary>
          <pre
            class="mt-2 max-h-64 overflow-auto rounded-thought bg-paper3 p-3 text-xs text-ink2"
            >{{ JSON.stringify(row.event.raw, null, 2) }}</pre>
        </details>
      </template>
      <template v-else>
        <p
          class="whitespace-pre-wrap break-words text-sm leading-7"
          :class="
            row.event.type === 'public.speech' || row.event.type === 'whisper.speech'
              ? 'speech-bubble font-serif text-base text-ink'
              : 'text-muted'
          "
        >
          {{ renderEvent(row.event, locale === 'zh' ? 'zh' : 'en', observer) }}
        </p>
        <Badge
          v-if="observer === 'spectator' && row.falseInfo"
          variant="accent-outline"
          class="mt-2"
          :title="row.falseReason ? t(`spectator.falseReasons.${row.falseReason}`) : undefined"
          >{{ t('spectator.falseInfo') }}</Badge
        >
      </template>
    </div>
  </li>
</template>

<style scoped>
.speech-bubble {
  position: relative;
  border: 1px solid var(--rule);
  border-radius: var(--radius-thought);
  background: var(--paper2);
  padding: 12px 16px;
}
.speech-bubble::before {
  position: absolute;
  top: 15px;
  left: -5px;
  width: 8px;
  height: 8px;
  border-bottom: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
  background: var(--paper2);
  transform: rotate(45deg);
  content: '';
}
</style>
