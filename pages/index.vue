<template>
  <div class="home">
    <!-- 快捷操作 -->
    <section class="section">
      <div class="quick-grid">
        <div class="quick-card" @click="go('/pos')">
          <n-icon :component="CartOutline" size="28" color="#169C91" />
          <span class="quick-text">收银开单</span>
        </div>
        <div class="quick-card" @click="go('/members')">
          <n-icon :component="PersonAddOutline" size="28" color="#169C91" />
          <span class="quick-text">添加会员</span>
        </div>
        <div class="quick-card" @click="go('/products')">
          <n-icon :component="CubeOutline" size="28" color="#169C91" />
          <span class="quick-text">商品入库</span>
        </div>
        <div class="quick-card" @click="go('/pos?tab=history')">
          <n-icon :component="ReceiptOutline" size="28" color="#169C91" />
          <span class="quick-text">查流水</span>
        </div>
      </div>
    </section>

    <!-- 今日数据 -->
    <section class="section">
      <div class="stats-grid">
        <n-card class="stat-card" :bordered="false">
          <div class="stat-label">营业额</div>
          <div class="stat-value stat-primary">{{ moneyWithSymbol(today?.sales ?? 0) }}</div>
        </n-card>
        <n-card class="stat-card" :bordered="false">
          <div class="stat-label">进账</div>
          <div class="stat-value stat-primary">{{ moneyWithSymbol(today?.income ?? 0) }}</div>
        </n-card>
        <n-card class="stat-card" :bordered="false">
          <div class="stat-label">订单数</div>
          <div class="stat-value">{{ today?.orders ?? 0 }}</div>
        </n-card>
        <n-card class="stat-card" :bordered="false">
          <div class="stat-label">退货额</div>
          <div class="stat-value stat-warn">{{ moneyWithSymbol(today?.returns ?? 0) }}</div>
        </n-card>
      </div>
    </section>

    <!-- 销售趋势 -->
    <section class="section">
      <n-card :bordered="false" class="shadow-card">
        <template #header>
          <span class="section-title">销售趋势</span>
        </template>
        <div class="chart-toolbar">
          <n-radio-group v-model:value="metric" size="small" button-style="solid" class="chart-metric">
            <n-radio-button value="sales">营业额</n-radio-button>
            <n-radio-button value="income">进账</n-radio-button>
            <n-radio-button v-if="isManager" value="profit">毛利</n-radio-button>
          </n-radio-group>
          <div class="chart-selects">
            <n-select v-model:value="year" :options="yearOptions" size="small" class="chart-year" />
            <n-select v-model:value="month" :options="monthOptions" size="small" class="chart-month" />
          </div>
        </div>
        <n-spin :show="chartLoading">
          <div class="chart-wrap">
            <ClientOnly v-if="data?.chart">
              <Bar v-if="isMobile" :data="chartData" :options="chartOptions" />
              <Line v-else :data="chartData" :options="chartOptions" />
              <template #fallback><div style="height: 200px;" /></template>
            </ClientOnly>
            <n-empty v-else description="暂无数据" style="padding: 24px 0;" />
          </div>
        </n-spin>
      </n-card>
    </section>

    <div class="content-grid">
      <!-- 销售排行 -->
      <section class="section">
        <n-card :bordered="false" class="shadow-card">
          <template #header>
            <span class="section-title">销售排行</span>
          </template>
          <n-spin :show="staticLoading">
            <div v-if="topProducts.length" class="rank-list">
              <div v-for="(p, i) in topProducts" :key="p.id" class="rank-item">
                <span class="rank-no" :class="{ top3: i < 3 }">{{ i + 1 }}</span>
                <span class="rank-name">{{ p.name }}</span>
                <span class="rank-meta">{{ p.qty }}{{ p.primary_unit }} / {{ moneyWithSymbol(p.amount) }}</span>
              </div>
            </div>
            <n-empty v-else description="暂无销售数据" style="padding: 16px 0;" />
          </n-spin>
        </n-card>
      </section>

      <!-- 库存预警 -->
      <section class="section">
        <n-card :bordered="false" class="shadow-card">
          <template #header>
            <span class="section-title">库存预警</span>
          </template>
          <n-spin :show="staticLoading">
            <div v-if="stockAlerts.length" class="alert-list">
              <div
                v-for="p in stockAlerts"
                :key="p.id"
                class="alert-item"
                @click="go(`/products?id=${p.id}`)"
              >
                <div class="alert-name">{{ p.name }}</div>
                <n-tag type="error" size="small">库存 {{ p.stock_quantity }} / 预警 {{ p.stock_alert }}</n-tag>
              </div>
            </div>
            <n-empty v-else description="暂无库存预警" style="padding: 16px 0;" />
          </n-spin>
        </n-card>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Line, Bar } from 'vue-chartjs'
