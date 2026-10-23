<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { GameSummary } from '#shared/types/game-view'

const { t } = useI18n()
const {
  data: games,
  refresh,
  error,
} = await useFetch<GameSummary[]>('/api/games', { default: () => [] })
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
  <section class="grid gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">{{ t('games.title') }}</h1>
      <Button as-child
        ><NuxtLink to="/games/new">{{ t('games.new') }}</NuxtLink></Button
      >
    </div>
    <p v-if="error" role="alert" class="text-destructive">{{ apiErrorMessage(error) }}</p>
    <p v-if="!games.length" class="text-muted-foreground">{{ t('games.empty') }}</p>
    <Table v-else>
      <TableHeader
        ><TableRow>
          <TableHead>{{ t('games.game') }}</TableHead>
          <TableHead>{{ t('games.models') }}</TableHead>
          <TableHead>{{ t('games.status') }}</TableHead>
          <TableHead>{{ t('games.reason') }}</TableHead>
          <TableHead>{{ t('games.template') }}</TableHead>
        </TableRow></TableHeader
      >
      <TableBody>
        <TableRow v-for="game in games" :key="game.id">
          <TableCell
            ><NuxtLink :to="`/games/${game.id}`" class="underline underline-offset-4">{{
              game.id.slice(0, 8)
            }}</NuxtLink></TableCell
          >
          <TableCell>{{ game.config.seats.map((seat) => seat.name).join(' / ') }}</TableCell>
          <TableCell
            ><Badge variant="secondary">{{
              game.compatible ? t(`games.${game.status}`) : t('games.incompatible')
            }}</Badge></TableCell
          >
          <TableCell>{{ game.reason ? t(`games.reasons.${game.reason}`) : '—' }}</TableCell>
          <TableCell>
            <Button v-if="game.compatible" variant="outline" size="sm" as-child>
              <NuxtLink :to="{ path: '/games/new', query: { template: game.id } }">
                {{ t('games.template') }}
              </NuxtLink>
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </section>
</template>
