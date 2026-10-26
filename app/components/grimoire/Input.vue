<script setup lang="ts">
const model = defineModel<string | number>()
</script>

<template>
  <input v-model="model" class="grimoire-field" />
</template>
