<template>
  <div class="settings-page">
    <n-alert v-if="!canAccess" type="warning" title="无权限" style="margin-top: 24px;">
      您没有权限访问该页面。
    </n-alert>

    <n-alert v-else-if="!storeId && !isAdmin" type="info" style="margin-top: 24px;">
      请先在顶部选择店铺。
    </n-alert>

    <template v-else>
      <n-spin :show="loading">
        <n-tabs v-model:value="activeTab" type="line" animated>
          <!-- 常规 -->
          <n-tab-pane name="general" tab="常规">
            <div class="general-grid">
              <n-card :bordered="false" class="setting-card">
                <template #header>积分规则</template>
                <n-form label-placement="top" :show-require-mark="false">
                  <n-form-item label="消费积分比（每元获积分）" :show-feedback="false">
                    <n-input-number v-model:value="record.points_earn_rate" :min="0" :step="1" :precision="0" style="width:100%" />
                  </n-form-item>
                    <n-form-item label="积分抵现（每 N 积分抵 M 元）" :show-feedback="false" class="points-redeem-item">
                      <div class="redeem-row">
                        <n-input-number v-model:value="record.points_redeem_amount" :min="1" :step="10" :precision="0" style="width:90px" />
                        <span class="redeem-op">积分抵</span>
                        <n-input-number v-model:value="record.points_redeem_value" :min="1" :step="1" :precision="0" style="width:90px" />
                        <span class="redeem-op">元</span>
                      </div>
                    </n-form-item>
                    <div class="hint">满 N 积分起兑，需为 N 的整数倍</div>
                </n-form>
              </n-card>

              <n-card :bordered="false" class="setting-card">
                <template #header>会员折扣</template>
                <n-form label-placement="top" :show-require-mark="false">
                  <n-form-item label="VIP 折扣率" :show-feedback="false">
                    <n-input-number v-model:value="record.vip_discount_rate" :min="0" :max="1" :step="0.05" :precision="2" style="width:100%" />
                  </n-form-item>
                  <div class="hint">0.9 = 九折，1 = 不打折</div>
                </n-form>
              </n-card>

              <n-card :bordered="false" class="setting-card">
                <template #header>营业设置</template>
                <n-form label-placement="top" :show-require-mark="false">
                  <n-form-item label="默认库存预警值" :show-feedback="false">
                    <n-input-number v-model:value="record.default_stock_alert" :min="0" :step="1" :precision="0" :show-button="false" style="width:100%" />
                  </n-form-item>
                  <div class="hint">所有时间均按北京时间记录与展示</div>
                </n-form>
              </n-card>

              <n-card :bordered="false" class="setting-card">
                <template #header>支付开关</template>
                <div class="switch-list">
                  <div class="switch-row">
                    <span class="switch-label">余额支付</span>
                    <n-switch v-model:value="record.balance_payment_enabled" :checked-value="1" :unchecked-value="0" />
                  </div>
                  <div class="switch-row">
                    <span class="switch-label">积分抵现</span>
                    <n-switch v-model:value="record.points_payment_enabled" :checked-value="1" :unchecked-value="0" />
                  </div>
                </div>
              </n-card>
            </div>

            <div class="save-row">
              <n-button type="primary" size="large" :loading="saving" :disabled="saving" @click="saveSettings">保存</n-button>
            </div>
          </n-tab-pane>

          <!-- 计次项目 -->
          <n-tab-pane name="count" tab="计次项目">
            <div class="card-list">
              <n-card :bordered="false" class="setting-card">
                <template #header>
                  <div class="card-header-with-action">
                    <span>计次项目管理</span>
                    <n-button size="small" type="primary" @click="openCountNew">新增</n-button>
                  </div>
                </template>
                <n-spin :show="countLoading">
                  <div v-if="!countServices.length && !countLoading" class="empty-wrap">暂无计次项目</div>
                  <!-- Desktop table -->
                  <div v-if="countServices.length" class="desktop-table">
                    <n-data-table
                      :columns="countServiceColumns"
                      :data="countServices"
                      :bordered="false"
                      size="small"
                      :scroll-x="640"
                      :pagination="countPagination"
                      remote
                      @update:page="onCountPageChange"
                    />
                  </div>
                  <!-- Mobile cards -->
                  <div v-if="countServices.length" class="mobile-cards">
                    <div v-for="cs in countServices" :key="cs.id" class="count-service-card">
                      <div class="csc-head">
                        <span class="csc-name">{{ cs.name }}<span v-if="cs.status === 'inactive'" class="csc-badge">已停用</span></span>
                        <div class="csc-tail">
                          <span class="csc-price">¥{{ fmtMoney(cs.price) }}</span>
                          <span class="csc-expand" @click="toggleExpand(cs.id)">
                            <n-icon :component="expandedMap[cs.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                          </span>
                        </div>
                      </div>
                      <template v-if="expandedMap[cs.id]">
                        <div class="csc-meta">
                          <span>共 {{ cs.total_count }} 次</span>
                          <span v-if="cs.validity_months">{{ cs.validity_months }} 个月有效</span>
                          <span v-else>永久有效</span>
                        </div>
                        <div class="csc-actions">
                          <n-button v-if="cs.status !== 'inactive'" size="small" quaternary type="primary" @click="openCountEdit(cs)">编辑</n-button>
                          <n-button v-if="cs.status === 'inactive'" size="small" quaternary type="primary" @click="onToggleCountStatus(cs, 'active')">启用</n-button>
                          <n-button v-else size="small" quaternary type="warning" @click="onToggleCountStatus(cs, 'inactive')">停用</n-button>
                          <n-button size="small" quaternary type="error" @click="onDeleteCount(cs)">删除</n-button>
                        </div>
                      </template>
                    </div>
                    <div class="mobile-pager">
                      <n-button size="small" :disabled="countPage <= 1" @click="onCountPageChange(countPage - 1)">上一页</n-button>
                      <span class="pager-info">第 {{ countPage }} 页 / 共 {{ countTotalPages }} 页</span>
                      <n-button size="small" :disabled="countPage >= countTotalPages" @click="onCountPageChange(countPage + 1)">下一页</n-button>
                    </div>
                  </div>
                </n-spin>
              </n-card>
            </div>
          </n-tab-pane>

          <!-- 短信（全局共享，仅 admin，不随店铺切换） -->
          <n-tab-pane v-if="isAdmin" name="sms" tab="短信">
            <div class="card-list">
              <n-alert v-if="!smsLoaded" type="info" style="margin-bottom: 12px;">短信配置为全局共享，所有店铺共用同一套。</n-alert>
              <!-- 服务商配置 -->
              <n-card :bordered="false" class="setting-card">
                <template #header>服务商配置（全局共享）</template>
                <n-form label-placement="top" :show-require-mark="false">
                  <n-grid :cols="isMobile ? 1 : 2" :x-gap="16" :y-gap="12">
                    <n-form-item-gi label="服务商">
                      <div class="provider-field">
                        <n-select v-model:value="smsRecord.sms_provider" :options="providerOptions" clearable placeholder="选择服务商" />
                        <div v-if="selectedProviderRegLink" class="provider-tip">
                          还没有开通？
                          <a :href="selectedProviderRegLink.url" target="_blank" rel="noopener">前往开通{{ selectedProviderRegLink.label }}短信服务</a>
                        </div>
                      </div>
                    </n-form-item-gi>
                    <n-form-item-gi label="短信签名">
                      <n-input v-model:value="smsRecord.sms_sign_name" placeholder="如：小旺铺" />
                    </n-form-item-gi>
                    <n-form-item-gi label="AccessKey">
                      <n-input v-model:value="smsRecord.sms_access_key" placeholder="AccessKey" />
                    </n-form-item-gi>
                    <n-form-item-gi label="Secret">
                      <n-input v-model:value="smsRecord.sms_secret" type="password" show-password-on="click" placeholder="Secret" />
                    </n-form-item-gi>
                    <n-form-item-gi v-if="smsRecord.sms_provider === 'tencent'" label="SDK AppId">
                      <n-input v-model:value="smsRecord.sms_sdk_app_id" placeholder="腾讯云短信应用 SDKAppID" />
                    </n-form-item-gi>
                    <n-form-item-gi v-if="smsRecord.sms_provider === 'tencent'" label="地域 (Region)">
                      <n-input v-model:value="smsRecord.sms_region" placeholder="如 ap-guangzhou（默认）" />
                    </n-form-item-gi>
                  </n-grid>
                </n-form>
              </n-card>

              <!-- 会员通知 -->
              <n-card :bordered="false" class="setting-card">
                <template #header>会员通知</template>
                <div v-for="n in notifyItems" :key="n.key" class="notify-row">
                  <div class="notify-left">
                    <n-switch v-model:value="smsRecord[n.enabled]" :checked-value="1" :unchecked-value="0" />
                    <span class="notify-label">{{ n.label }}</span>
                  </div>
                  <n-input v-model:value="smsRecord[n.template]" placeholder="模板 ID" class="notify-input" />
                </div>
              </n-card>

              <!-- 验证码登录 -->
              <n-card :bordered="false" class="setting-card">
                <template #header>验证码登录</template>
                <div class="notify-row">
                  <div class="notify-left">
                    <n-switch v-model:value="smsRecord.sms_code_login" :checked-value="1" :unchecked-value="0" />
                    <span class="notify-label">启用验证码登录</span>
                  </div>
                  <n-input v-model:value="smsRecord.sms_template_code" placeholder="验证码模板 ID" class="notify-input" />
                </div>
                <n-form label-placement="top" :show-require-mark="false" style="margin-top: 12px;">
                  <n-grid :cols="isMobile ? 1 : 2" :x-gap="16" :y-gap="12">
                    <n-form-item-gi label="每日发送上限">
                      <n-input-number v-model:value="smsRecord.sms_code_daily_limit" :min="0" :step="1" :precision="0" style="width:100%" />
                    </n-form-item-gi>
                    <n-form-item-gi label="验证码有效时长（分钟）">
                      <n-input-number v-model:value="smsRecord.sms_code_expiry_min" :min="1" :step="1" :precision="0" style="width:100%" />
                    </n-form-item-gi>
                  </n-grid>
                </n-form>
              </n-card>

              <!-- 保存按钮 -->
              <div class="save-row">
                <n-button type="primary" size="large" :loading="smsSaving" :disabled="smsSaving" @click="saveSmsSettings">保存</n-button>
                <n-button size="large" :loading="testSmsLoading" @click="openTestSms">测试接口</n-button>
              </div>
            </div>
          </n-tab-pane>

          <!-- 数据备份 -->
          <n-tab-pane v-if="isAdmin" name="backup" tab="数据备份">
            <div class="card-list">
              <n-card :bordered="false" class="setting-card">
                <template #header>数据库备份与恢复</template>
                <p class="backup-hint">导出当前数据库为 SQL 文件，可在需要时导入恢复。</p>
                <p class="backup-danger">导入会清空并覆盖当前所有数据（商品、会员、订单、设置等），且不可恢复。导入前建议先导出备份。</p>
                <div class="backup-row">
                  <n-button :loading="exporting" :disabled="exporting" @click="openExportModal">导出数据库</n-button>
                  <n-button type="error" @click="triggerImport">导入数据库</n-button>
                  <input ref="importInput" type="file" accept=".sql,.gz,.sql.gz,text/sql,application/sql,application/gzip" style="display:none" @change="onImportFile" />
                </div>
              </n-card>
            </div>
          </n-tab-pane>
        </n-tabs>
      </n-spin>
    </template>

    <!-- count service form -->
    <n-modal v-model:show="countFormVisible" preset="card" :title="countFormMode === 'new' ? '新增计次项目' : '编辑计次项目'" :style="modalStyle" :bordered="false" :mask-closable="!countSaving">
      <n-form ref="countFormRef" :model="countFormModel" :rules="countFormRules" label-placement="top">
        <n-form-item label="项目名称" path="name">
          <n-input v-model:value="countFormModel.name" placeholder="请输入项目名称" />
        </n-form-item>
        <n-grid :cols="isMobile ? 1 : 3" :x-gap="16" :y-gap="12">
          <n-form-item-gi label="总次数" path="total_count">
            <n-input-number v-model:value="countFormModel.total_count" :min="1" :step="1" :precision="0" style="width:100%" />
          </n-form-item-gi>
          <n-form-item-gi label="价格" path="price">
            <n-input-number v-model:value="countFormModel.price" :min="0" :step="10" :precision="2" :show-button="false" style="width:100%" />
          </n-form-item-gi>
          <n-form-item-gi label="有效期（月）">
            <n-input-number v-model:value="countFormModel.validity_months" :min="1" :step="1" :precision="0" clearable placeholder="留空=永久" style="width:100%" />
          </n-form-item-gi>
        </n-grid>
        <div class="form-actions">
          <n-button @click="countFormVisible = false">取消</n-button>
          <n-button type="primary" :loading="countSaving" :disabled="countSaving" @click="saveCountService">保存</n-button>
        </div>
      </n-form>
    </n-modal>

    <n-modal v-model:show="testSmsVisible" preset="card" title="测试短信接口" :style="modalStyle" :bordered="false" :mask-closable="!testSmsLoading">
      <n-form label-placement="top">
        <n-form-item label="测试手机号">
          <n-input v-model:value="testPhone" :disabled="testSmsLoading" placeholder="请输入接收测试短信的手机号" />
        </n-form-item>
        <p class="backup-hint">将用<strong>当前表单配置</strong> + <strong>验证码模板</strong>发送一条真实短信，请先确认配置无误。</p>
        <div class="form-actions">
          <n-button @click="testSmsVisible = false">取消</n-button>
          <n-button type="primary" :loading="testSmsLoading" @click="runTestSms">发送测试</n-button>
        </div>
      </n-form>
    </n-modal>

    <n-modal v-model:show="importModalVisible" preset="card" title="导入数据库" :style="modalStyle" :bordered="false" :mask-closable="false" :closable="importPhase !== 'doing'">
      <div v-if="importPhase === 'confirm'" class="import-confirm">
        <div class="import-danger">将清空并覆盖当前所有数据（商品、会员、订单、设置等），操作不可恢复。</div>
        <div class="import-file-card">
          <div class="import-file-label">待导入文件</div>
          <div class="import-file-name">{{ importFileName }}</div>
          <div class="import-file-size">{{ importFileSize }} · 确认后立即覆盖</div>
        </div>
        <div v-if="importFileMB > 5" class="import-tip">文件较大（{{ importFileSize }}），导入可能需要几分钟，请勿关闭页面。</div>
        <div class="import-tip">如尚未备份当前数据，请先取消并导出备份。</div>
        <div class="form-actions">
          <n-button @click="importModalVisible = false">取消</n-button>
          <n-button type="error" @click="confirmImport">确认导入并覆盖</n-button>
        </div>
      </div>
      <div v-else-if="importPhase === 'doing'" class="import-doing">
        <n-spin size="large" />
        <div class="import-doing-text">{{ importStageText || '正在导入并覆盖数据库，请稍候…' }}</div>
      </div>
      <n-result v-else status="success" title="导入成功" class="import-success">
        <div class="import-success-body">
          <div class="import-success-main">数据库已覆盖，当前登录已失效</div>
          <div class="import-success-sub">请使用新数据库中的账号重新登录</div>
        </div>
        <template #footer>
          <n-button type="primary" size="large" class="import-success-btn" @click="goLogin">前往登录</n-button>
        </template>
      </n-result>
    </n-modal>

    <n-modal v-model:show="exportModalVisible" preset="card" title="导出数据库" :style="modalStyle" :bordered="false" :mask-closable="!exporting" :closable="!exporting">
      <div class="export-doing">
        <n-progress type="line" :percentage="exportPercent" :show-indicator="true" />
        <div class="export-stage">{{ exportStageText || '准备导出…' }}</div>
      </div>
      <div class="form-actions">
        <n-button :disabled="exporting" @click="exportModalVisible = false">取消</n-button>
        <n-button type="primary" :loading="exporting" :disabled="exporting" @click="startExport">开始导出</n-button>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, type DataTableColumns, type FormInst, type FormRules } from 'naive-ui'
