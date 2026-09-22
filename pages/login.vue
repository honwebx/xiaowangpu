<template>
  <div class="login-container">
    <picture class="login-logo">
      <source media="(max-width: 767px)" srcset="/logo-light-bg.png" />
      <img src="/logo-dark-bg.png" alt="小旺铺" />
    </picture>
    <div class="login-card">
      <n-form :model="form" label-placement="top" size="large">
        <n-form-item v-if="storeOptions.length > 0" label="选择店铺">
          <n-select v-model:value="form.storeId" :options="storeOptions" placeholder="选择店铺 / 管理员" />
        </n-form-item>
        <n-tabs v-model:value="tab" type="line" animated>
          <n-tab-pane name="password" tab="密码登录">
            <n-form-item label="手机号" required>
              <n-input v-model:value="form.phone" placeholder="请输入手机号" />
            </n-form-item>
            <n-form-item label="密码" required>
              <n-input
                v-model:value="form.password"
                type="password"
                show-password-on="click"
                placeholder="请输入密码"
                @keyup.enter="onPasswordLogin"
              />
            </n-form-item>
            <n-button type="primary" block size="large" :loading="loading" :disabled="loading" @click="onPasswordLogin">登录</n-button>
          </n-tab-pane>
          <n-tab-pane name="sms" tab="验证码登录" v-if="smsEnabled">
            <n-form-item label="手机号" required>
              <n-input v-model:value="form.phone" placeholder="请输入手机号" />
            </n-form-item>
            <n-form-item label="验证码" required>
              <n-input-group>
                <n-input v-model:value="form.code" placeholder="请输入验证码" @keyup.enter="onSmsLogin" />
                <n-button :disabled="countdown > 0 || sending" :loading="sending" @click="onSendCode">
                  {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
                </n-button>
              </n-input-group>
            </n-form-item>
            <n-button type="primary" block size="large" :loading="loading" :disabled="loading" @click="onSmsLogin">登录</n-button>
          </n-tab-pane>
        </n-tabs>
      </n-form>
      <n-alert v-if="error" type="error" style="margin-top: 12px;">{{ error }}</n-alert>
    </div>
    <p class="login-footer">小旺铺 · 让生意更简单</p>
  </div>
</template>

<script setup lang="ts">
import type { SelectOption } from 'naive-ui'

definePageMeta({ layout: 'auth' })

const toast = useToast()
const authStore = useAuthStore()

const form = reactive({
  storeId: null as number | null,
  phone: '',
  password: '',
  code: '',
})
const tab = ref('password')
const smsEnabled = ref(false)
const loading = ref(false)
const sending = ref(false)
const error = ref('')
const countdown = ref(0)

const stores = ref<Array<{ id: number; name: string; address?: string | null; phone?: string | null }>>([])

const storeOptions = computed<SelectOption[]>(() => [
  { label: '管理员（跨店）', value: null },
  ...stores.value.map((s) => ({ label: s.name, value: s.id })),
])

let timer: ReturnType<typeof setInterval> | null = null

function startCountdown() {
  countdown.value = 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

onMounted(async () => {
  try {
    const res: any = await useApiFetch('/api/auth/check-setup')
    if (Array.isArray(res?.stores)) stores.value = res.stores
    smsEnabled.value = res?.smsCodeLoginEnabled === true
    if (!smsEnabled.value) tab.value = 'password'
  } catch {
    // ignore — allow normal login flow
  }
})

function applyAuth(res: any) {
  authStore.setAuth({
    token: res.token,
    user: {
      id: res.user.id,
      name: res.user.name,
      phone: res.user.phone,
      role: res.user.role,
      store_id: res.user.store_id ?? null,
    },
    stores: res.stores || [],
    currentStoreId: res.defaultStoreId ?? null,
  })
}

function validPhone() {
  if (!/^1\d{10}$/.test(form.phone)) {
    error.value = '手机号格式不正确'
    return false
  }
  return true
}

async function onPasswordLogin() {
  error.value = ''
  if (!validPhone() || !form.password) {
    if (!error.value) error.value = '请输入手机号和密码'
    return
  }
  loading.value = true
  try {
    const res: any = await useApiFetch('/api/auth/login', {
      method: 'POST',
      body: { storeId: form.storeId, phone: form.phone, password: form.password },
    })
    applyAuth(res)
    toast.success('登录成功')
    navigateTo('/', { replace: true })
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}

async function onSendCode() {
  error.value = ''
  if (!validPhone()) return
  sending.value = true
  try {
    const res: any = await useApiFetch('/api/auth/send-code', {
      method: 'POST',
      body: { phone: form.phone },
    })
    if (res?.code) {
      form.code = String(res.code)
      toast.info(`开发模式验证码：${res.code}`)
    } else if (res?.sent) {
      toast.success('验证码已发送')
    } else {
      error.value = '验证码发送失败，请稍后重试或联系管理员'
    }
    startCountdown()
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || '验证码发送失败'
  } finally {
    sending.value = false
  }
}

async function onSmsLogin() {
  error.value = ''
  if (!validPhone() || !form.code) {
    if (!error.value) error.value = '请输入手机号和验证码'
    return
  }
  loading.value = true
  try {
    const res: any = await useApiFetch('/api/auth/sms-login', {
      method: 'POST',
      body: { storeId: form.storeId, phone: form.phone, code: form.code },
    })
    applyAuth(res)
    toast.success('登录成功')
    navigateTo('/', { replace: true })
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  background: #2b2f33;
}

.login-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.login-logo {
  max-width: 180px;
  margin-bottom: 16px;
}

.login-logo img {
  display: block;
  max-width: 100%;
  height: auto;
}

.login-footer {
  display: none;
}

@media (min-width: 768px) {
  .login-card {
    padding: 28px;
    border-radius: 12px;
  }
}

@media (max-width: 767px) {
  .login-container {
    position: relative;
    justify-content: flex-start;
    min-height: 100dvh;
    padding: 56px 20px calc(20px + env(safe-area-inset-bottom));
    background: linear-gradient(180deg, #ddf3f0 0%, #eef7f6 34%, #f7f9fa 62%, #ffffff 100%);
    overflow: hidden;
  }

  .login-container::before,
  .login-container::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }

  .login-container::before {
    top: -120px;
    right: -100px;
    width: 260px;
    height: 260px;
    background: radial-gradient(circle, rgba(22, 156, 145, 0.22) 0%, rgba(22, 156, 145, 0) 70%);
  }

  .login-container::after {
    top: 40px;
    left: -110px;
    width: 220px;
    height: 220px;
    background: radial-gradient(circle, rgba(43, 181, 168, 0.16) 0%, rgba(43, 181, 168, 0) 70%);
  }

  .login-logo {
    max-width: 196px;
    margin-bottom: 22px;
    filter: drop-shadow(0 4px 12px rgba(22, 156, 145, 0.18));
  }

  .login-card {
    position: relative;
    z-index: 1;
    padding: 24px 20px 22px;
    border: 1px solid #edf2f1;
    border-radius: 20px;
    box-shadow: 0 16px 40px rgba(22, 156, 145, 0.14), 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .login-card :deep(.n-tabs-tab) {
    font-size: 16px;
    font-weight: 600;
  }

  .login-card :deep(.n-input .n-input__input-el),
  .login-card :deep(.n-base-selection) {
    min-height: 48px;
  }

  .login-card :deep(.n-input),
  .login-card :deep(.n-base-selection .n-base-selection-label) {
    border-radius: 12px;
  }

  .login-card :deep(.n-button--primary-type) {
    height: 48px;
    margin-top: 6px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 4px;
    box-shadow: 0 8px 20px rgba(22, 156, 145, 0.35);
  }

  .login-card :deep(.n-button--primary-type:active) {
    transform: scale(0.99);
  }

  .login-footer {
    display: block;
    position: relative;
    z-index: 1;
    margin: 22px 0 0;
    font-size: 12px;
    letter-spacing: 1px;
    color: #a7bcbb;
  }
}
</style>
