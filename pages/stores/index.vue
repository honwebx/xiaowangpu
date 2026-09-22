<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">店铺管理</h2>
      <div class="spacer" />
      <n-button v-if="isAdmin" type="primary" @click="openNew">+ 新增店铺</n-button>
    </div>

    <n-alert v-if="!isAdmin" type="warning" title="无权限" class="deny-alert">
      您没有权限访问该页面。
    </n-alert>

    <template v-else>
      <n-spin :show="loading">
        <div v-if="!stores.length && !loading" class="empty-wrap">暂无店铺</div>

        <!-- Desktop table -->
        <div v-if="stores.length" class="desktop-table">
          <n-data-table
            :columns="columns"
            :data="stores"
            :bordered="false"
            size="small"
            :scroll-x="640"
          />
          <div class="mobile-pager">
            <n-button size="small" :disabled="storePage <= 1" @click="onStorePageChange(storePage - 1)">上一页</n-button>
            <span class="pager-info">第 {{ storePage }} 页 / 共 {{ storeTotalPages }} 页</span>
            <n-button size="small" :disabled="storePage >= storeTotalPages" @click="onStorePageChange(storePage + 1)">下一页</n-button>
          </div>
        </div>

        <!-- Mobile cards -->
        <div v-if="stores.length" class="mobile-cards">
          <div v-for="s in stores" :key="s.id" class="store-card">
            <div class="stc-head">
              <span class="stc-name">{{ s.name }}</span>
              <span class="stc-expand" @click="toggleExpand(s.id)">
                <n-icon :component="expandedMap[s.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
              </span>
            </div>
            <template v-if="expandedMap[s.id]">
              <div class="stc-meta">
                <span>{{ s.address || '-' }}</span>
              </div>
              <div class="stc-foot">
                <span class="stc-time">{{ s.phone || '-' }} · {{ fmtDateTime(s.created_at) }}</span>
                <div class="stc-actions">
                  <n-button size="small" quaternary type="primary" @click="openEdit(s)">编辑</n-button>
                  <n-button v-if="stores.length > 1" size="small" quaternary type="error" @click="onDelete(s)">删除</n-button>
                </div>
              </div>
            </template>
          </div>
          <div class="mobile-pager">
            <n-button size="small" :disabled="storePage <= 1" @click="onStorePageChange(storePage - 1)">上一页</n-button>
            <span class="pager-info">第 {{ storePage }} 页 / 共 {{ storeTotalPages }} 页</span>
            <n-button size="small" :disabled="storePage >= storeTotalPages" @click="onStorePageChange(storePage + 1)">下一页</n-button>
          </div>
        </div>
      </n-spin>

      <n-modal v-model:show="formVisible" preset="card" :title="formMode === 'new' ? '新增店铺' : '编辑店铺'" :style="modalStyle" :bordered="false" :mask-closable="!formSaving">
        <n-form ref="formRef" :model="formModel" :rules="formRules" label-placement="top">
          <n-form-item label="店铺名称" path="name">
            <n-input v-model:value="formModel.name" placeholder="请输入店铺名称" />
          </n-form-item>
          <n-form-item label="地址" path="address">
            <n-input v-model:value="formModel.address" placeholder="请输入地址（选填）" />
          </n-form-item>
          <n-form-item label="电话" path="phone">
            <n-input v-model:value="formModel.phone" placeholder="请输入电话（选填）" />
          </n-form-item>
          <div class="form-actions">
            <n-button @click="formVisible = false">取消</n-button>
            <n-button type="primary" :loading="formSaving" :disabled="formSaving" @click="saveStore">保存</n-button>
          </div>
        </n-form>
      </n-modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NInput, type DataTableColumns, type FormInst, type FormRules } from 'naive-ui'
import { ChevronDownOutline, ChevronUpOutline } from '@vicons/ionicons5'
import type { Store } from '~/types'

definePageMeta({ layout: 'default' })

const authStore = useAuthStore()
const { isMobile } = useIsMobile()
const toast = useToast()

const expandedMap = ref<Record<number, boolean>>({})
function toggleExpand(id: number) {
  expandedMap.value = { ...expandedMap.value, [id]: !expandedMap.value[id] }
}

const isAdmin = computed(() => authStore.userRole.value === 'admin')

const loading = ref(false)
const stores = ref<Store[]>([])
const storePage = ref(1)
const storePageSize = 20
const storeTotal = ref(0)
const storeTotalPages = computed(() => Math.max(1, Math.ceil(storeTotal.value / storePageSize)))
function onStorePageChange(page: number) {
  storePage.value = page
  loadStores()
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '-'
  return s.length >= 16 ? s.slice(0, 16) : s
}

const columns = computed<DataTableColumns<Store>>(() => [
  { title: '店铺名称', key: 'name', width: 180 },
  { title: '地址', key: 'address', width: 240, render: (r) => r.address || '-' },
  { title: '电话', key: 'phone', width: 140, render: (r) => r.phone || '-' },
  { title: '创建时间', key: 'created_at', width: 160, render: (r) => fmtDateTime(r.created_at) },
  {
    title: '操作', key: 'actions', width: 140, fixed: 'right',
    render: (r) => {
      const buttons = [
        h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(r) }, { default: () => '编辑' }),
      ]
      if (stores.value.length > 1) {
        buttons.push(
          h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => onDelete(r) }, { default: () => '删除' })
        )
      }
      return buttons
    },
  },
])