import { ChevronDownOutline, ChevronUpOutline } from '@vicons/ionicons5'
import type { CountService, SmsSettings, StoreSettings } from '~/types'

definePageMeta({ layout: 'default' })

const authStore = useAuthStore()
const { isMobile } = useIsMobile()
const { storeId } = useStoreId()
const toast = useToast()

const expandedMap = ref<Record<number, boolean>>({})
function toggleExpand(id: number) {
  expandedMap.value = { ...expandedMap.value, [id]: !expandedMap.value[id] }
}

const canAccess = computed(() => {
  const r = authStore.userRole.value
  return r === 'admin' || r === 'manager'
})
const isAdmin = computed(() => authStore.userRole.value === 'admin')

const fmtMoney = formatMoney

const activeTab = ref<'general' | 'count' | 'sms' | 'backup'>('general')
const loading = ref(false)
const saving = ref(false)

const providerOptions = [
  { label: '阿里云', value: 'aliyun', regUrl: 'https://www.aliyun.com/product/sms?userCode=6ab70oiw' },
  { label: '腾讯云', value: 'tencent', regUrl: 'https://curl.qcloud.com/LN7KlIdx' },
]

const selectedProviderRegLink = computed(() => {
  const p = providerOptions.find(o => o.value === smsRecord.sms_provider)
  return p?.regUrl ? { label: p.label, url: p.regUrl } : null
})