import { CartOutline, PersonAddOutline, CubeOutline, ReceiptOutline } from '@vicons/ionicons5'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

definePageMeta({ layout: 'default' })

const toast = useToast()
const { storeId } = useStoreId()
const { isMobile } = useIsMobile()
const authStore = useAuthStore()
const isManager = computed(() => ['admin', 'manager'].includes(authStore.userRole.value || ''))

const now = new Date()
const year = ref(now.getFullYear())
const month = ref<number | null>(now.getMonth() + 1)
const metric = ref<'sales' | 'income' | 'profit'>('sales')

const data = ref<any>(null)
const chartLoading = ref(false)
const staticLoading = ref(false)
const stockAlerts = ref<any[]>([])
const topProducts = ref<any[]>([])

const yearOptions = computed(() => {
  const cur = now.getFullYear()
  const arr: Array<{ label: string; value: number }> = []
  for (let y = cur; y >= cur - 3; y--) arr.push({ label: `${y}年`, value: y })
  return arr
})

const monthOptions = computed(() => [
  { label: '全年', value: null },
  ...Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: i + 1 })),
])

const today = computed(() => data.value?.today)

function go(path: string) {
  navigateTo(path)
}

let dashboardReqId = 0
let dashboardAbort: AbortController | null = null
let dashboardTimer: ReturnType<typeof setTimeout> | null = null
async function fetchDashboard(scope: 'full' | 'chart' = 'full') {
  if (!storeId.value) {
    if (scope === 'full') {
      data.value = null
      stockAlerts.value = []
      topProducts.value = []
    }
    return
  }
  dashboardAbort?.abort()
  dashboardAbort = new AbortController()
  const myReq = ++dashboardReqId
  chartLoading.value = true
  if (scope === 'full') staticLoading.value = true
  try {
    const params: Record<string, any> = { store_id: storeId.value, year: year.value }
    if (month.value != null) params.month = month.value
    const res = await useApiFetch('/api/dashboard', { query: params, signal: dashboardAbort.signal })
    if (myReq !== dashboardReqId) return // 已有更新的请求，旧响应丢弃
    data.value = res
    if (scope === 'full') {
      stockAlerts.value = res?.stockAlerts || []
      topProducts.value = res?.topProducts || []
    }
  } catch (e: any) {
    if (myReq !== dashboardReqId || e?.name === 'AbortError') return
    toast.error(e?.data?.message || '加载失败')
  } finally {
    if (myReq === dashboardReqId) {
      chartLoading.value = false
      staticLoading.value = false
    }
  }
}

function scheduleChart() {
  if (dashboardTimer) clearTimeout(dashboardTimer)
  dashboardTimer = setTimeout(() => fetchDashboard('chart'), 300)
}

const isWeekly = computed(() => isMobile.value && data.value?.chart?.mode === 'daily')

function bucketWeekly(values: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i += 7) {
    let s = 0
    for (let j = i; j < Math.min(i + 7, values.length); j++) s += values[j] || 0
    out.push(round2(s))
  }
  return out
}

function weeklyLabels(len: number): string[] {
  const out: string[] = []
  for (let s = 1; s <= len; s += 7) out.push(`${s}-${Math.min(s + 6, len)}日`)
  return out
}