async function loadStores() {
  loading.value = true
  try {
    const data = await useApiFetch<{ items: Store[]; total: number }>('/api/stores', {
      query: { page: storePage.value, pageSize: storePageSize },
    })
    stores.value = data?.items || []
    if (data && data.total >= 0) storeTotal.value = data.total
    if (storePage.value === 1) {
      authStore.updateStores(stores.value as any)
    }
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    loading.value = false
  }
}

const formVisible = ref(false)
const formMode = ref<'new' | 'edit'>('new')
const formSaving = ref(false)
const formRef = ref<FormInst | null>(null)
const formModel = reactive<{ id?: number; name: string; address: string; phone: string }>({
  name: '', address: '', phone: '',
})
const formRules: FormRules = {
  name: [
    { required: true, message: '请输入店铺名称', trigger: ['blur', 'input'] },
    { type: 'string', max: 64, message: '店铺名称最多64个字符', trigger: ['blur', 'input'] },
  ],
  address: { type: 'string', max: 128, message: '地址最多128个字符', trigger: ['blur', 'input'] },
  phone: { type: 'string', max: 32, message: '电话最多32个字符', trigger: ['blur', 'input'] },
}
const modalStyle = computed(() => (isMobile.value ? { width: '92vw', maxWidth: '92vw' } : { width: '480px', maxWidth: '92vw' }))

function openNew() {
  formMode.value = 'new'
  formModel.id = undefined
  formModel.name = ''
  formModel.address = ''
  formModel.phone = ''
  formVisible.value = true
}
function openEdit(row: Store) {
  formMode.value = 'edit'
  formModel.id = row.id
  formModel.name = row.name
  formModel.address = row.address || ''
  formModel.phone = row.phone || ''
  formVisible.value = true
}

async function saveStore() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  formSaving.value = true
  try {
    const body = {
      name: formModel.name.trim(),
      address: formModel.address.trim() || null,
      phone: formModel.phone.trim() || null,
    }
    if (formMode.value === 'new') {
      await useApiFetch('/api/stores', { method: 'POST', body })
      storePage.value = Math.max(1, Math.ceil((storeTotal.value + 1) / storePageSize))
    } else {
      await useApiFetch(`/api/stores/${formModel.id}`, { method: 'PUT', body })
    }
    toast.success('保存成功')
    formVisible.value = false
    await loadStores()
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    formSaving.value = false
  }
}

function onDelete(row: Store) {
  const confirmText = `删除${row.name}`
  let inputValue = ''
  ;(window as any).$dialog?.warning({
    title: '危险操作',
    content: () => h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      h('p', { style: 'margin:0;color:#F44336;' }, '将清空该店铺所有数据（商品、会员、订单、设置等），不可恢复。'),
      h('p', { style: 'margin:0;' }, `请输入「${confirmText}」以确认删除：`),
      h(NInput, {
        placeholder: confirmText,
        autofocus: true,
        'onUpdate:value': (v: string) => { inputValue = v },
      }),
    ]),
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (inputValue !== confirmText) {
        toast.warning('请输入正确的确认文字')
        return false
      }
      try {
        await useApiFetch(`/api/stores/${row.id}`, { method: 'DELETE' })
        toast.success('已删除')
        const wasCurrent = authStore.currentStoreId.value === row.id
        await loadStores()
        // 重载后若当前店已不存在，切到剩余第一家，避免 currentStoreId 残留
        if (wasCurrent) {
          const stillThere = stores.value.some((s: any) => s.id === row.id)
          if (!stillThere && stores.value.length > 0) authStore.setCurrentStore(stores.value[0].id)
        }
      } catch (e) {
        toast.error(apiErr(e))
      }
    },
  })
}

onMounted(() => {
  if (isAdmin.value) loadStores()
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.page-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-title {
  margin: 0;
  font-size: 18px;
  color: #333;
}
.spacer {
  flex: 1;
}
.deny-alert {
  margin-top: 24px;
}
.empty-wrap { padding: 40px 0; display: flex; justify-content: center; color: #999; font-size: 13px; }

.desktop-table { display: none; }
.mobile-cards { display: flex; flex-direction: column; gap: 8px; }
.store-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.stc-head { display: flex; justify-content: space-between; align-items: center; }
.stc-name { font-size: 15px; font-weight: 600; color: #333; }
.stc-expand { cursor: pointer; padding: 2px; display: inline-flex; align-items: center; }
.stc-meta { font-size: 13px; color: #666; margin-top: 6px; }
.stc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
  flex-wrap: wrap;
  gap: 8px;
}
.stc-time { font-size: 12px; color: #999; }
.stc-actions { display: flex; gap: 8px; }

.mobile-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.pager-info { font-size: 13px; color: #999; }

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
@media (min-width: 768px) {
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
  .page-title { font-size: 20px; }
}
</style>