const notifyItems = [
  { key: 'balance', label: '余额变动通知', enabled: 'sms_enabled_balance' as const, template: 'sms_template_balance' as const },
  { key: 'count', label: '计次扣减通知', enabled: 'sms_enabled_count' as const, template: 'sms_template_count' as const },
  { key: 'points', label: '积分变动通知', enabled: 'sms_enabled_points' as const, template: 'sms_template_points' as const },
]

const DEFAULT_SETTINGS: StoreSettings = {
  store_id: 0,
  vip_discount_rate: 1,
  points_earn_rate: 1,
  points_redeem_amount: 100,
  points_redeem_value: 1,
  balance_payment_enabled: 1,
  points_payment_enabled: 1,
  default_stock_alert: 10,
}

const record = reactive<StoreSettings>({ ...DEFAULT_SETTINGS })

async function loadSettings() {
  if (!storeId.value) return
  loading.value = true
  try {
    const data = await useApiFetch<StoreSettings>('/api/settings', { query: { store_id: storeId.value } })
    Object.assign(record, DEFAULT_SETTINGS, data || {})
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!storeId.value) return
  saving.value = true
  try {
    const body = { ...record, store_id: storeId.value }
    const data = await useApiFetch<StoreSettings>('/api/settings', { method: 'PUT', body })
    Object.assign(record, DEFAULT_SETTINGS, data || {})
    toast.success('保存成功')
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    saving.value = false
  }
}

