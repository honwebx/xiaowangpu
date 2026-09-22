export const useApiFetch = $fetch.create({
  onRequest({ options }) {
    const token = useAuthStore().token.value
    if (token) {
      options.headers = { ...options.headers, Authorization: `Bearer ${token}` }
    }
  },
  onResponseError({ response }) {
    if (response.status === 401 && typeof window !== 'undefined') {
      useAuthStore().logout()
      if (location.pathname !== '/login') location.href = '/login'
    }
  },
})
