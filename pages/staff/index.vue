<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">店员管理</h2>
      <div class="spacer" />
      <n-button v-if="canManage" type="primary" @click="openNew">+ 新增店员</n-button>
    </div>

    <n-alert v-if="!canManage" type="warning" title="无权限" class="deny-alert">
      您没有权限访问该页面。
    </n-alert>

    <template v-else>
      <n-tabs v-model:value="activeTab" type="line">
        <n-tab-pane name="members" tab="成员管理">
      <n-spin :show="loading">
        <div v-if="!users.length && !loading" class="empty-wrap">暂无店员</div>

        <!-- Desktop table -->
        <div v-if="users.length" class="desktop-table">
          <n-data-table
            :columns="columns"
            :data="users"
            :bordered="false"
            size="small"
            :scroll-x="760"
            :remote="true"
            :pagination="{
              page: userPage,
              pageSize: userPageSize,
              itemCount: userTotal,
              showSizePicker: false,
            }"
            @update:page="onUserPageChange"
          />
        </div>

        <!-- Mobile cards -->
        <div v-if="users.length" class="mobile-cards">
          <div v-for="u in users" :key="u.id" class="staff-card">
            <div class="sc-head">
              <span class="sc-name">{{ u.name }}</span>
              <div class="sc-tail">
                <n-tag v-if="u.role === 'admin'" size="small" :color="{ color: '#169C91', textColor: '#fff', borderColor: '#169C91' }">管理员</n-tag>
                <n-tag v-else-if="u.role === 'manager'" size="small" :color="{ color: '#FFB740', textColor: '#fff', borderColor: '#FFB740' }">店长</n-tag>
                <n-tag v-else size="small" type="default">店员</n-tag>
                <n-tag v-if="u.status === 'inactive'" size="small" type="warning">已停用</n-tag>
                <span class="sc-expand" @click="toggleExpand(u.id)">
                  <n-icon :component="expandedMap[u.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                </span>
              </div>
            </div>
            <template v-if="expandedMap[u.id]">
              <div class="sc-meta">{{ u.phone }}</div>
              <div class="sc-foot">
                <span class="sc-time">{{ fmtDateTime(u.created_at) }}</span>
                <div class="sc-actions">
                  <n-button size="small" quaternary type="primary" @click="openEdit(u)">编辑</n-button>
                  <n-button v-if="u.id !== authStore.user.value?.id" size="small" quaternary type="error" @click="onDelete(u)">删除</n-button>
                </div>
              </div>
            </template>
          </div>
          <div class="mobile-pager">
            <n-button size="small" :disabled="userPage <= 1" @click="onUserPageChange(userPage - 1)">上一页</n-button>
            <span class="pager-info">第 {{ userPage }} 页 / 共 {{ userTotalPages }} 页</span>
            <n-button size="small" :disabled="userPage >= userTotalPages" @click="onUserPageChange(userPage + 1)">下一页</n-button>
          </div>
        </div>
      </n-spin>
        </n-tab-pane>
        <n-tab-pane name="performance" tab="业绩考核">
          <div class="perf-toolbar">
            <n-date-picker v-model:value="perfRange" type="daterange" clearable size="small" class="perf-date" />
            <div class="perf-btns">
              <n-button size="small" :type="perfQuick === 'today' ? 'primary' : 'default'" @click="setPerfQuick('today')">今天</n-button>
              <n-button size="small" :type="perfQuick === 'lastMonth' ? 'primary' : 'default'" @click="setPerfQuick('lastMonth')">上月</n-button>
              <n-button size="small" :type="perfQuick === 'month' ? 'primary' : 'default'" @click="setPerfQuick('month')">本月</n-button>
            </div>
          </div>
          <n-spin :show="perfLoading">
            <div v-if="!perfItems.length && !perfLoading" class="empty-wrap">该时段暂无业绩</div>
            <div v-if="perfItems.length" class="desktop-table">
              <n-data-table
                :columns="perfColumns"
                :data="perfItems"
                :bordered="false"
                size="small"
                :scroll-x="600"
              />
            </div>
            <div v-if="perfItems.length" class="mobile-cards">
              <div v-for="(p, i) in perfItems" :key="p.user_id" class="staff-card">
                <div class="sc-head">
                  <span class="sc-name"><span class="rank-no" :class="{ top3: i < 3 }">{{ i + 1 }}</span> {{ p.name }}</span>
                  <div class="sc-tail">
                    <n-tag v-if="p.role === 'admin'" size="small" :color="{ color: '#169C91', textColor: '#fff', borderColor: '#169C91' }">管理员</n-tag>
                    <n-tag v-else-if="p.role === 'manager'" size="small" :color="{ color: '#FFB740', textColor: '#fff', borderColor: '#FFB740' }">店长</n-tag>
                    <n-tag v-else size="small" type="default">店员</n-tag>
                  </div>
                </div>
                <div class="sc-meta">销售 {{ moneyWithSymbol(p.net_sales) }}｜揽储 {{ moneyWithSymbol(p.recharge) }}｜服务 {{ moneyWithSymbol(p.service) }}</div>
              </div>
            </div>
          </n-spin>
        </n-tab-pane>
      </n-tabs>

      <n-modal v-model:show="formVisible" preset="card" :title="formMode === 'new' ? '新增店员' : '编辑店员'" :style="modalStyle" :bordered="false" :mask-closable="!formSaving">
        <n-form ref="formRef" :model="formModel" :rules="formRules" label-placement="top">
          <n-grid :cols="isMobile ? 1 : 2" :x-gap="16" :y-gap="12">
            <n-form-item-gi label="姓名" path="name">
              <n-input v-model:value="formModel.name" placeholder="请输入姓名" />
            </n-form-item-gi>
            <n-form-item-gi label="手机号" path="phone">
              <n-input v-model:value="formModel.phone" placeholder="请输入手机号" maxlength="11" />
            </n-form-item-gi>
            <n-form-item-gi label="密码" path="password">
              <n-input v-model:value="formModel.password" type="password" show-password-on="click" :placeholder="formMode === 'new' ? '请输入密码' : '留空则不修改'" />
            </n-form-item-gi>
            <n-form-item-gi v-if="!isSelfEdit" label="角色" path="role">
              <n-select v-model:value="formModel.role" :options="roleOptions" />
            </n-form-item-gi>
            <n-form-item-gi v-if="formMode === 'edit' && !isSelfEdit" label="账号状态" path="status" :span="2">
              <n-switch
                v-model:value="formModel.statusActive"
              >
                <template #checked>启用</template>
                <template #unchecked>停用</template>
              </n-switch>
            </n-form-item-gi>
          </n-grid>
          <div class="form-actions">
            <n-button @click="formVisible = false">取消</n-button>
            <n-button type="primary" :loading="formSaving" :disabled="formSaving" @click="saveUser">保存</n-button>
          </div>
        </n-form>
      </n-modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NTag, NButton, type DataTableColumns, type FormInst, type FormRules } from 'naive-ui'