const testSmsVisible = ref(false)
const testPhone = ref('')
const testSmsLoading = ref(false)

const DEFAULT_SMS: SmsSettings = {
  id: 1,
  sms_provider: null,
  sms_access_key: null,
  sms_secret: null,
  sms_sign_name: null,
  sms_sdk_app_id: null,
  sms_region: null,
  sms_enabled_balance: 0,
  sms_template_balance: null,
  sms_enabled_count: 0,
  sms_template_count: null,
  sms_enabled_points: 0,
  sms_template_points: null,
  sms_code_login: 0,
  sms_template_code: null,
  sms_code_daily_limit: 10,
  sms_code_expiry_min: 5,
}

const smsRecord = reactive<SmsSettings>({ ...DEFAULT_SMS })
const smsSaving = ref(false)
const smsLoaded = ref(false)

async function loadSmsSettings() {
  if (!isAdmin.value || smsLoaded.value) return
  try {
    const data = await useApiFetch<SmsSettings>('/api/settings/sms')
    Object.assign(smsRecord, DEFAULT_SMS, data || {})
    smsLoaded.value = true
  } catch (e) {
    toast.error(apiErr(e))
  }
}

async function saveSmsSettings() {
  smsSaving.value = true
  try {
    const data = await useApiFetch<SmsSettings>('/api/settings/sms', { method: 'PUT', body: { ...smsRecord } })
    Object.assign(smsRecord, DEFAULT_SMS, data || {})
    smsLoaded.value = true
    toast.success('保存成功，全店铺生效')
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    smsSaving.value = false
  }
}

