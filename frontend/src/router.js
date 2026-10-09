import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import CatalogView from './views/CatalogView.vue'
import EventView from './views/EventView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/cameras', component: CatalogView, props: { resource: 'cameras' } },
    { path: '/videos', component: CatalogView, props: { resource: 'videos' } },
    { path: '/events', component: CatalogView, props: { resource: 'events' } },
    { path: '/events/:id', component: EventView, props: true },
    { path: '/:pathMatch(.*)*', component: { template: '<section class="dashboard-panel"><h1>페이지를 찾을 수 없습니다.</h1><RouterLink to="/">대시보드로 이동</RouterLink></section>' } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
