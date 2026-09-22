<template>
  <div class="page">
    <div class="page-head">
      <h2 class="page-title">库存流水</h2>
      <span class="back-link" @click="navigateTo('/products')"><span class="back-symbol">«</span>返回商品</span>
    </div>
    <div class="toolbar">
      <n-input v-model:value="searchInput" placeholder="商品名称 / 助记码 / 条码" size="small" class="tb-search" :input-props="{ autocomplete: 'off' }" @keydown.enter="onSearch" />
      <n-select v-model:value="typeFilter" :options="typeOptions" placeholder="类型" clearable size="small" class="tb-type" />
      <n-date-picker v-model:value="dateRange" type="daterange" clearable size="small" class="tb-date" />
      <div class="tb-btns">
        <n-button size="small" type="primary" :loading="loading" @click="onSearch">搜索</n-button>
      </div>
    </div>

    <n-spin :show="loading">
      <div v-if="!logs.length && !loading" class="empty-wrap"><n-empty description="暂无流水" /></div>

      <!-- Desktop table -->
      <div v-if="logs.length" class="desktop-table">
        <n-data-table
          :columns="logColumns"
          :data="logs"
          :bordered="false"
          size="small"
          :pagination="pagination"
          :scroll-x="700"
          remote
          @update:page="onPageChange"
        />
      </div>

      <!-- Mobile cards -->
      <div v-if="logs.length" class="mobile-cards">
        <div v-for="log in logs" :key="log.id" class="log-card">
          <div class="lc-head">
            <div class="lc-head-left">
              <span class="lc-name">{{ log.product_name || '-' }}</span>
              <n-tag :type="logTypeTag(log.type)" size="tiny" :bordered="false" round>{{ log.type }}</n-tag>
            </div>
            <div class="lc-tail">
              <span :class="['lc-change', Number(log.quantity_change) >= 0 ? 'up' : 'down']">
                {{ Number(log.quantity_change) >= 0 ? '+' : '' }}{{ log.quantity_change }}
              </span>
              <span class="lc-expand" @click="toggleExpand(log.id)">
                <n-icon :component="expandedMap[log.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
              </span>
            </div>
          </div>
          <template v-if="expandedMap[log.id]">
            <div class="lc-meta">
              <span class="lc-after">余量 {{ log.stock_after }}</span>
            </div>
            <div class="lc-foot">
              <span class="lc-operator">{{ log.operator_name || '-' }}</span>
              <span class="lc-notes">{{ log.notes || (log.related_order_id ? `#${log.related_order_id}` : '-') }}</span>
              <span class="lc-time">{{ formatTime(log.created_at) }}</span>
            </div>
          </template>
        </div>
        <div class="mobile-pager">
          <n-button size="small" :disabled="currentPage <= 1" @click="onPageChange(currentPage - 1)">上一页</n-button>
          <span class="pager-info">第 {{ currentPage }} 页 / 共 {{ totalPages }} 页</span>
          <n-button size="small" :disabled="currentPage >= totalPages" @click="onPageChange(currentPage + 1)">下一页</n-button>
        </div>
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NTag, type DataTableColumns } from 'naive-ui'
import { ChevronDownOutline, ChevronUpOutline } from '@vicons/ionicons5'

definePageMeta({ layout: 'default' })

const { storeId } = useStoreId()
const toast = useToast()

const expandedMap = ref<Record<number, boolean>>({})
function toggleExpand(id: number) {
  expandedMap.value = { ...expandedMap.value, [id]: !expandedMap.value[id] }
}