function openTestSms() {
  testPhone.value = ''
  testSmsVisible.value = true
}

async function runTestSms() {
  if (!/^1\d{10}$/.test(testPhone.value)) { toast.error('手机号格式不正确'); return }
  if (!smsRecord.sms_provider || !smsRecord.sms_access_key || !smsRecord.sms_secret || !smsRecord.sms_sign_name || !smsRecord.sms_template_code) {
    toast.error('请先填写服务商 / AccessKey / Secret / 签名 / 验证码模板')
    return
  }
  testSmsLoading.value = true
  try {
    const res = await useApiFetch<{ success: boolean; error?: string; code?: string }>(
      '/api/settings/test-sms',
      { method: 'POST', body: { ...smsRecord, phone: testPhone.value } },
    )
    if (res.success) toast.success('测试短信发送成功，请查收')
    else toast.error(res.error || '发送失败')
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    testSmsLoading.value = false
  }
}
const countServices = ref<CountService[]>([])
const countLoading = ref(false)
const countPage = ref(1)
const countPageSize = 20
const countTotal = ref(0)
const countTotalPages = computed(() => Math.max(1, Math.ceil(countTotal.value / countPageSize)))
const countPagination = computed(() => ({
  page: countPage.value,
  pageSize: countPageSize,
  itemCount: countTotal.value,
  showSizePicker: false,
}))
function onCountPageChange(page: number) {
  countPage.value = page
  loadCountServices()
}
const countServiceColumns = computed<DataTableColumns<CountService>>(() => [
  { title: '项目名称', key: 'name', width: 180 },
  { title: '总次数', key: 'total_count', width: 90 },
  { title: '价格', key: 'price', width: 110, render: (r) => `¥${fmtMoney(r.price)}` },
  { title: '有效期', key: 'validity_months', width: 100, render: (r) => (r.validity_months ? `${r.validity_months} 个月` : '永久') },
  { title: '状态', key: 'status', width: 80, render: (r) => (r.status === 'inactive' ? '已停用' : '在售') },
  {
    title: '操作', key: 'actions', width: 180, fixed: 'right',
    render: (r) => r.status === 'inactive'
      ? [
        h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => onToggleCountStatus(r, 'active') }, { default: () => '启用' }),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => onDeleteCount(r) }, { default: () => '删除' }),
      ]
      : [
        h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openCountEdit(r) }, { default: () => '编辑' }),
        h(NButton, { size: 'small', quaternary: true, type: 'warning', onClick: () => onToggleCountStatus(r, 'inactive') }, { default: () => '停用' }),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => onDeleteCount(r) }, { default: () => '删除' }),
      ],
  },
])

