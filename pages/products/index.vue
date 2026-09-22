<template>
  <div class="products-page">
    <!-- Top bar -->
    <div class="top-bar">
      <n-input
        v-model:value="searchText"
        placeholder="搜索商品名称 / 助记码 / 条码"
        clearable
        size="medium"
        :input-props="{ autocomplete: 'off' }"
        class="search-input"
        @update:value="onSearchInput"
        @keydown.enter="loadProducts"
      >
        <template #prefix><n-icon :component="SearchOutline" :size="16" color="#999" /></template>
      </n-input>
      <div class="top-actions">
        <template v-if="isManager">
          <n-button size="medium" @click="navigateTo('/products/stock-logs')">库存流水</n-button>
          <n-button size="medium" :loading="exporting" @click="exportInventory">打印盘点</n-button>
          <n-button size="medium" @click="showImportModal = true">导入商品</n-button>
          <n-button size="medium" type="primary" @click="openNewProduct">+ 新增商品</n-button>
        </template>
      </div>
    </div>

    <!-- Stock alert bar -->
    <div v-if="alertCount > 0" class="alert-bar" @click="toggleAlertFilter">
      <span class="alert-text">⚠ {{ alertCount }} 个商品库存不足</span>
      <n-button size="small" tertiary>{{ alertOnly ? '查看全部' : '查看' }}</n-button>
    </div>

    <div v-if="!storeId" class="empty-wrap"><n-empty description="请先选择店铺" /></div>

    <n-spin v-else :show="loading">
      <div v-if="!filteredProducts.length" class="empty-wrap"><n-empty description="暂无商品" /></div>

      <!-- Desktop table -->
      <div v-if="filteredProducts.length" class="desktop-table">
        <n-data-table
          :columns="productColumns"
          :data="filteredProducts"
          :bordered="false"
          :single-line="false"
          size="small"
          :max-height="600"
          :row-key="(row: Product) => row.id"
          :pagination="pagination"
          remote
          @update:page="onPageChange"
        />
      </div>

      <!-- Mobile cards -->
      <div v-if="filteredProducts.length" class="mobile-cards">
        <div
          v-for="p in filteredProducts"
          :key="p.id"
          class="product-card"
        >
          <div class="pc-head">
            <span class="pc-name">{{ p.name }}</span>
            <div class="pc-tail">
              <n-tag :type="p.status === 'active' ? 'success' : 'default'" size="tiny" :bordered="false" round>
                {{ p.status === 'active' ? '在售' : '停售' }}
              </n-tag>
              <span class="pc-expand" @click="toggleExpand(p.id)">
                <n-icon :component="expandedMap[p.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
              </span>
            </div>
          </div>
          <div class="pc-meta">
            <n-tag size="tiny" :bordered="false">{{ p.short_code }}</n-tag>
            <span class="pc-price">¥{{ formatMoney(p.selling_price) }}</span>
          </div>
          <template v-if="expandedMap[p.id]">
            <div class="pc-stock">
              <span :class="['stock-val', p.stock_quantity <= p.stock_alert ? 'down' : '']">
                <template v-if="p.stock_quantity <= p.stock_alert">↓ </template>{{ p.stock_quantity }}{{ p.primary_unit }}
              </span>
              <span class="stock-alert">预警 {{ p.stock_alert }}</span>
            </div>
            <div v-if="isManager" class="pc-actions">
              <n-button size="small" quaternary type="info" @click="openStockModal('入库', p)">库存</n-button>
              <n-button size="small" quaternary type="primary" @click="openDetail(p)">编辑</n-button>
              <n-button size="small" quaternary type="error" @click="onDeleteProduct(p)">删除</n-button>
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

    <!-- ============ New / Edit product form modal ============ -->
    <n-modal
      v-model:show="showFormModal"
      preset="card"
      :title="editingId ? '编辑商品' : '新增商品'"
      :style="{ width: '94%', maxWidth: '520px' }"
      :mask-closable="false"
    >
      <n-form label-placement="top" size="medium" class="product-form">
        <n-form-item label="商品名称" required>
          <n-input v-model:value="form.name" placeholder="商品名称" @blur="autoShortCode" />
        </n-form-item>
        <div class="form-row">
          <n-form-item label="助记码">
            <n-input v-model:value="form.short_code" placeholder="留空自动生成" />
          </n-form-item>
          <n-form-item label="条码">
            <n-input v-model:value="form.barcode" placeholder="条码" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="主单位" required>
            <n-input v-model:value="form.primary_unit" placeholder="如：件 / 瓶 / 斤" />
          </n-form-item>
          <n-form-item label="售价" required>
            <n-input-number v-model:value="form.selling_price" :precision="2" :step="0.01" :min="0" :show-button="false" style="width: 100%" />
          </n-form-item>
        </div>
        <div class="form-row">
          <n-form-item label="成本价">
            <n-input-number v-model:value="form.cost_price" :precision="2" :step="0.01" :min="0" :show-button="false" style="width: 100%" />
          </n-form-item>
          <n-form-item label="库存预警">
            <n-input-number v-model:value="form.stock_alert" :precision="2" :step="1" :min="0" :show-button="false" style="width: 100%" />
          </n-form-item>
        </div>
        <n-form-item label="参与会员折扣">
          <n-switch v-model:value="form.discountable" />
        </n-form-item>
        <n-form-item label="启用副单位">
          <n-switch v-model:value="form.enableSecondary" />
        </n-form-item>
        <template v-if="form.enableSecondary">
          <div class="form-row">
            <n-form-item label="副单位">
              <n-input v-model:value="form.secondary_unit" placeholder="如：箱" />
            </n-form-item>
            <n-form-item label="换算率">
              <n-input-number v-model:value="form.conversion_rate" :precision="2" :step="1" :min="0" style="width: 100%" />
            </n-form-item>
          </div>
          <n-form-item label="副单位售价">
            <n-input-number v-model:value="form.secondary_price" :precision="2" :step="0.01" :min="0" :show-button="false" style="width: 100%" />
          </n-form-item>
        </template>
        <div class="form-row">
          <n-form-item :label="'初始库存' + (form.primary_unit ? '（' + form.primary_unit + '）' : '')" v-if="!editingId">
            <n-input-number v-model:value="form.stock_quantity" :precision="2" :step="1" :min="0" :show-button="false" style="width: 100%" />
          </n-form-item>
          <n-form-item label="状态">
            <n-switch v-model:value="form.active" :checked-value="'active'" :unchecked-value="'inactive'">
              <template #checked>在售</template>
              <template #unchecked>停售</template>
            </n-switch>
          </n-form-item>
        </div>
      </n-form>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="showFormModal = false">取消</n-button>
          <n-button v-if="isManager" type="primary" :loading="formSaving" :disabled="formSaving" @click="saveProduct">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- ============ Product detail / edit modal ============ -->
    <n-modal
      v-model:show="showDetailModal"
      preset="card"
      :title="detailProduct ? detailProduct.name : '商品详情'"
      :style="{ width: '95%', maxWidth: '640px' }"
    >
      <div v-if="detailProduct">
        <!-- manager+ : 可编辑表单 -->
        <n-form v-if="isManager" label-placement="top" size="medium" class="product-form">
          <n-form-item label="商品名称" required>
            <n-input v-model:value="form.name" placeholder="商品名称" @blur="autoShortCode" />
          </n-form-item>
          <div class="form-row">
            <n-form-item label="助记码">
              <n-input v-model:value="form.short_code" placeholder="留空自动生成" />
            </n-form-item>
            <n-form-item label="条码">
              <n-input v-model:value="form.barcode" placeholder="条码" />
            </n-form-item>
          </div>
          <div class="form-row">
            <n-form-item label="主单位" required>
              <n-input v-model:value="form.primary_unit" placeholder="如：件 / 瓶 / 斤" />
            </n-form-item>
            <n-form-item label="售价" required>
              <n-input-number v-model:value="form.selling_price" :precision="2" :step="0.01" :min="0" :show-button="false" style="width: 100%" />
            </n-form-item>
          </div>
          <div class="form-row">
            <n-form-item label="成本价">
              <n-input-number v-model:value="form.cost_price" :precision="2" :step="0.01" :min="0" :show-button="false" style="width: 100%" />
            </n-form-item>
            <n-form-item label="库存预警">
              <n-input-number v-model:value="form.stock_alert" :precision="2" :step="1" :min="0" :show-button="false" style="width: 100%" />
            </n-form-item>
          </div>
          <n-form-item label="参与会员折扣">
            <n-switch v-model:value="form.discountable" />
          </n-form-item>
          <n-form-item label="启用副单位">
            <n-switch v-model:value="form.enableSecondary" />
          </n-form-item>
          <template v-if="form.enableSecondary">
            <div class="form-row">
              <n-form-item label="副单位">
                <n-input v-model:value="form.secondary_unit" placeholder="如：箱" />
              </n-form-item>
              <n-form-item label="换算率">
                <n-input-number v-model:value="form.conversion_rate" :precision="2" :step="1" :min="0" style="width: 100%" />
              </n-form-item>
            </div>
            <n-form-item label="副单位售价">
              <n-input-number v-model:value="form.secondary_price" :precision="2" :step="0.01" :min="0" :show-button="false" style="width: 100%" />
            </n-form-item>
          </template>
          <n-form-item label="状态">
            <n-switch v-model:value="form.active" :checked-value="'active'" :unchecked-value="'inactive'">
              <template #checked>在售</template>
              <template #unchecked>停售</template>
            </n-switch>
          </n-form-item>
          <div class="modal-footer">
            <n-button type="primary" :loading="formSaving" :disabled="formSaving" @click="saveProduct">保存修改</n-button>
          </div>
        </n-form>

        <!-- clerk : 只读详情 -->
        <template v-else>
          <div class="detail-readonly">
            <div class="dr-row"><span class="dr-label">商品名称</span><span>{{ detailProduct.name }}</span></div>
            <div class="dr-row"><span class="dr-label">助记码</span><span>{{ detailProduct.short_code || '-' }}</span></div>
            <div class="dr-row"><span class="dr-label">条码</span><span>{{ detailProduct.barcode || '-' }}</span></div>
            <div class="dr-row"><span class="dr-label">主单位</span><span>{{ detailProduct.primary_unit }}</span></div>
            <div class="dr-row"><span class="dr-label">售价</span><span>¥{{ formatMoney(detailProduct.selling_price) }}</span></div>
            <div class="dr-row"><span class="dr-label">成本价</span><span>{{ detailProduct.cost_price != null ? '¥' + formatMoney(detailProduct.cost_price) : '-' }}</span></div>
            <div class="dr-row"><span class="dr-label">库存</span><span>{{ detailProduct.stock_quantity }}{{ detailProduct.primary_unit }}</span></div>
            <div class="dr-row"><span class="dr-label">库存预警</span><span>{{ detailProduct.stock_alert != null ? detailProduct.stock_alert : '-' }}</span></div>
            <div v-if="detailProduct.secondary_unit" class="dr-row">
              <span class="dr-label">副单位</span>
              <span>1 {{ detailProduct.secondary_unit }} = {{ detailProduct.conversion_rate }} {{ detailProduct.primary_unit }}（¥{{ formatMoney(detailProduct.secondary_price) }}）</span>
            </div>
            <div class="dr-row"><span class="dr-label">会员折扣</span><span>{{ Number(detailProduct.discountable) === 1 ? '参与' : '不参与' }}</span></div>
            <div class="dr-row"><span class="dr-label">状态</span><span>{{ detailProduct.status === 'active' ? '在售' : '停售' }}</span></div>
          </div>
        </template>
      </div>
    </n-modal>

    <!-- ============ Stock operation modal ============ -->
    <n-modal
      v-model:show="showStockModal"
      preset="card"
      :title="'库存管理 · ' + (stockProduct?.name || '')"
      :style="{ width: '92%', maxWidth: '460px' }"
      :mask-closable="false"
    >
      <div class="stock-form">
        <div class="sf-current">
          <span class="sf-current-label">当前库存</span>
          <span class="sf-current-value">{{ stockProduct?.stock_quantity }}{{ stockProduct?.primary_unit }}</span>
        </div>
        <n-tabs v-model:value="stockMode" type="line" size="small" style="margin-top: 12px;" class="stock-tabs">
          <n-tab-pane name="入库" tab="入库">
            <n-form-item label="入库数量" required>
              <n-input-number v-model:value="stockForm.quantity" :precision="2" :step="1" :min="0.01" style="width: 100%" />
            </n-form-item>
            <n-form-item label="备注">
              <n-input v-model:value="stockForm.notes" placeholder="备注（选填）" />
            </n-form-item>
          </n-tab-pane>
          <n-tab-pane name="出库" tab="出库">
            <n-form-item label="出库数量" required>
              <n-input-number v-model:value="stockForm.quantity" :precision="2" :step="1" :min="0.01" style="width: 100%" />
            </n-form-item>
            <n-form-item label="出库原因" required>
              <n-input v-model:value="stockForm.notes" placeholder="请填写出库原因" />
            </n-form-item>
          </n-tab-pane>
          <n-tab-pane name="盘点" tab="盘点">
            <n-form-item label="实盘数量" required>
              <n-input-number v-model:value="stockForm.actual" :precision="2" :step="1" :min="0" style="width: 100%" />
            </n-form-item>
            <div class="sf-diff" :class="stockDiff >= 0 ? 'up' : 'down'">
              <span class="sf-diff-label">差异</span>
              <span class="sf-diff-value">{{ stockDiff >= 0 ? '+' : '' }}{{ stockDiff }}{{ stockProduct?.primary_unit }}</span>
            </div>
            <n-form-item label="备注">
              <n-input v-model:value="stockForm.notes" placeholder="备注（选填）" />
            </n-form-item>
          </n-tab-pane>
        </n-tabs>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="showStockModal = false">取消</n-button>
          <n-button type="primary" :loading="stockSaving" :disabled="stockSaving" @click="submitStock">确认{{ stockMode }}</n-button>
        </div>
      </template>
    </n-modal>

    <!-- ============ Import modal ============ -->
    <n-modal
      v-model:show="showImportModal"
      preset="card"
      title="导入商品"
      :style="{ width: '94%', maxWidth: '480px' }"
    >
      <div class="import-modal">
        <div class="import-instructions">
          <p>1. 下载模板，按格式填写商品信息</p>
          <p>2. 商品名称、主单位、售价为必填，其余选填</p>
          <p>3. 助记码留空将自动生成，条码留空不影响导入</p>
          <p>4. 会员折扣填「是」或「否」，状态填「上架」或「下架」</p>
          <p>5. 副单位填写后，换算率必填（1副单位 = N主单位）</p>
          <p>6. 条码或助记码已存在的商品：库存自动累加；非空字段可选覆盖原值，导入前会提示确认</p>
        </div>
        <div class="import-actions">
          <n-button @click="downloadTemplate">下载模板</n-button>
          <n-upload
            :show-file-list="false"
            accept=".xlsx,.xls"
            :custom-request="handleImportUpload"
          >
            <n-button type="primary" :loading="importParsing">选择文件</n-button>
          </n-upload>
        </div>
        <div v-if="importResult" class="import-result">
          <n-alert :type="importResult.failed > 0 ? 'warning' : 'success'" :show-icon="true">
            成功 {{ importResult.success }} 条，失败 {{ importResult.failed }} 条
          </n-alert>
          <div v-if="importResult.errors.length" class="import-errors">
            <div v-for="(err, i) in importResult.errors" :key="i" class="import-error-row">
              第{{ err.row }}行 · {{ err.name || '-' }}：{{ err.message }}
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button type="primary" @click="finishImport">完成</n-button>
        </div>
      </template>
    </n-modal>

    <!-- ============ Import overwrite confirm ============ -->
    <n-modal
      v-model:show="showImportConfirm"
      preset="card"
      title="确认导入"
      :style="{ width: '94%', maxWidth: '460px' }"
    >
      <div class="import-confirm">
        <p v-if="importPreview">
          <b class="ic-num">{{ importPreview.existing_count }}</b> 条已存在、<b class="ic-num">{{ importPreview.new_count }}</b> 条新增，库存自动累加。
        </p>
        <n-checkbox v-model:checked="importConfirmOverwrite">同时覆盖已有商品信息（不勾选则仅累加库存）</n-checkbox>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button @click="cancelImportConfirm">取消</n-button>
          <n-button type="primary" :loading="importParsing" :disabled="importParsing" @click="confirmImport">确认导入</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NTag, NButton, NIcon } from 'naive-ui'