import { ChevronDownOutline, ChevronUpOutline } from '@vicons/ionicons5'

definePageMeta({ layout: 'default' })

const authStore = useAuthStore()
const { isMobile } = useIsMobile()
const { storeId } = useStoreId()
const toast = useToast()

const expandedMap = ref<Record<number, boolean>>({})
function toggleExpand(id: number) {
  expandedMap.value = { ...expandedMap.value, [id]: !expandedMap.value[id] }
}

const canManage = computed(() => {
  const r = authStore.userRole.value
  return r === 'admin' || r === 'manager'
})
const isAdminUser = computed(() => authStore.userRole.value === 'admin')
const loading = ref(false)
const users = ref<any[]>([])
const userPage = ref(1)
const userPageSize = 20
const userTotal = ref(0)
const userTotalPages = computed(() => Math.max(1, Math.ceil(userTotal.value / userPageSize)))
function onUserPageChange(page: number) {
  userPage.value = page
  loadUsers()
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '-'
  return s.length >= 16 ? s.slice(0, 16) : s
}

const roleOptions = computed(() => {
  const opts = [{ label: '店员', value: 'clerk' }]
  if (isAdminUser.value) {
    opts.push({ label: '店长', value: 'manager' })
    opts.push({ label: '管理员', value: 'admin' })
  }
  return opts
})