const loading = ref(false)
const logs = ref<any[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = 20

const searchInput = ref('')
const typeFilter = ref<string | null>(null)
// 默认近 30 天（与后端默认一致，避免全量历史扫描）
const dateRange = ref<[number, number] | null>([Date.now() - 30 * 86400_000, Date.now()])

const typeOptions = [
  { label: '入库', value: '入库' },
  { label: '出库', value: '出库' },
  { label: '盘点', value: '盘点' },
  { label: '销售', value: '销售' },
  { label: '退货', value: '退货' },
]

const pagination = computed(() => ({
  page: currentPage.value,
  pageSize,
  itemCount: total.value,
  showSizePicker: false,
}))

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function logTypeTag(type: string): any {
  if (type === '入库') return 'success'
  if (type === '出库') return 'default'
  if (type === '盘点') return 'warning'
  if (type === '销售') return 'info'
  if (type === '退货') return 'error'
  return 'default'
}

function formatTime(s: string): string {
  if (!s) return '-'
  return s.slice(5, 16).replace('T', ' ')
}

const logColumns = computed<DataTableColumns<any>>(() => [
  { title: '商品', key: 'product_name', width: 140, render: (r) => r.product_name || '-' },
  { title: '类型', key: 'type', width: 70, render: (r) => h(NTag, { type: logTypeTag(r.type), size: 'tiny', bordered: false }, { default: () => r.type }) },
  { title: '变动', key: 'quantity_change', width: 70, render: (r) => `${Number(r.quantity_change) >= 0 ? '+' : ''}${r.quantity_change}` },
  { title: '余量', key: 'stock_after', width: 70 },
  { title: '操作员', key: 'operator_name', width: 80, render: (r) => r.operator_name || '-' },
  { title: '备注', key: 'notes', width: 140, render: (r) => r.notes || (r.related_order_id ? `#${r.related_order_id}` : '-') },
  { title: '时间', key: 'created_at', width: 140, render: (r) => formatTime(r.created_at) },
])

async function loadLogs() {
  if (!storeId.value) return
  loading.value = true
  try {
    const params: Record<string, any> = {
      store_id: storeId.value,
      page: currentPage.value,
      pageSize,
    }
    if (searchInput.value.trim()) params.search = searchInput.value.trim()
    if (typeFilter.value) params.type = typeFilter.value
    if (dateRange.value) {
      const fmt = (t: number) => {
        const d = new Date(t)
        const p = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      }
      params.date_from = fmt(dateRange.value[0])
      params.date_to = fmt(dateRange.value[1])
    }
    const res = await useApiFetch<{ items: any[]; total: number }>('/api/products/stock-logs', { query: params })
    logs.value = res.items || []
    if (res.total >= 0) total.value = res.total
  } catch {
    logs.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onPageChange(page: number) {
  currentPage.value = page
  loadLogs()
}

function onSearch() {
  currentPage.value = 1
  loadLogs()
}

watch(typeFilter, () => onSearch())
watch(dateRange, () => onSearch())
watch(storeId, () => {
  currentPage.value = 1
  loadLogs()
})
onMounted(() => loadLogs())
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.page-head { display: flex; align-items: center; justify-content: space-between; }
.back-link { font-size: 14px; color: #169C91; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
.back-link:hover { opacity: 0.8; }
.back-symbol { margin-right: 6px; }
.page-title {
  margin: 0;
  font-size: 18px;
  color: #333;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.tb-search { width: 200px; }
.tb-type { width: 100px; }
.tb-date { width: 240px; }
.tb-btns { display: none; }

.empty-wrap { padding: 40px 0; display: flex; justify-content: center; }

.desktop-table { display: none; }
.mobile-cards { display: flex; flex-direction: column; gap: 8px; }
.log-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.lc-head { display: flex; justify-content: space-between; align-items: center; }
.lc-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lc-tail { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.lc-expand { cursor: pointer; padding: 2px; display: inline-flex; align-items: center; }
.lc-name { font-size: 15px; font-weight: 600; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-meta { display: flex; gap: 12px; align-items: center; margin-top: 6px; font-size: 13px; flex-wrap: wrap; }
.lc-change.up { color: #36c676; font-weight: 600; }
.lc-change.down { color: #f44336; font-weight: 600; }
.lc-after { color: #666; }
.lc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
  font-size: 12px;
  color: #999;
}
.lc-notes { flex: 1; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.pager-info { font-size: 13px; color: #999; }

@media (max-width: 767px) {
  .tb-search,
  .tb-type,
  .tb-date {
    flex-basis: 100%;
    width: 100%;
  }
  .tb-btns {
    display: flex;
    gap: 8px;
    flex-basis: 100%;
  }
  .tb-btns .n-button { flex: 1; }
}

@media (min-width: 768px) {
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
  .page-title { font-size: 20px; }
}
</style>