import { SearchOutline, ChevronDownOutline, ChevronUpOutline } from '@vicons/ionicons5'
import * as XLSX from 'xlsx'
import { pinyin } from 'pinyin-pro'
import type { DataTableColumns } from 'naive-ui'
import type { Product } from '~/types'

definePageMeta({ layout: 'default' })

const authStore = useAuthStore()
const { storeId } = useStoreId()
const toast = useToast()

const isManager = computed(() => ['admin', 'manager'].includes(authStore.userRole.value || ''))

const expandedMap = ref<Record<number, boolean>>({})
function toggleExpand(id: number) {
  expandedMap.value = { ...expandedMap.value, [id]: !expandedMap.value[id] }
}

/* ---------------- helpers ---------------- */
function formatTime(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(5, 16)
}
function pinyinInitials(name: string): string {
  const arr = pinyin(String(name || ''), { pattern: 'first', type: 'array', toneType: 'none' }) as string[]
  return (arr || []).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'P'
}

/* ---------------- product list ---------------- */
const searchText = ref('')
const products = ref<Product[]>([])
const loading = ref(false)
const totalProducts = ref(0)
const currentPage = ref(1)
const pageSize = 20
const alertOnly = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { currentPage.value = 1; loadProducts() }, 500)
}

const alertCount = ref(0)
const filteredProducts = computed(() => products.value)
function toggleAlertFilter() {
  alertOnly.value = !alertOnly.value
  currentPage.value = 1
  loadProducts()
}

