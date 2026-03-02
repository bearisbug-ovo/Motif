<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const navItems = [
  { path: '/characters', icon: '👤', label: '人物' },
  { path: '/generate',   icon: '✦',  label: '生成' },
  { path: '/tasks',      icon: '≡',  label: '任务' },
  { path: '/gallery',    icon: '🖼',  label: '图库' },
]

const activeNav = computed(() => '/' + route.path.split('/')[1])
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden">
    <!-- 左侧边栏 -->
    <aside class="flex flex-col w-16 shrink-0" style="background:#111127; border-right:1px solid #2a2a4a;">
      <!-- Logo -->
      <div class="flex items-center justify-center h-14 shrink-0" style="border-bottom:1px solid #2a2a4a;">
        <span class="text-lg font-bold" style="color:#818cf8;">M</span>
      </div>

      <!-- 导航 -->
      <nav class="flex flex-col items-center gap-1 pt-3">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex flex-col items-center justify-center w-12 h-14 rounded-lg text-xs gap-1 transition-all"
          :class="activeNav === item.path
            ? 'text-white'
            : 'text-gray-500 hover:text-gray-300'"
          :style="activeNav === item.path ? 'background:#1a1a4a;' : ''"
        >
          <span class="text-lg leading-none">{{ item.icon }}</span>
          <span class="leading-none" style="font-size:10px;">{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 overflow-hidden">
      <RouterView />
    </main>
  </div>
</template>
