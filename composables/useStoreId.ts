export function useStoreId() {
  const authStore = useAuthStore()
  const storeId = computed(() => authStore.currentStoreId.value)

  function requireStoreId(): number {
    if (!storeId.value) throw new Error('请先选择门店')
    return storeId.value
  }

  return { storeId, requireStoreId }
}