const pagination = computed(() => ({
  page: currentPage.value,
  pageSize,
  itemCount: totalProducts.value,
  showSizePicker: false,
}))

const totalPages = computed(() => Math.max(1, Math.ceil(totalProducts.value / pageSize)))

const defaultStockAlert = ref(10)
async function loadDefaultAlert() {
  if (!storeId.value) return
  try {
    const settings = await useApiFetch<any>('/api/settings', { query: { store_id: storeId.value } })
    if (settings?.default_stock_alert != null) {
      defaultStockAlert.value = Number(settings.default_stock_alert)
    }
  } catch (e) {
    console.warn('加载默认库存预警失败:', e)
  }
}

async function loadProducts() {
  if (!storeId.value) return
  loading.value = true
  try {
    const params: Record<string, any> = {
      store_id: storeId.value,
      page: currentPage.value,
      pageSize,
    }
    if (searchText.value.trim()) { params.search = searchText.value.trim(); params.fuzzy = 1 }
    if (alertOnly.value) params.stock_alert_only = 1
    const res = await useApiFetch<{ items: Product[]; total: number; alert_count?: number }>('/api/products', { query: params })
    products.value = res.items || []
    if (res.total >= 0) totalProducts.value = res.total
    if (!alertOnly.value && res.alert_count != null) {
      alertCount.value = res.alert_count
    }
  } catch (e: any) {
    toast.error(e?.data?.message || '加载商品失败')
  } finally {
    loading.value = false
  }
}