function roleTag(role: string) {
  if (role === 'admin') return h(NTag, { size: 'small', color: { color: '#169C91', textColor: '#fff', borderColor: '#169C91' } }, { default: () => '管理员' })
  if (role === 'manager') return h(NTag, { size: 'small', color: { color: '#FFB740', textColor: '#fff', borderColor: '#FFB740' } }, { default: () => '店长' })
  return h(NTag, { size: 'small', type: 'default' }, { default: () => '店员' })
}
function statusTag(status: string) {
  if (status === 'inactive') return h(NTag, { size: 'small', type: 'warning' }, { default: () => '已停用' })
  return h(NTag, { size: 'small', type: 'success' }, { default: () => '启用中' })
}

const columns = computed<DataTableColumns<any>>(() => [
  { title: '姓名', key: 'name', width: 120 },
  { title: '手机号', key: 'phone', width: 140 },
  { title: '角色', key: 'role', width: 100, render: (r) => roleTag(r.role) },
  { title: '状态', key: 'status', width: 100, render: (r) => statusTag(r.status || 'active') },
  { title: '创建时间', key: 'created_at', width: 160, render: (r) => fmtDateTime(r.created_at) },
  {
    title: '操作', key: 'actions', width: 150, fixed: 'right',
    render: (r) => {
      const buttons = [
        h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(r) }, { default: () => '编辑' }),
      ]
      if (r.id !== authStore.user.value?.id) {
        buttons.push(
          h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => onDelete(r) }, { default: () => '删除' })
        )
      }
      return buttons
    },
  },
])

async function loadUsers() {
  loading.value = true
  try {
    const data = await useApiFetch<{ items: any[]; total: number }>('/api/users', {
      query: { store_id: storeId.value, page: userPage.value, pageSize: userPageSize },
    })
    users.value = data?.items || []
    if (data && data.total >= 0) userTotal.value = data.total
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    loading.value = false
  }
}

// performance
const activeTab = ref<'members' | 'performance'>('members')
const perfLoading = ref(false)
const perfItems = ref<any[]>([])
function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function monthStart(): number {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const perfRange = ref<[number, number] | null>([monthStart(), Date.now()])
const perfQuick = ref<'today' | 'lastMonth' | 'month' | null>('month')
let quickSetting = false
function lastMonthRange(): [number, number] {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() - 1)
  return [d.getTime(), monthStart() - 1]
}
function setPerfQuick(kind: 'today' | 'lastMonth' | 'month') {
  const now = Date.now()
  quickSetting = true
  perfQuick.value = kind
  perfRange.value = kind === 'today' ? [startOfDay(now), now] : kind === 'lastMonth' ? lastMonthRange() : [monthStart(), now]
}
function fmtDay(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const perfColumns = computed<DataTableColumns<any>>(() => [
  { title: '排名', key: 'rank', width: 70, render: (_r, i) => (i ?? 0) + 1 },
  { title: '姓名', key: 'name', width: 110, render: (r) => `${r.name || '-'}` },
  {
    title: '销售业绩', key: 'net_sales', width: 130, sorter: (a, b) => a.net_sales - b.net_sales,
    render: (r) => moneyWithSymbol(r.net_sales),
  },
  {
    title: '揽储业绩', key: 'recharge', width: 120, sorter: (a, b) => a.recharge - b.recharge,
    render: (r) => moneyWithSymbol(r.recharge),
  },
  {
    title: '服务业绩', key: 'service', width: 120, sorter: (a, b) => a.service - b.service,
    render: (r) => moneyWithSymbol(r.service),
  },
])
async function loadPerf() {
  if (!canManage.value || !storeId.value) return
  perfLoading.value = true
  try {
    const params: Record<string, any> = { store_id: storeId.value }
    if (perfRange.value) {
      params.date_from = fmtDay(perfRange.value[0])
      params.date_to = fmtDay(perfRange.value[1])
    }
    const data = await useApiFetch<{ items: any[]; excluded_null: number }>('/api/staff/performance', { query: params })
    perfItems.value = [...(data?.items || [])].sort((a, b) => (b.net_sales || 0) - (a.net_sales || 0))
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    perfLoading.value = false
  }
}
watch(activeTab, (v) => {
  if (v === 'performance') loadPerf()
})
watch(perfRange, () => {
  if (quickSetting) quickSetting = false
  else perfQuick.value = null
  if (activeTab.value === 'performance') loadPerf()
})

// form
const formVisible = ref(false)
const formMode = ref<'new' | 'edit'>('new')
const formSaving = ref(false)
const formRef = ref<FormInst | null>(null)
const formModel = reactive<{ id?: number; name: string; phone: string; password: string; role: string; statusActive: boolean }>({
  name: '', phone: '', password: '', role: 'clerk', statusActive: true,
})
const isSelfEdit = computed(() => formMode.value === 'edit' && formModel.id === authStore.user.value?.id)
const formRules = computed<FormRules>(() => ({
  name: { required: true, message: '请输入姓名', trigger: ['blur', 'input'] },
  phone: { required: true, message: '请输入手机号', trigger: ['blur', 'input'] },
  password: formMode.value === 'new'
    ? { required: true, message: '请输入密码', trigger: ['blur', 'input'], min: 6 }
    : {
        trigger: ['blur', 'input'],
        validator: (_rule: any, value: string) => !value || value.length >= 6,
        message: '密码至少6位',
      },
  role: { required: true, message: '请选择角色', trigger: ['change'] },
}))

const modalStyle = computed(() => (isMobile.value ? { width: '92vw', maxWidth: '92vw' } : { width: '520px', maxWidth: '92vw' }))

function openNew() {
  formMode.value = 'new'
  formModel.id = undefined
  formModel.name = ''
  formModel.phone = ''
  formModel.password = ''
  formModel.role = 'clerk'
  formModel.statusActive = true
  formVisible.value = true
}
function openEdit(row: any) {
  formMode.value = 'edit'
  formModel.id = row.id
  formModel.name = row.name
  formModel.phone = row.phone
  formModel.password = ''
  formModel.role = row.role
  formModel.statusActive = (row.status || 'active') === 'active'
  formVisible.value = true
}

async function saveUser() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  const body: any = {
    name: formModel.name,
    phone: formModel.phone,
  }
  if (formModel.password) body.password = formModel.password
  if (!isSelfEdit.value) {
    body.role = formModel.role
    body.storeId = formModel.role === 'admin' ? null : storeId.value
    if (formMode.value === 'edit') {
      body.status = formModel.statusActive ? 'active' : 'inactive'
    }
  }

  formSaving.value = true
  try {
    if (formMode.value === 'new') {
      await useApiFetch('/api/users', { method: 'POST', body })
    } else {
      await useApiFetch(`/api/users/${formModel.id}`, { method: 'PUT', body })
    }
    toast.success('保存成功')
    formVisible.value = false
    userPage.value = 1
    loadUsers()
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    formSaving.value = false
  }
}

