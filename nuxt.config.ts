export default defineNuxtConfig({
  ssr: false,
  modules: ['@nuxthub/core'],
  nitro: {
    cloudflareDev: {
      configPath: './wrangler.toml',
      persistDir: '.wrangler/state',
    },
  },
  hub: {
    workers: true,
    database: true,
  },
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: '小旺铺',
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
      ],
    },
  },
  runtimeConfig: {
    jwtSecret: process.env.NUXT_JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev-only-jwt-secret-do-not-use-in-prod' : ''),
  },
  vite: {
    optimizeDeps: {
      include: ['vueuc', 'date-fns', 'evtd', 'vdirs', 'treemate', 'vooks', 'css-render', '@css-render/vue3-ssr'],
    },
  },
  compatibilityDate: '2026-09-05',
  experimental: { appManifest: false },
})
