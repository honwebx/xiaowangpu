<template>
  <div class="setup-container">
    <picture class="setup-logo">
      <source media="(max-width: 767px)" srcset="/logo-light-bg.png" />
      <img src="/logo-dark-bg.png" alt="小旺铺" />
    </picture>

    <!-- 协议弹窗 -->
    <n-modal v-model:show="showAgreement" preset="card" title="小旺铺店铺管理系统用户使用协议" :style="{ maxWidth: '640px', width: '92vw', maxHeight: '80vh' }" :bordered="false">
      <div class="agreement-body">
        <iframe
          v-if="showAgreement && agreementLoaded"
          :srcdoc="agreementHtml"
          class="agreement-iframe"
          sandbox=""
          referrerpolicy="no-referrer"
        ></iframe>
        <n-spin v-else-if="showAgreement" />
      </div>
      <template #footer>
        <div style="display: flex; justify-content: center; gap: 16px;">
          <n-button @click="showAgreement = false">关闭</n-button>
        </div>
      </template>
    </n-modal>

    <div v-if="checked && needSetup" class="setup-card">
      <n-form :model="form" label-placement="top" size="large">
        <n-form-item label="管理员姓名" required>
          <n-input v-model:value="form.adminName" placeholder="请输入姓名" />
        </n-form-item>
        <n-form-item label="管理员手机号" required>
          <n-input v-model:value="form.adminPhone" placeholder="请输入手机号" />
        </n-form-item>
        <n-form-item label="管理员密码" required>
          <n-input v-model:value="form.adminPassword" type="password" placeholder="请输入密码" show-password-on="click" />
        </n-form-item>
        <n-form-item label="确认密码" required>
          <n-input v-model:value="form.confirmPassword" type="password" placeholder="请再次输入密码" show-password-on="click" />
        </n-form-item>
        <n-form-item label="店铺名称" required>
          <n-input v-model:value="form.storeName" placeholder="如：人民路店" />
        </n-form-item>
      </n-form>

      <div class="agreement-check">
        <n-checkbox v-model:checked="agreed">我已阅读并同意</n-checkbox>
        <n-button text type="primary" class="agreement-link" @click="openAgreement">《小旺铺店铺管理系统用户使用协议》</n-button>
      </div>

      <n-button type="primary" block size="large" class="submit-btn" :loading="loading" :disabled="!agreed" @click="handleSubmit">完成初始化</n-button>
      <n-alert v-if="error" type="error" style="margin-top: 12px;">{{ error }}</n-alert>
    </div>
    <div v-else class="setup-loading"><n-spin /></div>
    <p class="setup-footer">小旺铺 · 让生意更简单</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: [
    async () => {
      try {
        const res: any = await useApiFetch('/api/auth/check-setup')
        if (res?.needSetup === false) return navigateTo('/login', { replace: true })
      } catch {}
    },
  ],
})

const toast = useToast()
const form = reactive({ adminName: '', adminPhone: '', adminPassword: '', confirmPassword: '', storeName: '' })
const loading = ref(false)
const error = ref('')
const agreed = ref(false)
const checked = ref(false)
const needSetup = ref(false)
const showAgreement = ref(false)
const agreementHtml = ref('')
const agreementLoaded = ref(false)

onMounted(async () => {
  try {
    const res: any = await useApiFetch('/api/auth/check-setup')
    if (res?.needSetup === false) {
      await navigateTo('/login', { replace: true })
      return
    }
    needSetup.value = true
  } catch {
    needSetup.value = true
  } finally {
    checked.value = true
  }
})

async function openAgreement() {
  showAgreement.value = true
  if (!agreementLoaded.value) {
    try {
      agreementHtml.value = await useApiFetch<string>('/agreement.html', { responseType: 'text' })
      agreementLoaded.value = true
    } catch {
      agreementHtml.value = '<p style="font:14px sans-serif;padding:16px;">协议加载失败，请刷新重试。</p>'
      agreementLoaded.value = true
    }
  }
}

