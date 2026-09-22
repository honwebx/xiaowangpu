export function useIsMobile() {
  const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768)
  let cleanup: (() => void) | null = null

  onMounted(() => {
    const check = () => {
      isMobile.value = window.innerWidth < 768
    }
    check()
    window.addEventListener('resize', check)
    cleanup = () => window.removeEventListener('resize', check)
  })

  onUnmounted(() => {
    if (cleanup) cleanup()
  })

  return { isMobile }
}
