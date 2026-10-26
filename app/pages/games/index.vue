<script setup lang="ts">
import Button from '@/components/grimoire/Button.vue'
import Badge from '@/components/grimoire/Badge.vue'
import { listGames } from '@/api'
import type { GameSummary } from '#shared/types/game-view'
import { GAME_REASON_LABELS } from '#shared/game/reasons'

const { t, locale } = useI18n()
const games = ref<GameSummary[]>([])
const error = ref<unknown>()
async function refresh() {
  try {
    games.value = await listGames()
    error.value = undefined
  } catch (cause) {
    error.value = cause
  }
}
await refresh()
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    void refresh()
  }, 3000)
})
onUnmounted(() => {
  clearInterval(timer)
})
</script>

<template>
  <section class="games-page">
    <header class="games-heading">
      <div>
        <h1>{{ t('games.title') }}</h1>
        <p v-if="games.length" class="games-subtitle">{{ t('games.listSubtitle') }}</p>
      </div>
      <Button v-if="games.length" as-child>
        <NuxtLink to="/games/new">{{ t('games.new') }}</NuxtLink>
      </Button>
    </header>
    <p v-if="error" role="alert" class="text-destructive">{{ apiErrorMessage(error) }}</p>
    <div v-if="!games.length" class="games-empty">
      <img src="/botc/editions/tb/logo.webp" :alt="t('games.script')" class="games-logo" />
      <div>
        <h2>{{ t('games.emptyTitle') }}</h2>
        <p class="games-empty-description">{{ t('games.emptyDescription') }}</p>
        <div class="games-empty-actions">
          <Button as-child>
            <NuxtLink to="/games/new">{{ t('games.new') }}</NuxtLink>
          </Button>
          <p>
            {{ t('games.emptyModelsHelp') }}
            <NuxtLink to="/models" class="games-models-link">{{
              t('games.emptyModelsLink')
            }}</NuxtLink>
          </p>
        </div>
      </div>
    </div>
    <table v-else class="games-table">
      <colgroup>
        <col class="games-column-id" />
        <col class="games-column-status" />
        <col class="games-column-models" />
        <col class="games-column-reason" />
        <col class="games-column-template" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{{ t('games.game') }}</th>
          <th scope="col">{{ t('games.status') }}</th>
          <th scope="col">{{ t('games.models') }}</th>
          <th scope="col">{{ t('games.reason') }}</th>
          <th scope="col">
            <span class="sr-only">{{ t('games.template') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="game in games"
          :key="game.id"
          :class="{ 'games-waiting': game.status === 'waiting' }"
        >
          <td>
            <NuxtLink :to="`/games/${game.id}`" class="games-id">{{
              game.id.slice(0, 8)
            }}</NuxtLink>
            <time :datetime="game.createdAt" class="games-created">
              <span class="sr-only">{{ t('games.createdAt') }}: </span>
              {{
                new Date(game.createdAt).toLocaleString(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              }}
            </time>
          </td>
          <td>
            <Badge v-if="!game.compatible" class="games-status">{{
              t('games.incompatible')
            }}</Badge>
            <Badge
              v-else-if="game.status === 'running' || game.status === 'waiting'"
              variant="accent"
              class="games-status"
            >
              {{ t(`games.${game.status}`) }}
            </Badge>
            <span v-else>{{ t(`games.${game.status}`) }}</span>
          </td>
          <td class="games-models">{{ game.config.seats.map((seat) => seat.name).join(' / ') }}</td>
          <td class="games-reason">
            {{ game.reason ? GAME_REASON_LABELS[game.reason][locale] : '—' }}
          </td>
          <td class="games-template">
            <NuxtLink
              v-if="game.compatible"
              :to="{ path: '/games/new', query: { template: game.id } }"
            >
              {{ t('games.template') }}
            </NuxtLink>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.games-page {
  width: var(--layout-content-width);
  margin-inline: calc((100% - var(--layout-content-width)) / 2);
  padding-top: var(--space-8);
  color: var(--ink2);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-ui);
}

.games-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.games-heading h1 {
  color: var(--ink);
  font-size: var(--font-size-page);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}

.games-heading > a {
  margin-top: var(--space-3);
  min-width: 112px;
}

.games-subtitle {
  margin-top: var(--space-2);
  font-size: var(--font-size-speech);
}

.games-table {
  width: 100%;
  margin-top: var(--space-10);
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.games-column-id {
  width: 21.43%;
}
.games-column-status {
  width: 14.29%;
}
.games-column-models {
  width: 35.71%;
}
.games-column-reason {
  width: 17.86%;
}
.games-column-template {
  width: 10.71%;
}

.games-table th {
  height: var(--space-8);
  color: var(--muted);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-regular);
  text-align: left;
}

.games-table th,
.games-table td {
  border-bottom: 1px solid var(--rule);
}

.games-table td {
  height: 80px;
  padding-block: var(--space-3);
  padding-right: var(--space-4);
  vertical-align: middle;
  overflow-wrap: anywhere;
}

.games-id {
  color: var(--ink);
  font-family: var(--font-family-serif);
  font-size: var(--font-size-wordmark);
  font-weight: var(--font-weight-semibold);
}

.games-id:hover,
.games-template a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.games-created {
  display: block;
  margin-top: var(--space-1);
  color: var(--muted);
  font-family: var(--font-family-serif);
  font-size: var(--font-size-small);
}

.games-status {
  max-width: 100%;
  height: auto;
  min-height: var(--size-badge);
  white-space: normal;
}

.games-reason {
  color: var(--muted);
}

.games-table .games-template {
  padding-right: 0;
  text-align: right;
  font-size: var(--font-size-small);
}

.games-waiting td {
  background: var(--paper2);
}

.games-waiting td:first-child,
.games-waiting td:last-child {
  position: relative;
}

.games-waiting td:first-child::before,
.games-waiting td:last-child::after {
  position: absolute;
  top: 0;
  bottom: -1px;
  width: var(--space-3);
  background: var(--paper2);
  content: '';
}

.games-waiting td:first-child::before {
  right: 100%;
  border-radius: var(--radius-well) 0 0 var(--radius-well);
}

.games-waiting td:last-child::after {
  left: 100%;
  border-radius: 0 var(--radius-well) var(--radius-well) 0;
}

.games-empty {
  display: flex;
  align-items: center;
  gap: 60px;
  min-height: 420px;
  margin-top: 75px;
  padding: 60px;
  border-radius: var(--radius-well);
  background: var(--paper2);
}

.games-logo {
  width: 300px;
  height: 300px;
  object-fit: contain;
}

.games-empty h2 {
  color: var(--ink);
  font-size: var(--font-size-dialog);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-heading);
}

.games-empty-description {
  margin-top: var(--space-3);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.games-empty-actions {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-top: var(--space-8);
}

.games-empty-actions > a {
  min-width: 112px;
}
.games-empty-actions p {
  color: var(--muted);
  font-size: var(--font-size-small);
}
.games-models-link {
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>
