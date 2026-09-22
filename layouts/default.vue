<template>
  <div class="app-shell">
    <!-- Mobile top bar -->
    <header v-if="isMobile" class="topbar mobile-topbar">
      <button class="hamburger" aria-label="菜单" @click="drawerOpen = true">☰</button>
      <img src="/logo-dark-bg.png" class="topbar-logo mobile" alt="小旺铺" />
      <div class="spacer" />
      <n-select
        v-if="isAdmin && storeOptions.length"
        v-model:value="currentStoreId"
        :options="storeOptions"
        size="small"
        placeholder="选择店铺"
        class="store-select"
      />
      <span v-else-if="currentStoreName" class="topbar-store-name">
        <n-icon :component="StorefrontOutline" size="15" />
        {{ currentStoreName }}
      </span>
    </header>

    <!-- Mobile drawer -->
    <n-drawer v-model:show="drawerOpen" placement="left" :width="220" :auto-focus="false">
      <n-drawer-content title="小旺铺" closable>
        <div class="drawer-menu">
          <div
            v-for="item in visibleMenus"
            :key="item.key"
            class="drawer-menu-item"
            :class="{ active: activeMenu === item.key }"
            @click="onMenuSelect(item.key)"
          >
            <n-icon :component="item.icon" size="20" />
            <span class="menu-label">{{ item.label }}</span>
          </div>
        </div>
        <template #footer>
          <div class="drawer-footer">
            <div class="drawer-user">
              <div class="drawer-user-info">
                <span class="drawer-user-row">
                  <n-icon :component="PersonOutline" size="16" />
                  <span class="drawer-user-name">{{ userName || '未登录' }}</span>
                </span>
                <span class="drawer-logout" @click="onLogout">
                  <n-icon :component="LogOutOutline" size="15" />
                  退出
                </span>
              </div>
            </div>
          </div>
        </template>
      </n-drawer-content>
    </n-drawer>

    <!-- Desktop sidebar -->
    <aside v-if="!isMobile" class="sidebar">
      <div class="sidebar-logo">
        <img src="/logo-dark-bg.png" alt="小旺铺" />
      </div>
      <nav class="sidebar-menu">
        <div
          v-for="item in visibleMenus"
          :key="item.key"
          class="sidebar-menu-item"
          :class="{ active: activeMenu === item.key }"
          @click="onMenuSelect(item.key)"
        >
          <n-icon :component="item.icon" size="20" />
          <span class="menu-label">{{ item.label }}</span>
        </div>
      </nav>
    </aside>

    <!-- Desktop top bar -->
    <header v-if="!isMobile" class="topbar desktop-topbar">
      <n-select
        v-if="isAdmin && storeOptions.length"
        v-model:value="currentStoreId"
        :options="storeOptions"
        size="small"
        placeholder="选择店铺"
        class="store-select"
      />
      <div class="spacer" />
      <div class="user-info">
        <template v-if="!isAdmin && currentStoreName">
          <span class="user-group">
            <n-icon :component="StorefrontOutline" size="16" />
            <span class="store-name">{{ currentStoreName }}</span>
          </span>
          <span class="user-divider" />
        </template>
        <span class="user-group">
          <n-icon :component="PersonOutline" size="16" />
          <span class="user-name">{{ userName || '未登录' }}</span>
        </span>
      </div>
      <n-button size="small" quaternary type="error" @click="onLogout">
        <template #icon><n-icon :component="LogOutOutline" /></template>
        退出
      </n-button>
    </header>

    <!-- Content -->
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { LogOutOutline, PersonOutline, StorefrontOutline } from '@vicons/ionicons5'
import { MENU_DEFS } from '~~/constants/roles'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { isMobile } = useIsMobile()

const visibleMenus = computed(() => {
  const role = authStore.userRole.value as Role | null
  return role ? MENU_DEFS.filter((d) => d.roles.includes(role)) : []
})

const currentStoreId = ref<number | null>(authStore.currentStoreId.value)

watch(currentStoreId, (v) => {
  if (v != null && v !== authStore.currentStoreId.value) {
    authStore.setCurrentStore(v)
    // 切换店铺后强制刷新当前路由，丢弃未监听 storeId 的页面残留状态
    if (import.meta.client) window.location.reload()
  }
})