const chartData = computed(() => {
  const chart = data.value?.chart
  if (!chart) return { labels: [], datasets: [] }
  const values = metric.value === 'sales' ? chart.sales : metric.value === 'income' ? chart.income : chart.profit
  const name = metric.value === 'sales' ? '营业额' : metric.value === 'income' ? '进账' : '商品毛利'
  const showValues = isWeekly.value ? bucketWeekly(values) : values
  const labels = isWeekly.value ? weeklyLabels(values.length) : chart.labels
  const total = showValues.reduce((s: number, v: number) => s + (v || 0), 0)
  const label = `${name}(${moneyWithSymbol(round2(total))})`
  const base = { label, data: showValues }
  const dataset = isMobile.value
    ? { ...base, backgroundColor: '#169C91', borderRadius: 6, maxBarThickness: 40 }
    : { ...base, borderColor: '#169C91', backgroundColor: 'rgba(22, 156, 145, 0.12)', fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 4 }
  return {
    labels,
    datasets: [dataset],
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  normalized: true,
  plugins: {
    legend: { display: true },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
      callbacks: {
        title: (items: any[]) => {
          const l = items?.[0]?.label ?? ''
          const m = /^(\d+)-(\d+)$/.exec(l)
          if (m) return `${Number(m[1])}月${Number(m[2])}日`
          return l
        },
        label: (item: any) => `${metricName.value}：${moneyWithSymbol(item.parsed?.y ?? 0)}`,
      },
    },
  },
  scales: {
    y: { beginAtZero: true, ticks: { maxTicksLimit: 6, precision: 0 }, grace: '10%' },
    x: isWeekly.value
      ? { ticks: { autoSkip: false, maxRotation: 0 }, grid: { display: !isMobile.value } }
      : {},
  },
}))

const metricName = computed(() =>
  metric.value === 'sales' ? '营业额' : metric.value === 'income' ? '进账' : '商品毛利'
)

onMounted(() => {
  if (storeId.value) fetchDashboard()
})

watch(storeId, (v) => {
  if (v) fetchDashboard()
  else {
    dashboardAbort?.abort()
    if (dashboardTimer) clearTimeout(dashboardTimer)
    data.value = null
    stockAlerts.value = []
    topProducts.value = []
  }
})

watch([year, month], () => {
  if (storeId.value) scheduleChart()
})

watch(isManager, (v) => {
  if (!v && metric.value === 'profit') metric.value = 'sales'
})
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section {
  margin: 0;
}

/* Quick actions */
.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.quick-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 12px;
  background: #fff;
  border: none;
  border-radius: 3px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  transition: all 0.15s;
}

.quick-card:hover {
  background: #f0fbfa;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(22, 156, 145, 0.15);
}

.quick-text {
  font-size: 14px;
  font-weight: 400;
  color: #1f2937;
}

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.stat-card {
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.stat-label {
  font-size: 13px;
  color: #666;
}

.stat-value {
  font-size: 22px;
  font-weight: 400;
  color: #333;
  margin-top: 4px;
}

.stat-primary {
  color: #169C91;
}

.stat-warn {
  color: #FF9500;
}

:deep(.shadow-card) {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* Two-column content */
.content-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-weight: 600;
  color: #333;
  font-size: 15px;
}

.alert-list {
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow-y: auto;
}

.alert-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}

.alert-item:hover {
  background: #f7f9fa;
}

.alert-name {
  font-size: 14px;
  color: #333;
}

.chart-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.chart-metric { }

.chart-selects {
  display: flex;
  gap: 8px;
}

.chart-year { width: 104px; }
.chart-month { width: 96px; }

@media (max-width: 767px) {
  .chart-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .chart-metric { width: 100%; }
  .chart-toolbar :deep(.n-radio-group) {
    width: 100%;
    display: flex;
  }
  .chart-toolbar :deep(.n-radio-button) {
    flex: 1;
    justify-content: center;
  }
  .chart-selects {
    width: 100%;
  }
  .chart-year,
  .chart-month {
    flex: 1;
    width: auto;
  }
  .chart-wrap {
    height: 260px;
  }
}

.chart-wrap {
  width: 100%;
}

.rank-list {
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow-y: auto;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px;
  border-bottom: 1px solid #f0f0f0;
}

.rank-no {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #f0f0f0;
  font-size: 12px;
  color: #999;
}

.rank-no.top3 {
  background: #169C91;
  color: #fff;
}

.rank-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: #333;
}

.rank-meta {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
}

@media (min-width: 768px) {
  .home {
    gap: 16px;
  }

  .quick-grid {
    grid-template-columns: repeat(4, 1fr);
  }

  .quick-card {
    padding: 22px 12px;
  }

  .quick-text {
    font-size: 15px;
  }

  .stats-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  .stat-value {
    font-size: 26px;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
    gap: 16px;
  }

  .chart-wrap {
    height: 340px;
  }
}
</style>