function onPageChange(page: number) {
  currentPage.value = page
  loadProducts()
}

const productColumns = computed<DataTableColumns<Product>>(() => {
  const cols: DataTableColumns<Product> = [
    { title: '名称', key: 'name', render: (r) => h('span', { class: 'col-name' }, r.name) },
    { title: '助记码', key: 'short_code', width: 90 },
    { title: '单位', key: 'primary_unit', width: 70 },
    { title: '售价', key: 'selling_price', width: 90, render: (r) => `¥${formatMoney(r.selling_price)}` },
    {
      title: '库存',
      key: 'stock',
      width: 120,
      render: (r) =>
        h('span', { class: ['col-stock', Number(r.stock_quantity) <= Number(r.stock_alert) ? 'down' : ''] }, [
          Number(r.stock_quantity) <= Number(r.stock_alert) ? '↓ ' : '',
          `${r.stock_quantity}`,
        ]),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (r) =>
        h(
          NTag,
          { size: 'small', type: r.status === 'active' ? 'success' : 'default', bordered: false },
          { default: () => (r.status === 'active' ? '在售' : '停售') },
        ),
    },
  ]
  if (isManager.value) {
    cols.push({
      title: '操作',
      key: 'actions',
      width: 200,
      fixed: 'right',
      render: (r: any) => {
        const btns = []
        btns.push(h(NButton, { size: 'small', quaternary: true, type: 'info', onClick: () => openStockModal('入库', r) }, { default: () => '库存' }))
        btns.push(h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(r) }, { default: () => '编辑' }))
        btns.push(h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => onDeleteProduct(r) }, { default: () => '删除' }))
        return btns
      },
    })
  }
  return cols
})