watch(
  () => authStore.currentStoreId.value,
  (v) => { if (v !== currentStoreId.value) currentStoreId.value = v },
)

const userName = computed(() => authStore.userName.value)

const isAdmin = computed(() => authStore.userRole.value === 'admin')
const currentStoreName = computed(() => authStore.currentStore.value?.name ?? '')

const storeOptions = computed(() =>
  (authStore.stores.value || []).map((s: any) => ({ label: s.name, value: s.id })),
)

const drawerOpen = ref(false)
const activeMenu = ref(route.path)

function matchActive(path: string): string {
  if (path === '/') return '/'
  const keys = MENU_DEFS.map((d) => d.key).filter((k) => k !== '/').sort((a, b) => b.length - a.length)
  for (const k of keys) { if (path === k || path.startsWith(k + '/')) return k }
  return path
}

watch(() => route.path, (p) => { activeMenu.value = matchActive(p) }, { immediate: true })

function onMenuSelect(key: string) {
  drawerOpen.value = false
  router.push(key)
}

function onLogout() {
  drawerOpen.value = false
  authStore.logout()
  navigateTo('/login', { replace: true })
}
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #f7f9fa;
}

.spacer { flex: 1; }

/* ===== Mobile ===== */
.topbar {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
}

.mobile-topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #2b2f33;
  color: #ffffff;
}

.hamburger {
  background: none;
  border: none;
  color: #ffffff;
  font-size: 22px;
  line-height: 1;
  padding: 4px 8px;
  cursor: pointer;
}

.topbar-logo.mobile {
  height: 26px;
  display: block;
}

.store-select { width: 140px; }

/* 非 admin 在移动端顶栏显示的店铺名（深色底） */
.topbar-store-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  white-space: nowrap;
  color: #ffffff;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #666666;
}

.user-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.user-divider {
  width: 1px;
  height: 14px;
  background: #e5e7eb;
  flex-shrink: 0;
}

.user-name {
  font-size: 13px;
  white-space: nowrap;
  color: #666666;
}

.store-name {
  font-size: 13px;
  white-space: nowrap;
  color: #666666;
}

.drawer-footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drawer-user {
  display: flex;
  align-items: center;
  padding: 4px 4px;
}
.drawer-user-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}
.drawer-user-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: #333333;
}
.drawer-user-row .n-icon { flex-shrink: 0; }
.drawer-user-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 16px;
  color: #333333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.drawer-logout {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  line-height: 15px;
  color: #F44336;
  cursor: pointer;
}
.drawer-logout .n-icon { flex-shrink: 0; }
.drawer-logout:active { opacity: 0.7; }

.content { padding: 12px; }

/* ===== Drawer menu (mobile) ===== */
.drawer-menu { display: flex; flex-direction: column; gap: 2px; }

.drawer-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  color: #333;
  font-size: 15px;
  transition: all 0.15s;
}

.drawer-menu-item:hover { background: #f0f0f0; }
.drawer-menu-item.active { background: #169C91; color: #fff; }

.menu-label { font-size: 15px; }

/* ===== Desktop ===== */
@media (min-width: 768px) {
  .app-shell {
    display: grid;
    grid-template-columns: 160px 1fr;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
  }

  .sidebar {
    grid-column: 1;
    grid-row: 1 / 3;
    display: flex;
    flex-direction: column;
    background: #2b2f33;
  }

  .sidebar-logo {
    height: 56px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .sidebar-logo img { height: 28px; }

  .sidebar-menu {
    flex: 1;
    padding: 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.85);
    transition: all 0.15s;
  }

  .sidebar-menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .sidebar-menu-item.active {
    background: #169C91;
    color: #ffffff;
  }

  .desktop-topbar {
    grid-column: 2;
    grid-row: 1;
    position: sticky;
    top: 0;
    z-index: 100;
    background: #ffffff;
    border-bottom: 1px solid #e5e7eb;
    padding: 0 20px;
    gap: 16px;
  }

  .desktop-topbar .store-select { width: 200px; }

  .content {
    grid-column: 2;
    grid-row: 2;
    padding: 20px;
  }
}
</style>