function onDelete(row: any) {
  if (row.id === authStore.user.value?.id) {
    toast.warning('不能删除自己')
    return
  }
  ;(window as any).$dialog?.warning({
    title: '确认删除',
    content: `确定删除店员「${row.name}」吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await useApiFetch(`/api/users/${row.id}`, { method: 'DELETE' })
        toast.success('已删除')
        userPage.value = 1
        loadUsers()
      } catch (e) {
        toast.error(apiErr(e))
      }
    },
  })
}

watch(storeId, () => {
  if (canManage.value) {
    userPage.value = 1
    loadUsers()
    if (activeTab.value === 'performance') loadPerf()
  }
})

onMounted(() => {
  if (canManage.value) loadUsers()
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
.staff-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.sc-head { display: flex; justify-content: space-between; align-items: center; }
.sc-tail { display: flex; align-items: center; gap: 8px; }
.sc-expand { cursor: pointer; padding: 2px; display: inline-flex; align-items: center; }
.sc-name { font-size: 15px; font-weight: 600; color: #333; }
.sc-meta { font-size: 13px; color: #666; margin-top: 6px; }
.sc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
}
.sc-time { font-size: 12px; color: #999; }
.sc-actions { display: flex; gap: 8px; }

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
.perf-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.perf-date { width: 240px; }
.perf-btns { display: flex; gap: 8px; }
@media (max-width: 767px) {
  .perf-toolbar { flex-direction: column; align-items: stretch; }
  .perf-date { width: 100%; }
  .perf-btns { width: 100%; }
  .perf-btns > * { flex: 1; }
}
.rank-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #f0f0f0;
  font-size: 12px;
  color: #999;
  margin-right: 4px;
}
.rank-no.top3 { background: #169C91; color: #fff; }
@media (min-width: 768px) {
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
  .page-title { font-size: 20px; }
}
</style>