/* ---------------- product form ---------------- */
const showFormModal = ref(false)
const showDetailModal = ref(false)
const detailProduct = ref<Product | null>(null)
const editingId = ref<number | null>(null)
const formSaving = ref(false)

interface FormState {
  name: string
  short_code: string
  barcode: string
  primary_unit: string
  selling_price: number | null
  cost_price: number | null
  discountable: boolean
  enableSecondary: boolean
  secondary_unit: string
  conversion_rate: number | null
  secondary_price: number | null
  stock_alert: number | null
  stock_quantity: number | null
  active: 'active' | 'inactive'
}
const form = reactive<FormState>({
  name: '',
  short_code: '',
  barcode: '',
  primary_unit: '',
  selling_price: null,
  cost_price: null,
  discountable: true,
  enableSecondary: false,
  secondary_unit: '',
  conversion_rate: null,
  secondary_price: null,
  stock_alert: 10,
  stock_quantity: 0,
  active: 'active',
})

function resetForm() {
  Object.assign(form, {
    name: '', short_code: '', barcode: '', primary_unit: '',
    selling_price: null, cost_price: null, discountable: true,
    enableSecondary: false, secondary_unit: '', conversion_rate: null,
    secondary_price: null, stock_alert: defaultStockAlert.value, stock_quantity: 0, active: 'active',
  })
}
function fillForm(p: Product) {
  editingId.value = p.id
  Object.assign(form, {
    name: p.name,
    short_code: p.short_code,
    barcode: p.barcode || '',
    primary_unit: p.primary_unit,
    selling_price: Number(p.selling_price),
    cost_price: p.cost_price != null ? Number(p.cost_price) : null,
    discountable: Number(p.discountable) === 1,
    enableSecondary: !!p.secondary_unit,
    secondary_unit: p.secondary_unit || '',
    conversion_rate: p.conversion_rate != null ? Number(p.conversion_rate) : null,
    secondary_price: p.secondary_price != null ? Number(p.secondary_price) : null,
    stock_alert: p.stock_alert != null ? Number(p.stock_alert) : 10,
    stock_quantity: Number(p.stock_quantity),
    active: p.status === 'active' ? 'active' : 'inactive',
  })
}
function autoShortCode() {
  if (!form.short_code && form.name) {
    form.short_code = pinyinInitials(form.name)
  }
}

