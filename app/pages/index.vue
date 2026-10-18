<script setup lang="ts">
import type { GameSummary } from '#shared/api'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
const { t, locale } = useI18n()
const { data: games, error, status, refresh } = await useFetch<GameSummary[]>('/api/games', { default: () => [] })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { void refresh() }, 5000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <main class="page">
    <div class="page-heading">
      <div><h1>{{ t('games.title') }}</h1><p class="muted">{{ t('games.subtitle') }}</p></div>
      <Button as-child><NuxtLink to="/games/new">＋ {{ t('app.new') }}</NuxtLink></Button>
    </div>
    <div v-if="error" class="panel error" role="alert">{{ error.message }} <Button variant="outline" @click="refresh()">{{ t('app.retry') }}</Button></div>
    <p v-else-if="status === 'pending' && !games.length" class="muted">{{ t('app.loading') }}</p>
    <div v-else-if="!games.length" class="panel"><p>{{ t('games.empty') }}</p><Button as-child variant="outline"><NuxtLink to="/models">{{ t('app.models') }}</NuxtLink></Button></div>
    <section v-else class="panel" style="padding:0">
      <article v-for="game in games" :key="game.id" class="game-row">
        <div>
          <div class="game-row-head"><strong>{{ t('games.seats', { n: game.seatCount }) }}</strong><Badge variant="secondary" :class="`status-${game.status}`">{{ t(`games.status.${game.status}`) }}</Badge><span v-if="game.pending" class="muted">{{ game.pending.discretion }}</span></div>
          <div class="muted" style="font-size:12px">{{ new Date(game.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') }} <span style="margin-left:12px">{{ game.language === 'zh' ? '中文' : 'English' }}</span></div>
          <p class="game-presets">{{ game.seatPresetNames.map((name, i) => `${i + 1}. ${name}`).join(' / ') }}</p>
          <p v-if="game.abortReason" class="error">{{ t(`games.abort.${game.abortReason}`) }}<span v-if="game.abortDetail">：{{ game.abortDetail }}</span></p>
          <p v-if="game.winner" class="muted">{{ t('games.winner', { team: t(`spectator.${game.winner}`) }) }}</p>
          <p v-if="!game.replayable" class="error">{{ t('games.incompatible') }}</p>
        </div>
        <div class="actions">
          <Button v-if="game.replayable" as-child><NuxtLink :to="`/games/${game.id}`">{{ t(game.status === 'ended' || game.status === 'aborted' ? 'games.replay' : 'games.open') }}</NuxtLink></Button>
          <Button v-else disabled>{{ t('games.replay') }}</Button>
          <Button as-child variant="outline"><NuxtLink :to="{ path: '/games/new', query: { from: game.id } }">{{ t('games.template') }}</NuxtLink></Button>
        </div>
      </article>
    </section>
  </main>
</template>