function handleSubmit() {
  if (loading.value) return
  error.value = ''
  if (!agreed.value) {
    error.value = '请先阅读并同意用户使用协议'
    return
  }
  if (!form.adminName || !form.adminPhone || !form.adminPassword || !form.confirmPassword || !form.storeName) {
    error.value = '请填写所有必填项'
    return
  }
  if (!/^1\d{10}$/.test(form.adminPhone)) {
    error.value = '手机号格式不正确'
    return
  }
  if (form.adminPassword !== form.confirmPassword) {
    error.value = '两次密码不一致'
    return
  }
  if (form.adminPassword.length < 6) {
    error.value = '密码至少6位'
    return
  }
  if (form.adminPassword.length > 128) {
    error.value = '密码过长，最多128位'
    return
  }
  loading.value = true
  useApiFetch('/api/setup', {
    method: 'POST',
    body: {
      admin: { name: form.adminName, phone: form.adminPhone, password: form.adminPassword },
      store: { name: form.storeName },
    },
  })
    .then(() => {
      toast.success('初始化成功')
      navigateTo('/login', { replace: true })
    })
    .catch((e: any) => {
      error.value = e?.data?.message || e?.message || '初始化失败'
    })
    .finally(() => {
      loading.value = false
    })
}
</script>

<style scoped>
.setup-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  box-sizing: border-box;
  background: #2b2f33;
  padding: 40px 16px;
  padding-bottom: calc(40px + env(safe-area-inset-bottom));
}
.setup-card {
  background: #fff;
  border-radius: 12px;
  padding: 36px 32px;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
}
.setup-logo {
  max-width: 200px;
  margin-bottom: 24px;
}
.setup-logo img {
  display: block;
  max-width: 100%;
  height: auto;
}
.setup-footer {
  display: none;
}
.setup-loading {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}
.agreement-check {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
}
.agreement-check :deep(.agreement-link) {
  height: auto;
  padding: 0;
  font-weight: 400;
  box-shadow: none;
  white-space: normal;
  text-align: left;
  line-height: 1.6;
}
.agreement-body {
  max-height: 55vh;
  overflow: hidden;
}
.agreement-iframe {
  width: 100%;
  height: 55vh;
  border: 0;
  background: #fff;
}
@media (max-width: 767px) {
  .setup-container {
    position: relative;
    justify-content: flex-start;
    min-height: 100dvh;
    padding: 56px 20px calc(20px + env(safe-area-inset-bottom));
    background: linear-gradient(180deg, #ddf3f0 0%, #eef7f6 34%, #f7f9fa 62%, #ffffff 100%);
    overflow: hidden;
  }
  .setup-container::before,
  .setup-container::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }
  .setup-container::before {
    top: -120px;
    right: -100px;
    width: 260px;
    height: 260px;
    background: radial-gradient(circle, rgba(22, 156, 145, 0.22) 0%, rgba(22, 156, 145, 0) 70%);
  }
  .setup-container::after {
    top: 40px;
    left: -110px;
    width: 220px;
    height: 220px;
    background: radial-gradient(circle, rgba(43, 181, 168, 0.16) 0%, rgba(43, 181, 168, 0) 70%);
  }
  .setup-logo {
    max-width: 196px;
    margin-bottom: 22px;
    filter: drop-shadow(0 4px 12px rgba(22, 156, 145, 0.18));
  }
  .setup-card {
    position: relative;
    z-index: 1;
    padding: 24px 20px 22px;
    border: 1px solid #edf2f1;
    border-radius: 20px;
    box-shadow: 0 16px 40px rgba(22, 156, 145, 0.14), 0 2px 8px rgba(0, 0, 0, 0.05);
  }
  .setup-card :deep(.n-input .n-input__input-el) {
    min-height: 48px;
  }
  .setup-card :deep(.n-input) {
    border-radius: 12px;
  }
  .setup-card :deep(.submit-btn) {
    height: 48px;
    margin-top: 6px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 4px;
    box-shadow: 0 8px 20px rgba(22, 156, 145, 0.35);
  }
  .setup-card :deep(.submit-btn:active) {
    transform: scale(0.99);
  }
  .agreement-check {
    flex-wrap: wrap;
    row-gap: 6px;
    font-size: 13px;
    line-height: 1.6;
    color: #4c5e5d;
  }
  .agreement-check :deep(.agreement-link) {
    font-size: 13px;
  }
  .setup-footer {
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