async function onToggleCountStatus(row: CountService, status: 'active' | 'inactive') {
  try {
    await useApiFetch(`/api/settings/count-services/${row.id}`, { method: 'PUT', body: { status } })
    toast.success(status === 'active' ? '已启用，可继续售卖' : '已停用，不再对外售卖')
    loadCountServices()
  } catch (e) {
    toast.error(apiErr(e))
  }
}

async function loadCountServices() {
  if (!storeId.value) return
  countLoading.value = true
  try {
    const data = await useApiFetch<{ items: CountService[]; total: number }>('/api/settings/count-services', {
      query: { store_id: storeId.value, page: countPage.value, pageSize: countPageSize },
    })
    countServices.value = data?.items || []
    if (data && data.total >= 0) countTotal.value = data.total
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    countLoading.value = false
  }
}

const countFormVisible = ref(false)
const countFormMode = ref<'new' | 'edit'>('new')
const countSaving = ref(false)
const countFormRef = ref<FormInst | null>(null)
const countFormModel = reactive<{ id?: number; name: string; total_count: number; price: number; validity_months: number | null }>({
  name: '', total_count: 1, price: 0, validity_months: null,
})
const countFormRules: FormRules = {
  name: { required: true, message: '请输入项目名称', trigger: ['blur', 'input'] },
  total_count: { required: true, type: 'number', message: '请输入总次数', trigger: ['blur', 'change'] },
  price: { required: true, type: 'number', message: '请输入价格', trigger: ['blur', 'change'] },
}
const modalStyle = computed(() => (isMobile.value ? { width: '92vw', maxWidth: '92vw' } : { width: '560px', maxWidth: '92vw' }))