async function onDeleteProduct(p: Product) {
  if (!isManager.value) {
    toast.warning('无权限操作商品')
    return
  }
  ;(window as any).$dialog?.warning({
    title: '确认删除',
    content: `确定删除商品「${p.name}」吗？有订单记录或库存流水的商品无法删除，请停售。`,
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await useApiFetch(`/api/products/${p.id}`, { method: 'DELETE' })
        toast.success('已删除')
        loadProducts()
      } catch (e: any) {
        toast.error(e?.data?.message || '删除失败')
      }
    },
  })
}

function openNewProduct() {
  if (!isManager.value) {
    toast.warning('无权限操作商品')
    return
  }
  editingId.value = null
  resetForm()
  showFormModal.value = true
}

function openDetail(p: Product) {
  detailProduct.value = p
  fillForm(p)
  showDetailModal.value = true
}

function buildPayload(forEdit = false) {
  const payload: Record<string, any> = {
    store_id: storeId.value,
    name: form.name.trim(),
    short_code: form.short_code.trim(),
    barcode: form.barcode.trim() || null,
    primary_unit: form.primary_unit.trim(),
    selling_price: form.selling_price ?? 0,
    cost_price: form.cost_price,
    discountable: form.discountable ? 1 : 0,
    secondary_unit: form.enableSecondary && form.secondary_unit ? form.secondary_unit : null,
    conversion_rate: form.enableSecondary ? form.conversion_rate : null,
    secondary_price: form.enableSecondary ? form.secondary_price : null,
    stock_alert: form.stock_alert,
    status: form.active,
  }
  if (!forEdit) payload.stock_quantity = form.stock_quantity ?? 0
  return payload
}

async function saveProduct() {
  if (!isManager.value) {
    toast.warning('无权限操作商品')
    return
  }
  if (!storeId.value) return
  if (!form.name.trim()) { toast.warning('请填写商品名称'); return }
  if (!form.primary_unit.trim()) { toast.warning('请填写主单位'); return }
  if (form.selling_price == null || form.selling_price < 0) { toast.warning('售价无效'); return }
  formSaving.value = true
  try {
    const payload = buildPayload(!!editingId.value)
    let saved: Product
    if (editingId.value) {
      saved = await useApiFetch<Product>(`/api/products/${editingId.value}`, {
        method: 'PUT',
        body: payload,
      })
      toast.success('已保存')
      showDetailModal.value = false
      detailProduct.value = null
    } else {
      saved = await useApiFetch<Product>('/api/products', { method: 'POST', body: payload })
      toast.success('已新增')
      showFormModal.value = false
      currentPage.value = 1
    }
    await loadProducts()
  } catch (e: any) {
    toast.error(e?.data?.message || '保存失败')
  } finally {
    formSaving.value = false
  }
}

/* ---------------- stock ---------------- */
const showStockModal = ref(false)
const stockMode = ref<'入库' | '出库' | '盘点'>('入库')
const stockSaving = ref(false)
const stockProduct = ref<Product | null>(null)
const stockForm = reactive({
  quantity: 1,
  actual: 0,
  notes: '',
})
const stockDiff = computed(() => {
  if (!stockProduct.value) return 0
  return round2((stockForm.actual || 0) - Number(stockProduct.value.stock_quantity))
})
const stockSubmit = useIdempotentSubmit({
  slot: 'product_stock',
  fingerprint: () => `${stockProduct.value?.id || ''}:${stockMode.value}:${stockMode.value === '盘点' ? stockForm.actual : stockForm.quantity}`,
})
function openStockModal(mode: '入库' | '出库' | '盘点', product?: Product) {
  if (!isManager.value) {
    toast.warning('无权限操作库存')
    return
  }
  stockMode.value = mode
  stockProduct.value = product || detailProduct.value
  if (!stockProduct.value) return
  stockForm.quantity = 1
  stockForm.actual = Number(stockProduct.value.stock_quantity) || 0
  stockForm.notes = ''
  showStockModal.value = true
  stockSubmit.reset()
}

async function submitStock() {
  if (!isManager.value) {
    toast.warning('无权限操作库存')
    return
  }
  if (!stockProduct.value) return
  if (stockMode.value === '出库' && !stockForm.notes.trim()) {
    toast.warning('请填写出库原因')
    return
  }
  let body: Record<string, any> = { type: stockMode.value, notes: stockForm.notes }
  if (stockMode.value === '盘点') {
    if (stockForm.actual == null) { toast.warning('请填写实盘数量'); return }
    body.stock_after = stockForm.actual
  } else {
    if (!stockForm.quantity || stockForm.quantity <= 0) { toast.warning('请填写数量'); return }
    body.quantity_change = stockForm.quantity
  }
  stockSaving.value = true
  try {
    const res = await stockSubmit.post<{ id: number; stock_quantity: number }>(
      `/api/products/${stockProduct.value.id}/stock`,
      body,
    )
    toast.success(`${stockMode.value}成功`)
    stockSubmit.clear()
    showStockModal.value = false
    const idx = products.value.findIndex((p) => p.id === stockProduct.value!.id)
    if (idx >= 0) products.value[idx] = { ...products.value[idx], stock_quantity: res.stock_quantity }
    if (detailProduct.value && detailProduct.value.id === stockProduct.value!.id) {
      detailProduct.value = { ...detailProduct.value, stock_quantity: res.stock_quantity }
    }
    stockProduct.value = { ...stockProduct.value, stock_quantity: res.stock_quantity }
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(e?.data?.message || `${stockMode.value}失败`)
  } finally {
    stockSaving.value = false
  }
}

