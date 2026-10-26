import { PageRouteSymbol } from '#app/components/injections'
import { provide, type Component } from 'vue'
import AppShell from '@/components/AppShell.vue'

interface PageRoute {
  path: string
  spectator?: boolean
  params?: Record<string, string>
  query?: Record<string, string>
}

export function renderPage(page: Component, { spectator = false, ...route }: PageRoute) {
  return () => ({
    components: { AppShell, Page: page },
    setup: () => {
      // shortcut: injects a bare route the way <NuxtPage> does, since stories mount pages without routing; switch to router.replace if pages need guards or route meta.
      provide(PageRouteSymbol, {
        params: {},
        query: {},
        meta: {},
        ...route,
      } as never)
      return { spectator }
    },
    template: '<AppShell :spectator="spectator"><Suspense><Page /></Suspense></AppShell>',
  })
}
