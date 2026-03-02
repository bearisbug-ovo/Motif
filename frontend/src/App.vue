<script setup lang="ts">
import { NConfigProvider, NMessageProvider, darkTheme } from 'naive-ui'
import { zhCN, dateZhCN } from 'naive-ui'
import AppLayout from '@/components/AppLayout.vue'

const themeOverrides = {
  common: {
    primaryColor: '#818cf8',
    primaryColorHover: '#6366f1',
    primaryColorPressed: '#4f46e5',
    bodyColor: '#0d0d1a',
    cardColor: '#1a1a32',
    modalColor: '#1a1a32',
    popoverColor: '#1e1e38',
    borderColor: '#2a2a4a',
    inputColor: '#13133a',
    textColor1: '#e2e8f0',
    textColor2: '#cbd5e1',
    textColor3: '#94a3b8',
  },
  Input: { color: '#13133a', colorFocus: '#1a1a4a' },
  Select: { peers: { InternalSelection: { color: '#13133a' } } },
  Card: { color: '#1a1a32', borderColor: '#2a2a4a' },
  Modal: { color: '#1a1a32' },
  Drawer: { color: '#13131f' },
  Button: { colorPrimary: '#818cf8', colorHoverPrimary: '#6366f1', textColorPrimary: '#fff' },
}
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <NMessageProvider>
      <AppLayout />
    </NMessageProvider>
  </NConfigProvider>
</template>
