// typescript-eslint has no Vue language plugin; vue-tsc resolves the real component types instead.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
