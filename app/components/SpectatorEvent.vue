<script setup lang="ts">
import { renderEvent } from '#shared/event-templates'
import type { SpectatorRow } from '#shared/game/spectator'
import type { Observer } from '#shared/types/game'

defineProps<{ row: SpectatorRow; observer: Observer }>()
const { t, locale } = useI18n()
</script>

<template>
  <li class="grid grid-cols-[2.5rem_1fr] gap-3 py-4" :class="row.losing ? 'opacity-55' : ''">
    <span class="pt-1 text-xs tabular-nums text-muted-foreground">{{ row.event.seq }}</span>
    <div class="min-w-0">
      <p v-if="row.losing" class="mb-1 text-xs font-medium text-muted-foreground">
        {{ t('spectator.notSelected') }}
      </p>
      <template
        v-if="row.event.type === 'contestant.decision' || row.event.type === 'storyteller.decision'"
      >
        <p class="text-xs font-medium text-muted-foreground">
          {{
            row.event.type === 'contestant.decision'
              ? t('spectator.seatSummary', { seat: row.event.seat })
              : t('spectator.storytellerSummary')
          }}
        </p>
        <p
          v-if="row.reasoningSummary"
          class="mt-1 whitespace-pre-wrap break-words text-sm leading-6"
        >
          {{ row.reasoningSummary }}
        </p>
        <p
          v-if="row.speech !== undefined"
          class="mt-1 whitespace-pre-wrap break-words text-sm leading-7"
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
        <p class="mt-1 text-xs text-muted-foreground">
          {{ row.event.model }} · {{ Math.round(row.event.durationMs) }} ms ·
          {{ t('spectator.attempt', { attempt: row.event.attempt }) }}
        </p>
        <details class="mt-1">
          <summary class="cursor-pointer text-xs text-muted-foreground">
            {{ t('trial.raw') }}
          </summary>
          <pre class="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{{
            JSON.stringify(row.event.raw, null, 2)
          }}</pre>
        </details>
      </template>
      <template v-else>
        <p
          class="whitespace-pre-wrap break-words text-sm leading-7"
          :class="
            row.event.type === 'public.speech' || row.event.type === 'whisper.speech'
              ? 'rounded-lg bg-paper2 px-3 py-2 text-ink'
              : 'text-muted-foreground'
          "
        >
          {{ renderEvent(row.event, locale === 'zh' ? 'zh' : 'en', observer) }}
        </p>
        <span
          v-if="observer === 'spectator' && row.falseInfo"
          class="mt-2 inline-block rounded border border-accent bg-accent px-2 py-0.5 text-xs text-accent-ink"
          :title="row.falseReason ? t(`spectator.falseReasons.${row.falseReason}`) : undefined"
          >{{ t('spectator.falseInfo') }}</span
        >
      </template>
    </div>
  </li>
</template>