function openCountNew() {
  countFormMode.value = 'new'
  countFormModel.id = undefined
  countFormModel.name = ''
  countFormModel.total_count = 1
  countFormModel.price = 0
  countFormModel.validity_months = null
  countFormVisible.value = true
}
function openCountEdit(row: CountService) {
  countFormMode.value = 'edit'
  countFormModel.id = row.id
  countFormModel.name = row.name
  countFormModel.total_count = row.total_count
  countFormModel.price = row.price
  countFormModel.validity_months = row.validity_months
  countFormVisible.value = true
}
async function saveCountService() {
  try {
    await countFormRef.value?.validate()
  } catch {
    return
  }
  if (!storeId.value) return
  countSaving.value = true
  try {
    const body = {
      store_id: storeId.value,
      name: countFormModel.name,
      total_count: countFormModel.total_count,
      price: countFormModel.price,
      validity_months: countFormModel.validity_months ?? null,
    }
    if (countFormMode.value === 'new') {
      await useApiFetch('/api/settings/count-services', { method: 'POST', body })
    } else {
      await useApiFetch(`/api/settings/count-services/${countFormModel.id}`, {
        method: 'PUT',
        body: {
          name: countFormModel.name,
          total_count: countFormModel.total_count,
          price: countFormModel.price,
          validity_months: countFormModel.validity_months ?? null,
        },
      })
    }
    toast.success('保存成功')
    countFormVisible.value = false
    countPage.value = 1
    loadCountServices()
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    countSaving.value = false
  }
}
function onDeleteCount(row: CountService) {
  ;(window as any).$dialog?.warning({
    title: '确认删除',
    content: `确定删除计次项目「${row.name}」吗？有历史分配时将改为停用（保留历史、不可再售卖），无分配时彻底删除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await useApiFetch<{ inactive?: boolean; activeCount?: number; deletedAllocations?: number; nullifiedOrderItems?: number }>(
          `/api/settings/count-services/${row.id}`,
          { method: 'DELETE' }
        )
        if (res?.inactive) {
          toast.success(`已停用（${res.activeCount || 0} 条历史分配已保留，不再对外售卖）`)
        } else {
          const extras: string[] = []
          if (res?.deletedAllocations) extras.push(`清理 ${res.deletedAllocations} 条历史分配`)
          if (res?.nullifiedOrderItems) extras.push(`解除 ${res.nullifiedOrderItems} 条订单引用`)
          toast.success(extras.length ? `已删除（${extras.join('，')}）` : '已删除')
        }
        loadCountServices()
      } catch (e) {
        toast.error(apiErr(e))
      }
    },
  })
}

// backup
const exporting = ref(false)
const exportModalVisible = ref(false)
const exportPercent = ref(0)
const exportStageText = ref('')
const importInput = ref<HTMLInputElement | null>(null)
const importModalVisible = ref(false)
const importPhase = ref<'confirm' | 'doing' | 'success'>('confirm')
const importFile = ref<File | null>(null)
const importFileName = computed(() => importFile.value?.name ?? '')
const importFileSize = computed(() => (importFile.value ? formatFileSize(importFile.value.size) : ''))
const importFileMB = computed(() => (importFile.value ? importFile.value.size / 1048576 : 0))
const importStageText = ref('')

function openExportModal() {
  if (exporting.value) return
  exportPercent.value = 0
  exportStageText.value = ''
  exportModalVisible.value = true
}

async function startExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    exportStageText.value = '正在统计表数据…'
    const info = await useApiFetch<{ generatedAt: string; tables: Array<{ name: string; rows: number }>; totalRows: number; unbackedTables?: string[]; head: string; tail: string }>('/api/backup/export-info')
    const tables = info?.tables || []
    const totalRows = info?.totalRows || 0
    if (info?.unbackedTables?.length) {
      toast.warning(`以下表未纳入备份：${info.unbackedTables.join('、')}，请联系开发处理`)
    }
    const parts: string[] = [info?.head || '']
    let doneRows = 0
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i]
      let offset = 0
      for (;;) {
        exportStageText.value = `正在导出 ${t.name}（${i + 1}/${tables.length}）…`
        const chunk = await useApiFetch<{ name: string; rows: number; total: number; offset: number; done: boolean; sql: string }>('/api/backup/export-table', { query: { table: t.name, offset, limit: 2000 } })
        parts.push(chunk?.sql || '')
        doneRows += chunk?.rows ?? 0
        exportPercent.value = totalRows > 0
          ? Math.min(99, Math.round((doneRows / totalRows) * 100))
          : Math.round(((i + 1) / Math.max(tables.length, 1)) * 100)
        if (chunk?.done) break
        offset += chunk?.rows ?? 0
        if (!chunk?.rows) break
      }
    }
    exportStageText.value = '正在打包下载…'
    parts.push(info?.tail || '')
    await downloadBackup(parts.join(''))
    exportPercent.value = 100
    exportStageText.value = '导出完成'
    toast.success('导出成功')
    exportModalVisible.value = false
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    exporting.value = false
  }
}

async function downloadBackup(sql: string) {
  const date = new Date().toISOString().slice(0, 10)
  if (typeof CompressionStream !== 'undefined') {
    const blob = await new Response(new Blob([sql]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
    triggerBlobDownload(blob, `backup-${date}.sql.gz`)
  } else {
    triggerBlobDownload(new Blob([sql], { type: 'text/sql' }), `backup-${date}.sql`)
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function triggerImport() {
  importInput.value?.click()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function uint8ToBase64(buf: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    const slice = buf.subarray(i, Math.min(i + CHUNK, buf.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as any)
  }
  return btoa(binary)
}

function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importFile.value = file
  importPhase.value = 'confirm'
  importModalVisible.value = true
}

async function confirmImport() {
  const file = importFile.value
  if (!file || importPhase.value === 'doing') return
  importPhase.value = 'doing'
  importStageText.value = '正在读取文件…'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000)
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    if (buf.length === 0) {
      toast.warning('SQL 内容为空')
      importPhase.value = 'confirm'
      return
    }
    importStageText.value = '文件读取完成，正在上传…'
    const data = uint8ToBase64(buf)
    importStageText.value = '已上传，正在解析并写入数据库，请勿关闭…'
    await useApiFetch('/api/backup/import', { method: 'POST', body: { data, filename: file.name }, signal: controller.signal })
    importPhase.value = 'success'
  } catch (e: any) {
    if (e?.name === 'AbortError' || controller.signal.aborted) {
      toast.error('导入超时（超过 10 分钟），请检查数据后重试，大库可改用 wrangler d1 execute 导入')
    } else {
      toast.error(apiErr(e))
    }
    importPhase.value = 'confirm'
  } finally {
    clearTimeout(timer)
    importStageText.value = ''
  }
}

function goLogin() {
  try { authStore.logout() } catch { /* 忽略 */ }
  try {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('stores')
    localStorage.removeItem('currentStoreId')
  } catch { /* 忽略 */ }
  location.replace('/login')
}

watch(storeId, () => {
  if (storeId.value && canAccess.value) {
    Promise.allSettled([loadSettings(), loadCountServices()])
  }
})

watch(activeTab, (val) => {
  if (val === 'count' && canAccess.value && storeId.value) {
    loadCountServices()
  }
  if (val === 'sms' && isAdmin.value) {
    loadSmsSettings()
  }
})

onMounted(() => {
  if (isAdmin.value) {
    if (!storeId.value) activeTab.value = 'sms'
    loadSmsSettings()
  }
  if (canAccess.value && storeId.value) {
    Promise.allSettled([loadSettings(), loadCountServices()])
  }
})
</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.general-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-top: 16px;
}

@media (min-width: 900px) {
  .general-grid {
    grid-template-columns: 1fr 1fr;
  }
}

:deep(.setting-card) {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

:deep(.setting-card .n-card__content) {
  padding-bottom: 18px;
}

.switch-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.switch-label {
  font-size: 14px;
  color: #333;
}

.card-header-with-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.hint {
  font-size: 12px;
  color: #999;
  margin-top: 0;
}

.provider-field {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.provider-tip {
  font-size: 12px;
  color: #999;
  margin-top: 6px;
  line-height: 1.6;
}

.provider-tip a {
  color: #18a058;
}

:deep(.n-form-item-gi.no-feedback) {
  margin-bottom: 0;
}

.backup-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.backup-hint {
  font-size: 13px;
  color: #666;
  margin: 0 0 8px;
}

.backup-danger {
  font-size: 13px;
  color: #d03050;
  margin: 0 0 16px;
}

.import-confirm {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.import-danger {
  color: #d03050;
  font-weight: 600;
  line-height: 1.7;
}

.import-file-card {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.7;
  word-break: break-all;
}

.import-file-label {
  font-size: 12px;
  color: #999;
}

.import-file-name {
  font-weight: 600;
}

.import-file-size {
  font-size: 12px;
  color: #666;
}

.import-tip {
  font-size: 13px;
  color: #666;
  line-height: 1.7;
}

.import-doing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 28px 0;
}

.export-doing {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0 4px;
}

.export-stage {
  font-size: 13px;
  color: #666;
  line-height: 1.7;
}

.import-doing-text {
  font-size: 14px;
  color: #666;
}

.import-success-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  line-height: 1.7;
  margin-top: 4px;
}

.import-success-main {
  font-size: 14px;
  color: #333;
}

.import-success-sub {
  font-size: 13px;
  color: #999;
}

.import-success-btn {
  min-width: 160px;
}

.save-row {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 8px;
}

.notify-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
  flex-wrap: wrap;
}

.notify-row:last-child {
  border-bottom: none;
}

.notify-left {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 200px;
  max-width: 100%;
}

.notify-label {
  font-size: 14px;
  color: #333;
}

.notify-input {
  flex: 1;
  min-width: 160px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.redeem-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.redeem-op {
  color: #666;
  font-size: 13px;
}

:deep(.points-redeem-item) {
  margin-top: 20px;
}

.empty-wrap { padding: 40px 0; display: flex; justify-content: center; color: #999; font-size: 13px; }

.desktop-table { display: none; }
.mobile-cards { display: flex; flex-direction: column; gap: 8px; }
.count-service-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.csc-head { display: flex; justify-content: space-between; align-items: center; }
.csc-tail { display: flex; align-items: center; gap: 8px; }
.csc-expand { cursor: pointer; padding: 2px; display: inline-flex; align-items: center; }
.csc-name { font-size: 15px; font-weight: 600; color: #333; }
.csc-badge { font-size: 11px; font-weight: 400; color: #d03050; border: 1px solid #f3c2cc; border-radius: 4px; padding: 1px 6px; margin-left: 8px; white-space: nowrap; }
.csc-price { color: #169c91; font-weight: 600; }
.csc-meta { display: flex; gap: 12px; margin-top: 6px; font-size: 13px; color: #999; }
.csc-actions { display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #eee; }

.mobile-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.pager-info { font-size: 13px; color: #999; }

@media (min-width: 768px) {
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
}
</style>