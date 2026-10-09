import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from './views/DashboardView.vue'
import CatalogView from './views/CatalogView.vue'
import EventView from './views/EventView.vue'
import LoginView from './views/LoginView.vue'
import RecipientsView from './views/RecipientsView.vue'
import NotFoundView from './views/NotFoundView.vue'
import { accessToken } from './auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/cameras', component: CatalogView, props: { resource: 'cameras' } },
    { path: '/videos', component: CatalogView, props: { resource: 'videos' } },
    { path: '/events', component: CatalogView, props: { resource: 'events' } },
    { path: '/events/:id', component: EventView, props: true },
    { path: '/login', component: LoginView },
    { path: '/sms-recipients', component: RecipientsView, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', component: NotFoundView },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
router.beforeEach(to => {
  if (to.meta.requiresAuth && !accessToken.value) return { path: '/login', query: { redirect: to.fullPath } }
})
export default router