/* ---------------- export inventory pdf ---------------- */
const exporting = ref(false)
async function exportInventory() {
  if (!storeId.value) return
  exporting.value = true
  try {
    const html = await useApiFetch<string>('/api/products/inventory-pdf', {
      query: { store_id: storeId.value },
      responseType: 'text',
    })
    const win = window.open('', '_blank')
    if (!win) {
      toast.error('请允许弹出窗口')
      return
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
    win.close()
  } catch (e: any) {
    toast.error(apiErr(e))
  } finally {
    exporting.value = false
  }
}

/* ---------------- excel import ---------------- */
const showImportModal = ref(false)
const importParsing = ref(false)
const importResult = ref<{ success: number; failed: number; errors: Array<{ row: number; name: string; message: string }> } | null>(null)
const showImportConfirm = ref(false)
const importConfirmOverwrite = ref(false)
const importPreview = ref<{ total: number; existing_count: number; new_count: number; existing_items: any[] } | null>(null)
const pendingImportRows = ref<any[]>([])
const importSubmit = useIdempotentSubmit({
  slot: 'product_import',
  fingerprint: () => `${pendingImportRows.value.length}:${importConfirmOverwrite.value}:${String(pendingImportRows.value[0]?.name || '').slice(0, 8)}`,
})

const TEMPLATE_HEADERS = [
  '商品名称', '助记码', '条码', '主单位', '售价', '副单位', '换算率',
  '副单位售价', '成本价', '会员折扣', '库存', '库存预警', '状态',
]
const HEADER_MAP: Record<string, string> = {
  '商品名称': 'name', '助记码': 'short_code', '条码': 'barcode', '主单位': 'primary_unit',
  '售价': 'selling_price', '副单位': 'secondary_unit', '换算率': 'conversion_rate',
  '副单位售价': 'secondary_price', '成本价': 'cost_price', '会员折扣': 'discountable',
  '库存': 'stock_quantity', '库存预警': 'stock_alert', '状态': 'status',
}

function downloadTemplate() {
  const demoRows = [
    ['矿泉水', 'KQS', '6901234567890', '瓶', '2', '箱', '24', '45', '1', '是', '120', '10', '上架'],
    ['可口可乐', 'KL', '6902345678901', '罐', '3', '提', '12', '33', '2', '是', '120', '12', '上架'],
    ['红牛', 'HN', '', '罐', '6', '', '', '', '4', '否', '50', '10', '上架'],
    ['纯牛奶', 'NN', '', '盒', '4', '', '', '', '3', '是', '0', '6', '下架'],
  ]
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...demoRows])
  ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 8 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '商品模板')
  XLSX.writeFile(wb, '商品导入模板.xlsx')
}

async function handleImportUpload({ file }: { file: { file: File } }) {
  if (!storeId.value) return
  importParsing.value = true
  importResult.value = null
  try {
    const buf = await file.file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const importRows = rows.map((r) => {
      const obj: Record<string, any> = {}
      for (const k of Object.keys(r)) {
        const field = HEADER_MAP[String(k).trim()]
        if (field) obj[field] = r[k]
      }
      return obj
    }).filter((p) => p.name || p.selling_price != null)
    if (!importRows.length) {
      toast.warning('未解析到有效数据')
      importParsing.value = false
      return
    }
    pendingImportRows.value = importRows
    importConfirmOverwrite.value = false
    importSubmit.reset()
    // 预检：检测已存在商品（不写库）
    const preview = await useApiFetch<{ total: number; existing_count: number; new_count: number; existing_items: any[] }>('/api/products/import', {
      method: 'POST',
      body: { store_id: storeId.value, products: importRows, dry_run: true },
    })
    if (preview.existing_count > 0) {
      importPreview.value = preview
      showImportConfirm.value = true
      return
    }
    // 无已存在商品，直接导入
    await submitImport(importRows, false)
  } catch (e: any) {
    toast.error(e?.data?.message || '导入失败')
  } finally {
    importParsing.value = false
  }
}

async function submitImport(rows: any[], overwrite: boolean) {
  importParsing.value = true
  try {
    const res = await importSubmit.post<{ success: number; failed: number; errors: any[] }>('/api/products/import', {
      store_id: storeId.value,
      products: rows,
      overwrite,
    })
    importResult.value = {
      success: res.success,
      failed: res.failed,
      errors: (res.errors || []).map((e: any) => ({ row: e.row, name: e.name, message: e.message })),
    }
    toast.success(`导入完成：成功 ${res.success} 条`)
    importSubmit.clear()
    await loadProducts()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(e?.data?.message || '导入失败')
  } finally {
    importParsing.value = false
  }
}

