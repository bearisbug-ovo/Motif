import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/characters' },
    { path: '/characters', component: () => import('@/views/CharactersView.vue') },
    { path: '/generate',   component: () => import('@/views/GenerateView.vue') },
    { path: '/tasks',      component: () => import('@/views/TasksView.vue') },
    { path: '/gallery',    component: () => import('@/views/GalleryView.vue') },
    { path: '/inpaint/:id', component: () => import('@/views/InpaintView.vue') },
    { path: '/viewer/:charId/:photoIdx', component: () => import('@/views/ViewerView.vue') },
  ],
})

export default router
