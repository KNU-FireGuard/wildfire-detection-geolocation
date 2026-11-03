import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import CatalogView from './views/CatalogView.vue'
import AdminView from './views/AdminView.vue'
import EventView from './views/EventView.vue'
import NotFoundView from './views/NotFoundView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/cameras', component: CatalogView, props: { resource: 'cameras' } },
    { path: '/events', component: CatalogView, props: { resource: 'events' } },
    { path: '/events/:id', component: EventView, props: true },
    { path: '/admin', component: AdminView },
    { path: '/:pathMatch(.*)*', component: NotFoundView },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
