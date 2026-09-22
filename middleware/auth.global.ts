import { ROUTE_RESTRICTIONS } from '~~/constants/roles'

export default defineNuxtRouteMiddleware((to) => {
  const authStore = useAuthStore()
  if (!authStore.token.value) {
    if (to.path !== '/login' && to.path !== '/setup') {
      return navigateTo('/login', { replace: true })
    }
    return
  }
  if (to.path === '/login') {
    return navigateTo('/', { replace: true })
  }
  const role = authStore.user.value?.role
  if (!role) return
  for (const r of ROUTE_RESTRICTIONS) {
    if (to.path === r.prefix || to.path.startsWith(r.prefix + '/')) {
      if (!r.allow.includes(role)) {
        return navigateTo('/', { replace: true })
      }
      return
    }
  }
})