async function confirmImport() {
  const rows = pendingImportRows.value
  showImportConfirm.value = false
  await submitImport(rows, importConfirmOverwrite.value)
  pendingImportRows.value = []
  importPreview.value = null
}

function cancelImportConfirm() {
  showImportConfirm.value = false
  pendingImportRows.value = []
  importPreview.value = null
  importParsing.value = false
}
function finishImport() {
  showImportModal.value = false
  importResult.value = null
}

/* ---------------- init ---------------- */
watch(storeId, () => {
  products.value = []
  currentPage.value = 1
  Promise.allSettled([loadDefaultAlert(), loadProducts()])
})
onMounted(() => {
  Promise.allSettled([loadDefaultAlert(), loadProducts()])
})
onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
})
</script>

<style scoped>
.products-page { display: flex; flex-direction: column; gap: 12px; }
.empty-wrap { padding: 40px 0; display: flex; justify-content: center; }

.top-bar { display: flex; flex-direction: column; gap: 8px; }
.search-input { width: 100%; }
.top-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.top-actions .n-button { flex: 1; }

.alert-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff5f0;
  border: 1px solid #ffd9c4;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.alert-text { color: #ff6b00; font-size: 13px; font-weight: 600; }

.desktop-table { display: none; }
.mobile-cards { display: flex; flex-direction: column; gap: 8px; }
.product-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.pc-head { display: flex; justify-content: space-between; align-items: center; }
.pc-tail { display: flex; align-items: center; gap: 8px; }
.pc-expand { cursor: pointer; padding: 2px; display: inline-flex; align-items: center; }
.pc-name { font-size: 15px; font-weight: 600; color: #333; }
.pc-meta { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 12px; color: #999; }
.pc-price { color: #169c91; font-weight: 600; }
.pc-stock { display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #eee; font-size: 13px; }
.stock-val.up { color: #36c676; font-weight: 600; }
.stock-val.down { color: #f44336; font-weight: 600; }
.stock-alert { color: #999; }
.pc-actions { display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #eee; }

.mobile-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.pager-info { font-size: 13px; color: #999; }

/* desktop table cells */
.col-name { font-weight: 600; }
.col-stock.up { color: #36c676; }
.col-stock.down { color: #f44336; }

/* form */
.product-form .form-row { display: flex; gap: 12px; }
.product-form .form-row .n-form-item { flex: 1; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; }

/* readonly detail */
.detail-readonly { display: flex; flex-direction: column; }
.dr-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 4px;
  border-bottom: 1px solid #f4f4f4;
  font-size: 14px;
}
.dr-row:last-child { border-bottom: none; }
.dr-label { width: 96px; flex-shrink: 0; color: #888; }

/* stock modal */
.stock-form { display: flex; flex-direction: column; gap: 4px; }
.stock-tabs :deep(.n-tab-pane) { padding-top: 20px; }
.sf-current {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #f7f9fa;
  border-radius: 6px;
}
.sf-current-label { font-size: 13px; color: #666; }
.sf-current-value { font-size: 13px; color: #169C91; }

.sf-diff {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 4px;
  margin-top: -8px;
  margin-bottom: 12px;
  font-size: 13px;
}
.sf-diff.up { background: #f0fbf4; }
.sf-diff.up .sf-diff-value { color: #36c676; }
.sf-diff.down { background: #fef0f0; }
.sf-diff.down .sf-diff-value { color: #f44336; }
.sf-diff-label { color: #999; }
.sf-diff-value { font-weight: 600; }

/* import */
.import-modal { display: flex; flex-direction: column; gap: 14px; }
.import-instructions { font-size: 13px; color: #666; background: #f7f9fa; padding: 10px; border-radius: 8px; }
.import-instructions p { margin: 2px 0; }
.import-actions { display: flex; gap: 10px; }
.import-result { display: flex; flex-direction: column; gap: 8px; }
.import-errors { max-height: 180px; overflow-y: auto; border: 1px solid #f0f0f0; border-radius: 6px; padding: 6px; }
.import-error-row { font-size: 12px; color: #f44336; padding: 3px 0; border-bottom: 1px solid #fafafa; }
.import-confirm { display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.import-confirm p { margin: 0; }
.ic-num { color: #169c91; }

/* desktop */
@media (min-width: 768px) {
  .top-bar { flex-direction: row; align-items: center; }
  .search-input { max-width: 360px; }
  .top-actions { flex-wrap: nowrap; }
  .top-actions .n-button { flex: none; }
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
}
</style>
