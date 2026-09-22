export default defineNuxtPlugin(() => {
  useSessionRefresh().start()
})
