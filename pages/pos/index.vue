<template>
  <div class="pos-page">
    <n-tabs v-model:value="activeTab" type="line" animated size="large" @update:value="onTabChange">
      <!-- ============ 开单 ============ -->
      <n-tab-pane name="order" tab="开单">
        <div v-if="!storeId" class="empty-wrap">
          <n-empty description="请先选择店铺" />
        </div>
        <div v-else class="order-layout">
          <!-- Main: barcode + cart -->
          <div class="order-main">
            <div class="scan-bar">
              <n-input
                ref="barcodeInputRef"
                v-model:value="scanText"
                placeholder="扫码 / 搜索商品名称 · 助记码"
                size="large"
                clearable
                class="scan-input"
                :input-props="{ autocomplete: 'off', inputmode: 'search' }"
                @update:value="onScanInput"
                @keydown.enter="onScan"
                @focus="onScanFocus"
              >
                <template #prefix>
                  <n-icon :component="SearchOutline" :size="18" color="#999" />
                </template>
              </n-input>
              <n-button v-if="scanResults.length" size="large" quaternary @click="scanResults = []">取消</n-button>
            </div>

            <!-- Search dropdown results -->
            <div v-if="scanResults.length" class="scan-results">
              <div
                v-for="p in scanResults"
                :key="p.id"
                class="scan-result-item"
                @click="addProductToCart(p)"
              >
                <div class="sr-name">{{ p.name }}</div>
                <div class="sr-meta">
                  <n-tag size="tiny" :bordered="false">{{ p.short_code }}</n-tag>
                  <span class="sr-unit">{{ p.primary_unit }}</span>
                  <span class="sr-price">¥{{ formatMoney(p.selling_price) }}</span>
                </div>
              </div>
            </div>

            <!-- Cart empty -->
            <div v-if="!cart.length && !scanResults.length" class="empty-wrap">
              <n-empty description="购物车为空，扫码或搜索商品开始开单" />
            </div>

            <!-- Cart: 桌面/移动二选一渲染，避免双 DOM 重复 -->
            <div v-if="cart.length && !isMobile" class="cart-desktop">
              <table class="cart-table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th style="width: 90px">单位</th>
                    <th style="width: 110px">单价</th>
                    <th style="width: 170px">数量</th>
                    <th style="width: 100px">小计</th>
                    <th style="width: 60px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in cart" :key="item.product_id">
                    <td>
                      <div class="ct-name">{{ item.product_name }}</div>
                      <div v-if="item.discountable === 1 && isVip" class="ct-vip">VIP折后</div>
                    </td>
                    <td>
                      <n-select
                        v-if="item.units.length > 1"
                        :value="item.product_unit"
                        :options="item.units.map((u: string) => ({ label: u, value: u }))"
                        size="small"
                        style="width: 84px"
                        @update:value="(v: string) => onUnitChange(item, v)"
                      />
                      <span v-else>{{ item.product_unit }}</span>
                    </td>
                    <td>
                      <n-input-number
                        :value="item.unit_price"
                        :precision="2"
                        :step="0.01"
                        :min="0"
                        size="small"
                        :show-button="false"
                        style="width: 96px"
                        @update:value="(v: number | null) => onPriceChange(item, v ?? 0)"
                      />
                    </td>
                    <td>
                      <div class="ct-qty">
                        <n-button circle size="small" @click="changeQty(item, -1)">−</n-button>
                        <n-input-number
                          :value="item.quantity"
                          :min="0.01"
                          :step="1"
                          :precision="2"
                          :show-button="false"
                          size="small"
                          style="width: 64px"
                          @update:value="(v: number | null) => onQtyChange(item, v ?? 0)"
                        />
                        <n-button circle size="small" @click="changeQty(item, 1)">+</n-button>
                      </div>
                    </td>
                    <td>
                      <div class="ct-sub-wrap">
                        <span class="ct-sub">¥{{ formatMoney(item.subtotal) }}</span>
                        <span v-if="isVip && item.discountable === 1" class="ct-vip-sub">折后 ¥{{ formatMoney(getPaySubtotal(item)) }}</span>
                      </div>
                    </td>
                    <td><n-button size="tiny" quaternary type="error" @click="removeFromCart(idx)">删除</n-button></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Cart mobile cards -->
            <div v-if="cart.length && isMobile" class="cart-mobile">
              <div v-for="(item, idx) in cart" :key="item.product_id" class="cart-card">
                <div class="cc-head">
                  <div class="cc-name">{{ item.product_name }}</div>
                  <n-button size="tiny" quaternary type="error" @click="removeFromCart(idx)">删除</n-button>
                </div>
                <div class="cc-row">
                  <div class="cc-field">
                    <span class="cc-label">单位</span>
                    <n-select
                      v-if="item.units.length > 1"
                      :value="item.product_unit"
                      :options="item.units.map((u: string) => ({ label: u, value: u }))"
                      size="small"
                      style="width: 84px"
                      @update:value="(v: string) => onUnitChange(item, v)"
                    />
                    <span v-else class="cc-value">{{ item.product_unit }}</span>
                  </div>
                  <div class="cc-field">
                    <span class="cc-label">单价</span>
                    <n-input-number
                      :value="item.unit_price"
                      :precision="2"
                      :step="0.01"
                      :min="0"
                      :show-button="false"
                      size="small"
                      style="width: 96px"
                      @update:value="(v: number | null) => onPriceChange(item, v ?? 0)"
                    />
                  </div>
                </div>
                <div class="cc-row cc-foot">
                  <div class="qty-group">
                    <n-button circle size="small" @click="changeQty(item, -1)">−</n-button>
                    <n-input-number
                      :value="item.quantity"
                      :min="0.01"
                      :step="1"
                      :precision="2"
                      :show-button="false"
                      size="small"
                      style="width: 70px"
                      @update:value="(v: number | null) => onQtyChange(item, v ?? 0)"
                    />
                    <n-button circle size="small" @click="changeQty(item, 1)">+</n-button>
                  </div>
                  <div class="cc-subtotal">¥{{ formatMoney(item.subtotal) }}</div>
                </div>
                <div v-if="item.discountable === 1 && isVip" class="cc-vip">折后 ¥{{ formatMoney(getPaySubtotal(item)) }}</div>
              </div>
            </div>
          </div>

          <!-- Side: member + total + actions -->
          <div class="order-side">
            <!-- Member -->
            <div class="member-box">
              <div v-if="!selectedMember" class="member-search">
                <div class="member-search-bar">
                  <n-input
                    v-model:value="memberSearchText"
                    placeholder="会员手机号 / 姓名"
                    clearable
                    size="medium"
                    :input-props="{ autocomplete: 'off' }"
                    @update:value="onMemberSearchInput"
                    @keydown.enter="onMemberSearchEnter"
                  >
                    <template #prefix><n-icon :component="PersonOutline" :size="17" /></template>
                  </n-input>
                </div>
                <div v-if="memberResults.length" class="member-results">
                  <div
                    v-for="m in memberResults"
                    :key="m.id"
                    class="member-result-item"
                    @click="selectMember(m)"
                  >
                    <span class="mr-name">{{ m.name }}</span>
                    <span class="mr-phone">{{ m.phone }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="member-card">
                <div class="mc-head">
                  <div>
                    <span class="mc-name">{{ selectedMember.name }}</span>
                    <n-tag v-if="selectedMember.level === 'vip'" size="tiny" type="warning" round>VIP</n-tag>
                    <n-tag v-else size="tiny" round>普通</n-tag>
                  </div>
                  <n-button size="tiny" quaternary @click="clearMember">取消</n-button>
                </div>
                <div class="mc-meta">
                  <span>{{ selectedMember.phone }}</span>
                </div>
                <div class="mc-balance">
                  <div><span class="mc-label">余额</span><span class="mc-val">¥{{ formatMoney(selectedMember.balance) }}</span></div>
                  <div><span class="mc-label">积分</span><span class="mc-val">{{ selectedMember.points }}</span></div>
                </div>
              </div>
            </div>

            <!-- Total + actions -->
            <div class="summary-box">
              <template v-if="isVip && vipDiscount > 0">
                <div class="summary-detail-row"><span>商品总额</span><span>¥{{ formatMoney(originalTotal) }}</span></div>
                <div class="summary-detail-row discount"><span>会员折扣</span><span>-¥{{ formatMoney(vipDiscount) }}</span></div>
              </template>
              <div :class="['summary-total', { 'has-border': isVip && vipDiscount > 0 }]">                <span class="st-label">合计</span>
                <span class="st-amount">¥{{ formatMoney(total) }}</span>
              </div>
              <div class="summary-actions">
                <n-button size="large" :disabled="!cart.length" @click="clearCart">清空</n-button>
                <n-button size="large" type="warning" :disabled="!cart.length" class="btn-checkout" @click="openPayment">
                  <span class="btn-checkout-icon">¥</span>
                  <span style="margin-left: 6px">结算</span>
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </n-tab-pane>

      <!-- ============ 退货 ============ -->
      <n-tab-pane name="return" tab="退货">
        <div v-if="!storeId" class="empty-wrap"><n-empty description="请先选择店铺" /></div>
        <div v-else class="return-tab">
          <div class="return-search">
            <n-input
              v-model:value="returnSearch"
              placeholder="输入订单号 或 会员手机号 / 姓名"
              clearable
              :input-props="{ autocomplete: 'off' }"
              @keydown.enter="searchReturns"
            />
            <n-button type="primary" :loading="returnLoading" @click="searchReturns">搜索</n-button>
          </div>

          <!-- Desktop table -->
          <div v-if="returnOrders.length" class="desktop-table">
            <n-data-table
              :columns="returnColumns"
              :data="returnOrders"
              :bordered="false"
              size="small"
              :max-height="500"
            />
          </div>

          <!-- Mobile cards -->
          <div v-if="returnOrders.length" class="mobile-cards">
            <div v-for="o in returnOrders" :key="o.id" class="order-card">
              <div class="oc-head">
                <div class="oc-head-left">
                  <span class="oc-id">#{{ o.id }}</span>
                  <span class="oc-time">{{ formatTime(o.created_at) }}</span>
                </div>
                <div class="oc-tail">
                  <span class="oc-amount">¥{{ formatMoney(o.payable_amount) }}</span>
                  <span class="oc-expand" @click="toggleExpand('ret-' + o.id)">
                    <n-icon :component="expandedMap['ret-' + o.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                  </span>
                </div>
              </div>
              <template v-if="expandedMap['ret-' + o.id]">
                <div class="oc-meta">
                  <span>{{ o.member_name || '散客' }}</span>
                  <span>{{ o.operator_name || '-' }}</span>
                </div>
                <div v-if="o.type === 'sale'" class="oc-actions">
                  <n-button size="small" quaternary type="warning" @click="loadReturnOrder(o.id)">退货</n-button>
                </div>
              </template>
            </div>
          </div>

          <n-modal
            v-model:show="showReturnModal"
            preset="card"
            :title="selectedReturnOrder ? `退货 #${selectedReturnOrder.id}` : '退货'"
            :style="{ width: '94%', maxWidth: '560px' }"
            :mask-closable="false"
          >
            <div v-if="selectedReturnOrder">
              <!-- Step 1: 选择退货商品 -->
              <div v-if="!returnItems.length" class="empty-wrap"><n-empty description="该订单无可退商品" /></div>
              <div v-else class="rd-items-card">
                <div v-for="ri in returnItems" :key="ri.item.id" class="rd-item-detail">
                  <div class="rdi-head-row">
                    <div class="rdi-name">{{ ri.item.product_name }}</div>
                    <span class="rdi-hint">可退 {{ ri.item.returnable_quantity }}{{ ri.item.base_unit }}</span>
                  </div>
                  <div class="rdi-input-row">
                    <span class="rdi-label">退货数量</span>
                    <n-input-number
                      v-model:value="ri.qty"
                      :min="0"
                      :max="ri.item.returnable_quantity"
                      :step="1"
                      :precision="2"
                      size="small"
                      style="width: 100px"
                      @update:value="(v: number | null) => onReturnQtyChange(ri, v ?? 0)"
                    />
                    <span class="rdi-hint">{{ ri.item.base_unit }}</span>
                    <span v-if="ri.qty > 0" class="rdi-refund-hint">退 ¥{{ formatMoney(ri.refund) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="returnItems.length" class="rd-footer">
                <div class="rd-footer-left">
                  <div class="rd-total">
                    <span>退款总额</span>
                    <n-input-number
                      v-model:value="returnTotalOverride"
                      :precision="2"
                      :step="0.01"
                      :min="0"
                      :show-button="false"
                      size="small"
                      style="width: 120px; text-align: right"
                    />
                  </div>
                  <div class="rd-refund-tags">
                    <span v-if="returnRefundPoints > 0" class="rd-refund-tag">退还积分 {{ returnRefundPoints }} (¥{{ formatMoney(returnRefundPointsValue) }})</span>
                    <span v-if="returnRefundBalance > 0" class="rd-refund-tag">退还余额 ¥{{ formatMoney(returnRefundBalance) }}</span>
                    <span class="rd-refund-tag rd-refund-cash">退还现金 ¥{{ formatMoney(returnTotalOverride - returnRefundPointsValue - returnRefundBalance) }}</span>
                  </div>
                </div>
                <n-button
                  type="warning"
                  size="large"
                  :disabled="returnSelectedCount === 0 || returnSubmitting"
                  :loading="returnSubmitting"
                  @click="confirmReturn"
                >
                  确认退货
                </n-button>
              </div>
            </div>
          </n-modal>
        </div>
      </n-tab-pane>

      <!-- ============ 流水 ============ -->
      <n-tab-pane name="history" tab="流水">
        <div v-if="!storeId" class="empty-wrap"><n-empty description="请先选择店铺" /></div>
        <div v-else class="history-tab">
          <div class="history-filters">
            <n-date-picker
              :value="historyDateRange"
              type="daterange"
              clearable
              size="small"
              class="hf-date"
              @update:value="onHistoryDateChange"
            />
            <n-select
              :value="historyType"
              :options="historyTypeOptions"
              size="small"
              class="hf-type"
              @update:value="onHistoryTypeChange"
            />
            <n-input
              v-model:value="historyMemberSearch"
              placeholder="会员手机/姓名"
              size="small"
              clearable
              class="hf-member"
              :input-props="{ autocomplete: 'off' }"
              @keydown.enter="onHistorySearch"
            />
            <n-button size="small" type="primary" :loading="historyLoading" @click="onHistorySearch">查询</n-button>
          </div>

          <!-- Desktop table -->
          <div class="desktop-table">
            <n-data-table
              :columns="historyColumns"
              :data="historyOrders"
              :loading="historyLoading"
              :bordered="false"
              size="small"
              :pagination="historyPagination"
              :row-class-name="historyRowClassName"
              remote
              @update:page="onHistoryPageChange"
            />
          </div>

          <!-- Mobile cards -->
          <div v-if="historyOrders.length" class="mobile-cards">
            <div v-for="o in historyOrders" :key="o.id" :class="['order-card', { 'order-card-highlight': highlightedOrderId === o.id }]">
              <div class="oc-head">
                <div class="oc-head-left">
                  <span class="oc-id">#{{ o.id }}</span>
                  <n-tag :type="o.type === 'sale' ? 'info' : 'error'" size="tiny" :bordered="false" round>{{ o.type === 'sale' ? '销售' : '退货' }}</n-tag>
                  <span class="oc-time">{{ formatTime(o.created_at) }}</span>
                </div>
                <div class="oc-tail">
                  <span :class="['oc-amount', o.type === 'return' ? 'refund' : '']">{{ o.type === 'return' ? `-¥${formatMoney(o.payable_amount)}` : `¥${formatMoney(o.payable_amount)}` }}</span>
                  <span class="oc-expand" @click="toggleExpand('his-' + o.id)">
                    <n-icon :component="expandedMap['his-' + o.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                  </span>
                </div>
              </div>
              <template v-if="expandedMap['his-' + o.id]">
                <div class="oc-meta">
                  <span>{{ o.member_name || '散客' }}</span>
                  <span>{{ o.operator_name || '-' }}</span>
                </div>
                <div class="oc-actions">
                  <n-button size="small" quaternary type="primary" @click="openHistoryDetail(o.id)">详情</n-button>
                </div>
              </template>
            </div>
            <div class="mobile-pager">
              <n-button size="small" :disabled="historyPage <= 1" @click="onHistoryPageChange(historyPage - 1)">上一页</n-button>
              <span class="pager-info">第 {{ historyPage }} 页 / 共 {{ historyTotalPages }} 页</span>
              <n-button size="small" :disabled="historyPage >= historyTotalPages" @click="onHistoryPageChange(historyPage + 1)">下一页</n-button>
            </div>
          </div>
        </div>
      </n-tab-pane>
    </n-tabs>

    <!-- ============ Payment Modal ============ -->
    <n-modal
      v-model:show="showPayment"
      :preset="paymentSuccess ? 'card' : 'card'"
      :title="paymentSuccess ? '收款成功' : '收款'"
      :style="{ width: '92%', maxWidth: '460px' }"
      :mask-closable="!paymentSuccess"
    >
      <div v-if="paymentSuccess && lastOrderResult" class="pay-success">
        <div class="pay-success-icon">
          <n-icon :component="CheckmarkCircle" size="56" color="#18a058" />
        </div>
        <div class="pay-success-title">收款成功</div>
        <div class="pay-success-sub">订单 #{{ lastOrderResult.order_id }} 已生成</div>
        <div v-if="lastOrderResult.change > 0 || lastOrderResult.points_earned > 0" class="pay-success-detail">
          <div v-if="lastOrderResult.change > 0" class="psd-row psd-change">
            <span>找零</span>
            <span class="psd-change-amount">¥{{ formatMoney(lastOrderResult.change) }}</span>
          </div>
          <div v-if="lastOrderResult.points_earned > 0" class="psd-row psd-points">
            <span>赠送积分</span>
            <span>+{{ lastOrderResult.points_earned }}</span>
          </div>
        </div>
      </div>
      <div v-else class="pay-modal">
        <div class="pay-summary">
          <template v-if="isVip && vipDiscount > 0">
            <div class="pay-summary-row"><span>商品总额</span><span>¥{{ formatMoney(originalTotal) }}</span></div>
            <div class="pay-summary-row discount"><span>会员折扣</span><span>-¥{{ formatMoney(vipDiscount) }}</span></div>
            <div class="pay-summary-row"><span>订单合计</span><span>¥{{ formatMoney(total) }}</span></div>
          </template>
          <div v-else class="pay-summary-row"><span>订单合计</span><span>¥{{ formatMoney(total) }}</span></div>
          <div class="pay-summary-row">
            <span>整单改价</span>
            <n-input-number
              v-model:value="payAmount"
              :precision="2"
              :step="0.01"
              :min="0"
              :max="total"
              :show-button="false"
              size="small"
              style="width: 110px; text-align: right"
            />
          </div>
          <div v-if="orderDiscount > 0" class="pay-summary-row discount">
            <span>店员改价</span><span>-¥{{ formatMoney(orderDiscount) }}</span>
          </div>
        </div>

        <div v-if="selectedMember && selectedMember.points > 0 && pointsEnabled" class="pay-section">
          <div class="pay-section-title">
            <n-checkbox v-model:checked="usePoints" size="small">积分抵扣</n-checkbox>
          </div>
          <div v-if="usePoints" class="pay-input-row">
            <n-input-number
              v-model:value="pointsAmount"
              :precision="0"
              :step="redeemAmount"
              :min="0"
              :max="maxPointsUsable"
              size="small"
              style="width: 150px"
              @blur="normalizePoints"
            />积分
            <span class="pay-avail">抵 ¥{{ formatMoney(pointsValue) }}, 共{{ selectedMember.points }}积分</span>
          </div>
        </div>

        <div v-if="selectedMember && selectedMember.balance > 0 && balanceEnabled" class="pay-section">
          <div class="pay-section-title">
            <n-checkbox v-model:checked="useBalance" size="small">使用余额</n-checkbox>
          </div>
          <div v-if="useBalance" class="pay-input-row">
            <n-input-number
              v-model:value="balanceAmount"
              :precision="2"
              :step="10"
              :min="0"
              :max="maxBalanceUsable"
              :show-button="false"
              size="small"
              style="width: 150px"
            />
            <span class="pay-avail">可用 ¥{{ formatMoney(selectedMember.balance) }}</span>
          </div>
        </div>

        <div class="pay-due-final">
          <span>应收现金</span>
          <span class="pay-due-amount">¥{{ formatMoney(cashNeed) }}</span>
        </div>
      </div>

      <template #footer>
        <div class="pay-footer">
          <template v-if="paymentSuccess">
            <n-button size="large" @click="viewHistoryAfter">查看流水</n-button>
            <n-button
              size="large"
              type="primary"
              class="btn-finish-pay"
              @click="finishPayment"
            >
              完成
            </n-button>
          </template>
          <template v-else>
            <n-button size="large" @click="showPayment = false">取消</n-button>
            <n-button
              size="large"
              type="primary"
              class="btn-confirm-pay"
              :loading="paySubmitting"
              :disabled="paySubmitting"
              @click="confirmPayment"
            >
              确认收款
            </n-button>
          </template>
        </div>
      </template>
    </n-modal>

    <!-- ============ History Detail Modal ============ -->
    <n-modal
      v-model:show="showHistoryDetail"
      preset="card"
      :title="historyDetail ? `${historyDetail.type === 'return' ? '退单' : '订单'} #${historyDetail.id}` : '订单'"
      :style="{ width: '94%', maxWidth: '600px' }"
    >
      <div v-if="historyDetail" class="hd-modal">
        <div class="hd-info-card">
          <div class="hd-info-grid">
            <div class="hd-info-row"><span class="hd-label">类型</span><n-tag :type="historyDetail.type === 'sale' ? 'info' : 'error'" size="small" :bordered="false">{{ historyDetail.type === 'sale' ? '销售' : '退货' }}</n-tag></div>
            <div class="hd-info-row"><span class="hd-label">会员</span>{{ historyDetail.member_name || '散客' }}{{ historyDetail.member_phone ? ` (${historyDetail.member_phone})` : '' }}</div>
            <div class="hd-info-row"><span class="hd-label">操作员</span>{{ historyDetail.operator_name || '-' }}</div>
            <div class="hd-info-row"><span class="hd-label">时间</span>{{ formatTime(historyDetail.created_at) }}</div>
            <div v-if="historyDetail.original_order_id" class="hd-info-row"><span class="hd-label">订单</span>#{{ historyDetail.original_order_id }}</div>
          </div>
        </div>
        <div class="hd-items-title">商品明细</div>
        <div class="hd-items">
          <div v-for="it in historyDetail.items" :key="it.id" class="hd-item">
            <div class="hdi-name">{{ it.product_name }}</div>
            <div class="hdi-meta">
              <template v-if="historyDetail.type === 'return'">
                <span>退 {{ it.base_quantity }}{{ it.base_unit }}</span>
                <span class="hdi-sub">¥{{ formatMoney(it.subtotal) }}</span>
              </template>
              <template v-else>
                <span>{{ it.quantity }}{{ it.product_unit }}</span>
                <span>× ¥{{ formatMoney(it.original_price) }}</span>
                <span class="hdi-sub">¥{{ formatMoney(round2(it.original_price * it.quantity)) }}</span>
              </template>
            </div>
          </div>
        </div>
        <div class="hd-items-title">{{ historyDetail.type === 'return' ? '退款明细' : '收款明细' }}</div>
        <div class="hd-pay-card">
          <template v-if="historyDetail.type === 'return'">
            <div class="hd-pay-row"><span>退款总额</span><span>¥{{ formatMoney(historyDetail.total_amount) }}</span></div>
            <div class="hd-pay-divider"></div>
            <div v-if="historyDetail.points_amount" class="hd-pay-row discount"><span>退还积分</span><span>{{ historyDetail.points_amount }}积分 (¥{{ formatMoney(historyDetail.points_value) }})</span></div>
            <div v-if="historyDetail.balance_amount" class="hd-pay-row discount"><span>退还余额</span><span>¥{{ formatMoney(historyDetail.balance_amount) }}</span></div>
            <div class="hd-pay-row hd-pay-total"><span>退还现金</span><span>¥{{ formatMoney(historyDetail.cash_amount) }}</span></div>
          </template>
          <template v-else>
            <div class="hd-pay-row"><span>商品总额</span><span>¥{{ formatMoney(historyDetail.total_amount) }}</span></div>
            <div v-if="historyDetail.member_discount > 0" class="hd-pay-row discount"><span>会员折扣</span><span>-¥{{ formatMoney(historyDetail.member_discount) }}</span></div>
            <div v-if="historyDetail.order_discount > 0" class="hd-pay-row discount"><span>店员改价</span><span>-¥{{ formatMoney(historyDetail.order_discount) }}</span></div>
            <div v-if="historyDetail.points_amount" class="hd-pay-row discount"><span>积分抵扣</span><span>-¥{{ formatMoney(historyDetail.points_value) }}</span></div>
            <div v-if="historyDetail.balance_amount" class="hd-pay-row discount"><span>使用余额</span><span>-¥{{ formatMoney(historyDetail.balance_amount) }}</span></div>
            <div class="hd-pay-row hd-pay-total"><span>现金支付</span><span>¥{{ formatMoney(historyDetail.cash_amount) }}</span></div>
            <div v-if="historyDetail.points_earned > 0" class="hd-pay-row earn"><span>获得积分</span><span>+{{ historyDetail.points_earned }}</span></div>
          </template>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import type { Product, Member, StoreSettings, Order, OrderItem } from '~/types'
import { NTag, NButton, NIcon, type DataTableColumns } from 'naive-ui'
import { SearchOutline, PersonOutline, ChevronDownOutline, ChevronUpOutline, CheckmarkCircle } from '@vicons/ionicons5'

definePageMeta({ layout: 'default' })

const authStore = useAuthStore()
const { storeId } = useStoreId()
const toast = useToast()
const { isMobile } = useIsMobile()

const expandedMap = ref<Record<string, boolean>>({})
function toggleExpand(key: string) {
  expandedMap.value = { ...expandedMap.value, [key]: !expandedMap.value[key] }
}

const route = useRoute()
const router = useRouter()
const tabFromQuery = (): 'order' | 'return' | 'history' | null => {
  const t = route.query.tab
  if (t === 'order' || t === 'return' || t === 'history') return t
  return null
}
const activeTab = ref<'order' | 'return' | 'history'>(tabFromQuery() ?? 'order')

/* ---------------- Settings ---------------- */
const settings = ref<StoreSettings | null>(null)
const vipMultiplier = computed(() => {
  const r = Number(settings.value?.vip_discount_rate)
  if (!r || Number.isNaN(r)) return 1
  return r > 1 ? r / 100 : r
})
const redeemAmount = computed(() => Number(settings.value?.points_redeem_amount) || 100)
const redeemValue = computed(() => Number(settings.value?.points_redeem_value) || 1)
const balanceEnabled = computed(() => Number(settings.value?.balance_payment_enabled) === 1)
const pointsEnabled = computed(() => Number(settings.value?.points_payment_enabled) === 1)

async function loadSettings() {
  if (!storeId.value) return
  try {
    settings.value = await useApiFetch<StoreSettings>('/api/settings', {
      query: { store_id: storeId.value },
    })
  } catch (e: any) {
    toast.error(apiErr(e))
  }
}

/* ---------------- Helpers ---------------- */
function formatTime(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 16)
}
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/* =====================================================
   开单 (Order)
===================================================== */
interface CartItem {
  product_id: number
  product_name: string
  product_unit: string
  units: string[]
  unit_price: number
  original_price: number
  quantity: number
  subtotal: number
  secondary_unit: string | null
  secondary_price: number | null
  conversion_rate: number | null
  primary_unit: string
  discountable: number
  cost_price: number | null
  stock_quantity: number
}

const barcodeInputRef = ref<any>(null)
const scanText = ref('')
const scanResults = ref<Product[]>([])
let lastPosQuery = ''
let posSeq = 0
const cart = ref<CartItem[]>([])

const selectedMember = ref<Member | null>(null)
const isVip = computed(() => selectedMember.value?.level === 'vip')

const memberSearchText = ref('')
const memberResults = ref<Member[]>([])


const total = computed(() =>
  round2(cart.value.reduce((s, c) => s + getPaySubtotal(c), 0)),
)
const originalTotal = computed(() =>
  round2(cart.value.reduce((s, c) => s + c.subtotal, 0)),
)
const vipDiscount = computed(() => round2(originalTotal.value - total.value))

/* ---- scan ---- */
let scanTimer: ReturnType<typeof setTimeout> | null = null
function onScanInput(val: string) {
  if (scanTimer) clearTimeout(scanTimer)
  const q = (val || '').trim()
  if (!q) {
    scanResults.value = []
    return
  }
  scanTimer = setTimeout(() => doSearch(q), 500)
}
function onScanFocus() {
  nextTick(() => {
    barcodeInputRef.value?.select?.()
  })
}
function onScan() {
  if (scanTimer) clearTimeout(scanTimer)
  const q = scanText.value.trim()
  if (!q) return
  searchAndAdd(q)
}
async function doSearch(q: string) {
  if (!storeId.value) return
  if (q === lastPosQuery && scanResults.value.length) return
  lastPosQuery = q
  const seq = ++posSeq
  try {
    const res = await useApiFetch<{ items: Product[]; total: number }>('/api/products', {
      query: { store_id: storeId.value, search: q, pageSize: 10, status: 'active', scope: 'pos' },
    })
    if (seq !== posSeq) return
    scanResults.value = res.items || []
  } catch (e: any) {
    if (seq !== posSeq) return
    toast.error(apiErr(e))
  }
}
async function searchAndAdd(q: string) {
  if (!storeId.value) return
  if (q === lastPosQuery && scanResults.value.length) {
    const list = scanResults.value
    if (list.length === 1) {
      addProductToCart(list[0])
      scanText.value = ''
      refocusBarcode()
    }
    return
  }
  lastPosQuery = q
  const seq = ++posSeq
  try {
    const res = await useApiFetch<{ items: Product[]; total: number }>('/api/products', {
      query: { store_id: storeId.value, search: q, pageSize: 10, status: 'active', scope: 'pos' },
    })
    if (seq !== posSeq) return
    const list = res.items || []
    if (!list.length) {
      toast.error('未找到商品')
      scanText.value = ''
      refocusBarcode()
      return
    }
    if (list.length === 1) {
      addProductToCart(list[0])
      scanText.value = ''
      refocusBarcode()
    } else {
      scanResults.value = list
    }
  } catch (e: any) {
    toast.error(apiErr(e))
    refocusBarcode()
  }
}
function refocusBarcode() {
  nextTick(() => {
    barcodeInputRef.value?.focus()
  })
}

function genIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

function cartFingerprint(items: CartItem[]): string {
  return items.map((c) => `${c.product_id || ''}:${c.quantity}:${c.unit_price}`).join('|')
}

function returnFingerprint(items: ReturnLine[]): string {
  return items.map((r) => `${r.item.id}:${r.qty}`).join('|')
}

function getOrCreatePaymentKey(): string {
  if (paymentIdempotencyKey.value) return paymentIdempotencyKey.value
  if (typeof window === 'undefined' || !storeId.value) {
    paymentIdempotencyKey.value = genIdempotencyKey()
    return paymentIdempotencyKey.value
  }
  const fp = cartFingerprint(cart.value)
  const slot = 'pos_pay_idem'
  try {
    const raw = sessionStorage.getItem(slot)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.storeId === storeId.value && parsed.fingerprint === fp && parsed.key) {
        paymentIdempotencyKey.value = parsed.key
        return parsed.key
      }
    }
  } catch {}
  const k = genIdempotencyKey()
  paymentIdempotencyKey.value = k
  try { sessionStorage.setItem(slot, JSON.stringify({ storeId: storeId.value, fingerprint: fp, key: k })) } catch {}
  return k
}

function clearPaymentKey() {
  paymentIdempotencyKey.value = ''
  if (typeof window !== 'undefined') {
    try { sessionStorage.removeItem('pos_pay_idem') } catch {}
  }
}

function getOrCreateReturnKey(): string {
  if (returnIdempotencyKey.value) return returnIdempotencyKey.value
  const orderId = selectedReturnOrder.value?.id
  if (typeof window === 'undefined' || !orderId) {
    returnIdempotencyKey.value = genIdempotencyKey()
    return returnIdempotencyKey.value
  }
  const fp = returnFingerprint(returnItems.value)
  const slot = `pos_ret_idem_${orderId}`
  try {
    const raw = sessionStorage.getItem(slot)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.fingerprint === fp && parsed.key) {
        returnIdempotencyKey.value = parsed.key
        return parsed.key
      }
    }
  } catch {}
  const k = genIdempotencyKey()
  returnIdempotencyKey.value = k
  try { sessionStorage.setItem(slot, JSON.stringify({ fingerprint: fp, key: k })) } catch {}
  return k
}

function clearReturnKey() {
  returnIdempotencyKey.value = ''
  if (typeof window !== 'undefined' && selectedReturnOrder.value) {
    try { sessionStorage.removeItem(`pos_ret_idem_${selectedReturnOrder.value.id}`) } catch {}
  }
}

/* ---- cart ---- */
function checkStock(item: CartItem, newQty: number): boolean {
  const unitIsSecondary = item.product_unit === item.secondary_unit && item.conversion_rate
  const stockNeeded = unitIsSecondary ? round2(newQty * item.conversion_rate!) : newQty
  if (stockNeeded > item.stock_quantity + 0.0001) {
    const primary = item.primary_unit || item.product_unit
    const secondary = item.secondary_unit
    const conv = item.conversion_rate
    const inSecondary = conv && secondary ? round2(item.stock_quantity / conv) : null
    const label = unitIsSecondary && inSecondary != null && secondary
      ? `剩余 ${item.stock_quantity}${primary}（约 ${inSecondary}${secondary}）`
      : `剩余 ${item.stock_quantity}${primary}`
    toast.warning(`「${item.product_name}」库存不足（${label}）`)
    return false
  }
  return true
}
function addProductToCart(p: Product) {
  if (p.status && p.status !== 'active') {
    toast.warning(`「${p.name}」已下架，无法加入购物车`)
    scanResults.value = []
    refocusBarcode()
    return
  }
  const existing = cart.value.find((c) => c.product_id === p.id)
  if (existing) {
    const newQty = round2(existing.quantity + 1)
    if (!checkStock(existing, newQty)) return
    existing.quantity = newQty
    recalcItem(existing)
    scanResults.value = []
    refocusBarcode()
    return
  }
  if (Number(p.stock_quantity) <= 0) {
    toast.warning(`「${p.name}」库存不足`)
    return
  }
  const units = [p.primary_unit]
  if (p.secondary_unit) units.push(p.secondary_unit)
  const item: CartItem = {
    product_id: p.id,
    product_name: p.name,
    product_unit: p.primary_unit,
    units,
    unit_price: round2(p.selling_price),
    original_price: round2(p.selling_price),
    quantity: 1,
    subtotal: round2(p.selling_price),
    secondary_unit: p.secondary_unit,
    secondary_price: p.secondary_price != null ? round2(p.secondary_price) : null,
    conversion_rate: p.conversion_rate != null ? Number(p.conversion_rate) : null,
    primary_unit: p.primary_unit,
    discountable: Number(p.discountable) || 0,
    cost_price: p.cost_price != null ? Number(p.cost_price) : null,
    stock_quantity: Number(p.stock_quantity) || 0,
  }
  recalcItem(item)
  cart.value.push(item)
  scanResults.value = []
  refocusBarcode()
}

function recalcItem(item: CartItem) {
  let base: number
  if (item.product_unit === item.secondary_unit && item.secondary_price != null) {
    base = item.secondary_price
  } else {
    base = item.original_price
  }
  item.unit_price = round2(base)
  item.subtotal = round2(item.unit_price * item.quantity)
}

function recalcAll() {
  cart.value.forEach(recalcItem)
}

watch(
  () => [selectedMember.value?.id, selectedMember.value?.level, vipMultiplier.value],
  () => recalcAll(),
)

function onUnitChange(item: CartItem, unit: string) {
  item.product_unit = unit
  recalcItem(item)
  // 切换单位后重新校验当前数量是否仍满足库存
  if (!checkStock(item, item.quantity)) {
    const unitIsSecondary = unit === item.secondary_unit && item.conversion_rate
    item.quantity = unitIsSecondary
      ? round2(item.stock_quantity / item.conversion_rate!)
      : item.stock_quantity
    item.subtotal = round2(item.unit_price * item.quantity)
  }
}
function onPriceChange(item: CartItem, v: number) {
  item.unit_price = round2(v)
  item.original_price = round2(v)
  item.subtotal = round2(item.unit_price * item.quantity)
}
function onQtyChange(item: CartItem, v: number) {
  if (!checkStock(item, v)) {
    // 回退到当前单位下的最大可买数量（主单位库存换算），而非把主单位库存当当前单位数量
    const unitIsSecondary = item.product_unit === item.secondary_unit && item.conversion_rate
    if (unitIsSecondary) {
      item.quantity = round2(item.stock_quantity / item.conversion_rate!)
    } else {
      item.quantity = item.stock_quantity
    }
  } else {
    item.quantity = round2(v)
  }
  item.subtotal = round2(item.unit_price * item.quantity)
}
function changeQty(item: CartItem, delta: number) {
  const newQty = round2(item.quantity + delta)
  if (!checkStock(item, newQty)) return
  item.quantity = newQty
  if (item.quantity < 0.01) item.quantity = 0.01
  item.subtotal = round2(item.unit_price * item.quantity)
}
function removeFromCart(idx: number) {
  cart.value.splice(idx, 1)
}
function clearCart() {
  if (!cart.value.length) return
  const dlg = (window as any).$dialog
  if (dlg) {
    dlg.warning({
      title: '确认清空',
      content: '清空购物车中所有商品？',
      positiveText: '清空',
      negativeText: '取消',
      onPositiveClick: () => { cart.value = [] },
    })
  } else {
    cart.value = []
  }
}

/* desktop cart is rendered via plain v-for table in the template */

/* ---- member ---- */
let memberTimer: ReturnType<typeof setTimeout> | null = null
function onMemberSearchInput(val: string) {
  
  memberResults.value = []
  if (memberTimer) clearTimeout(memberTimer)
  const q = (val || '').trim()
  if (!q) return
  if (/^\d+$/.test(q) && q.length < 3) return
  memberTimer = setTimeout(() => doMemberSearch(), 500)
}
function onMemberSearchEnter() {
  if (memberTimer) clearTimeout(memberTimer)
  doMemberSearch()
}
async function doMemberSearch() {
  const q = memberSearchText.value.trim()
  if (!q || !storeId.value) return
  try {
    const res = await useApiFetch<{ items: Member[]; total: number }>('/api/members', {
      query: { store_id: storeId.value, search: q, pageSize: 10 },
    })
    memberResults.value = res.items || []
    
  } catch (e: any) {
    toast.error(apiErr(e))
  }
}
function selectMember(m: Member) {
  selectedMember.value = m
  memberResults.value = []
  memberSearchText.value = ''
  
}
function clearMember() {
  selectedMember.value = null
  memberResults.value = []
  memberSearchText.value = ''
  
}

/* ---- payment ---- */
const showPayment = ref(false)
const useBalance = ref(false)
const balanceAmount = ref(0)
const usePoints = ref(false)
const pointsAmount = ref(0)
const paySubmitting = ref(false)
const paymentSuccess = ref(false)
const lastOrderResult = ref<{ order_id: number; total_amount: number; change: number; points_earned: number; cash_received: number } | null>(null)
let paymentResetTimer: ReturnType<typeof setTimeout> | null = null

watch(paymentSuccess, (v) => {
  if (v) {
    nextTick(() => {
      const el = document.querySelector('.btn-finish-pay') as HTMLElement | null
      el?.focus()
    })
  }
})
const paymentIdempotencyKey = ref('')

const payAmount = ref(0)

const payableAmount = computed(() => round2(payAmount.value))
const orderDiscount = computed(() => round2(Math.max(0, total.value - payAmount.value)))

const maxPointsUsable = computed(() => {
  if (!selectedMember.value || !pointsEnabled.value) return 0
  const maxByMember = Math.floor(selectedMember.value.points / redeemAmount.value) * redeemAmount.value
  const maxByAmount = Math.floor(payableAmount.value / redeemValue.value) * redeemAmount.value
  return Math.min(maxByMember, maxByAmount)
})
const maxBalanceUsable = computed(() => {
  if (!selectedMember.value || !balanceEnabled.value) return 0
  const remaining = Math.max(0, round2(payableAmount.value - pointsValue.value))
  return Math.min(selectedMember.value.balance, remaining)
})

const balanceUsed = computed(() => {
  if (!useBalance.value) return 0
  return Math.min(balanceAmount.value || 0, maxBalanceUsable.value)
})
const effectivePointsAmount = computed(() => {
  if (!usePoints.value || !selectedMember.value) return 0
  const step = Math.max(1, redeemAmount.value)
  const floored = Math.floor((pointsAmount.value || 0) / step) * step
  return Math.max(0, Math.min(floored, maxPointsUsable.value))
})
const pointsValue = computed(() => round2(effectivePointsAmount.value / redeemAmount.value * redeemValue.value))

const cashNeed = computed(() => {
  const remain = round2(payableAmount.value - balanceUsed.value - pointsValue.value)
  return remain > 0 ? remain : 0
})

function openPayment() {
  if (!cart.value.length) return
  if (paymentResetTimer) {
    clearTimeout(paymentResetTimer)
    paymentResetTimer = null
  }
  paymentSuccess.value = false
  lastOrderResult.value = null
  payAmount.value = total.value
  usePoints.value = false
  useBalance.value = false
  pointsAmount.value = 0
  balanceAmount.value = 0
  showPayment.value = true
  paymentIdempotencyKey.value = genIdempotencyKey()
  if (typeof window !== 'undefined' && storeId.value) {
    const fp = cartFingerprint(cart.value)
    try {
      sessionStorage.setItem('pos_pay_idem', JSON.stringify({ storeId: storeId.value, fingerprint: fp, key: paymentIdempotencyKey.value }))
    } catch {}
  }
}

watch(usePoints, (v) => {
  if (v && selectedMember.value) {
    pointsAmount.value = maxPointsUsable.value
  } else {
    pointsAmount.value = 0
  }
})
watch(useBalance, (v) => {
  if (v && selectedMember.value) {
    balanceAmount.value = maxBalanceUsable.value
  } else {
    balanceAmount.value = 0
  }
})

function normalizePoints() {
  const step = Math.max(1, redeemAmount.value)
  let v = pointsAmount.value || 0
  if (v <= 0) {
    pointsAmount.value = 0
    return
  }
  if (v < step) v = step
  else v = Math.floor(v / step) * step
  pointsAmount.value = Math.max(0, Math.min(v, maxPointsUsable.value))
}

function getItemDiscountShare(item: CartItem): number {
  if (total.value <= 0) return 0
  return round2(orderDiscount.value * (getPaySubtotal(item) / total.value))
}
function getPayUnitPrice(item: CartItem): number {
  if (isVip.value && item.discountable === 1) {
    return round2(item.unit_price * vipMultiplier.value)
  }
  return round2(item.unit_price)
}
function getPaySubtotal(item: CartItem): number {
  return round2(getPayUnitPrice(item) * item.quantity)
}

async function confirmPayment() {
  if (!storeId.value) return
  paySubmitting.value = true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const payload = {
      store_id: storeId.value,
      member_id: selectedMember.value?.id ?? null,
      items: cart.value.map((c) => ({
        product_id: c.product_id,
        product_name: c.product_name,
        product_unit: c.product_unit,
        unit_price: getPayUnitPrice(c),
        original_price: c.unit_price,
        quantity: c.quantity,
        base_quantity: c.product_unit === c.secondary_unit && c.conversion_rate
          ? round2(c.quantity * c.conversion_rate)
          : c.quantity,
        base_unit: c.primary_unit,
        cost_price: c.cost_price,
        discount_amount: getItemDiscountShare(c),
      })),
      cash_amount: cashNeed.value,
      balance_amount: useBalance.value ? balanceUsed.value : 0,
      points_amount: usePoints.value ? effectivePointsAmount.value : 0,
      order_discount: orderDiscount.value,
      idempotency_key: getOrCreatePaymentKey(),
    }
    const res = await useApiFetch<{ order_id: number; total_amount: number; change: number; points_earned: number }>(
      '/api/orders',
      { method: 'POST', body: payload, signal: controller.signal },
    )
    clearTimeout(timer)
    lastOrderResult.value = {
      order_id: res.order_id,
      total_amount: res.total_amount,
      change: res.change,
      points_earned: res.points_earned,
      cash_received: cashNeed.value,
    }
    paymentSuccess.value = true
    cart.value = []
    selectedMember.value = null
    historyPage.value = 1
    // 仅 history tab 可见时刷新；切 tab 时 onTabChange 会自行加载，避免每单一次全店 COUNT
    if (activeTab.value === 'history') loadHistory()
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || controller.signal.aborted) {
      toast.error('网络超时，可重新点击确认收款，系统会自动避免重复')
    } else {
      const status = e?.statusCode ?? e?.response?.status ?? e?.data?.statusCode
      if (status && status >= 400 && status < 500) {
        toast.error(apiErr(e))
        clearPaymentKey()
      } else {
        toast.error(`${apiErr(e)}，可重新点击确认收款，系统会自动避免重复`)
      }
    }
  } finally {
    clearTimeout(timer)
    paySubmitting.value = false
  }
}

function finishPayment() {
  showPayment.value = false
  clearPaymentKey()
  nextTick(() => refocusBarcode())
}

function viewHistoryAfter() {
  const orderId = lastOrderResult.value?.order_id
  if (orderId) {
    highlightedOrderId.value = orderId
    setTimeout(() => { highlightedOrderId.value = null }, 3000)
  }
  showPayment.value = false
  clearPaymentKey()
  activeTab.value = 'history'
  historyPage.value = 1
  loadHistory()
  nextTick(() => refocusBarcode())
}

watch(showPayment, (v) => {
  if (!v) {
    // 延迟到关闭动画结束后再重置成功态，避免关闭瞬间闪出确认收款界面
    if (paymentResetTimer) clearTimeout(paymentResetTimer)
    paymentResetTimer = setTimeout(() => {
      paymentSuccess.value = false
      lastOrderResult.value = null
      paymentResetTimer = null
    }, 250)
  } else if (paymentResetTimer) {
    clearTimeout(paymentResetTimer)
    paymentResetTimer = null
  }
})

/* =====================================================
   退货 (Return)
===================================================== */
const returnSearch = ref('')
const returnOrders = ref<Order[]>([])
const returnLoading = ref(false)
const selectedReturnOrder = ref<Order | null>(null)
const showReturnModal = ref(false)
const returnSubmitting = ref(false)
const returnIdempotencyKey = ref('')

interface ReturnLine { item: OrderItem; qty: number; refund: number }
const returnItems = ref<ReturnLine[]>([])

function getItemRefund(item: OrderItem, qty: number): number {
  if (!selectedReturnOrder.value) return 0
  const ratio = item.base_quantity > 0 ? qty / item.base_quantity : 0
  const itemPayable = round2(item.subtotal - (item.discount_amount || 0))
  return round2(itemPayable * ratio)
}
function onReturnQtyChange(ri: ReturnLine, qty: number) {
  ri.qty = qty
  ri.refund = getItemRefund(ri.item, qty)
}

const returnSelectedCount = computed(() => returnItems.value.filter((r) => r.qty > 0).length)
const returnComputedTotal = computed(() =>
  round2(returnItems.value.filter((r) => r.qty > 0).reduce((s, r) => s + (r.refund || 0), 0)),
)
const returnTotalOverride = ref(0)
watch(returnComputedTotal, (v) => { returnTotalOverride.value = v })

const returnRatio = computed(() => {
  const allBaseQty = returnItems.value.reduce((s, r) => s + r.item.base_quantity, 0)
  const selectedBaseQty = returnItems.value.filter((r) => r.qty > 0).reduce((s, r) => s + r.qty, 0)
  return allBaseQty > 0 ? selectedBaseQty / allBaseQty : 0
})
const returnRefundPointsValue = computed(() => {
  if (!selectedReturnOrder.value?.points_amount) return 0
  return round2(selectedReturnOrder.value.points_value * returnRatio.value)
})
const returnRefundPoints = computed(() => {
  if (returnRefundPointsValue.value <= 0) return 0
  const redeemAmount = Number(settings.value?.points_redeem_amount) || 100
  const redeemValue = Number(settings.value?.points_redeem_value) || 1
  return Math.round(returnRefundPointsValue.value / redeemValue * redeemAmount)
})
const returnRefundBalance = computed(() => {
  if (!selectedReturnOrder.value?.balance_amount) return 0
  return round2(selectedReturnOrder.value.balance_amount * returnRatio.value)
})

const returnColumns = computed<DataTableColumns<Order>>(() => [
  { title: '单号', key: 'id', width: 80, render: (r) => `#${r.id}` },
  { title: '会员', key: 'member_name', width: 100, render: (r) => r.member_name || '散客' },
  { title: '金额', key: 'amount', width: 90, render: (r) => `¥${formatMoney(r.payable_amount)}` },
  { title: '操作员', key: 'operator_name', width: 80, render: (r) => r.operator_name || '-' },
  { title: '时间', key: 'created_at', width: 150, render: (r) => formatTime(r.created_at) },
  {
    title: '操作', key: 'actions', width: 70,
    render: (r) => r.type === 'sale' ? h(NButton, { size: 'small', quaternary: true, type: 'warning', onClick: () => loadReturnOrder(r.id) }, { default: () => '退货' }) : '-',
  },
])

async function searchReturns() {
  if (!storeId.value) return
  const q = returnSearch.value.trim()
  returnLoading.value = true
  try {
    if (!q) {
      const res = await useApiFetch<{ items: Order[]; total: number }>('/api/orders', {
        query: { store_id: storeId.value, type: 'sale', page: 1, pageSize: 50 },
      })
      returnOrders.value = res.items || []
      return
    }
    if (/^\d+$/.test(q)) {
      try {
        const o = await useApiFetch<Order & { items: OrderItem[] }>(`/api/orders/${q}`)
        if (o && o.type === 'sale') {
          returnOrders.value = [o]
          return
        }
      } catch {
        /* fall through to member search */
      }
    }
    const res = await useApiFetch<{ items: Order[]; total: number }>('/api/orders', {
      query: { store_id: storeId.value, type: 'sale', search: q, page: 1, pageSize: 50 },
    })
    returnOrders.value = res.items || []
    if (!returnOrders.value.length) toast.info('未找到匹配订单')
  } catch (e: any) {
    toast.error(apiErr(e))
  } finally {
    returnLoading.value = false
  }
}
async function loadReturnOrder(id: number) {
  try {
    const o = await useApiFetch<Order & { items: OrderItem[] }>(`/api/orders/${id}`)
    selectedReturnOrder.value = o
    returnItems.value = (o.items || [])
      .filter((it) => it.product_id != null)
      .map((it) => ({ item: it, qty: 0, refund: 0 }))
    showReturnModal.value = true
    returnIdempotencyKey.value = genIdempotencyKey()
    if (typeof window !== 'undefined') {
      try { sessionStorage.setItem(`pos_ret_idem_${o.id}`, JSON.stringify({ fingerprint: '', key: returnIdempotencyKey.value })) } catch {}
    }
  } catch (e: any) {
    toast.error(apiErr(e))
  }
}

function closeReturnDetail() {
  showReturnModal.value = false
  selectedReturnOrder.value = null
  returnItems.value = []
}
async function confirmReturn() {
  if (!selectedReturnOrder.value) return
    const selected = returnItems.value.filter((r) => r.qty > 0)
    if (!selected.length) {
      toast.warning('请输入退货数量')
      return
    }
    const totalRefund = returnTotalOverride.value
    const totalRefundable = round2(selected.reduce((s, r) => s + (r.refund || 0), 0))
    const items = selected.map((r) => {
      const share = totalRefundable > 0 ? round2(totalRefund * ((r.refund || 0) / totalRefundable)) : 0
      return { order_item_id: r.item.id, quantity: r.qty, refund_amount: share }
    })
  returnSubmitting.value = true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await useApiFetch<{ return_order_id: number; refund_amount: number }>(
      `/api/orders/${selectedReturnOrder.value.id}/return`,
      { method: 'POST', body: { items, refund_amount: returnTotalOverride.value, idempotency_key: getOrCreateReturnKey() }, signal: controller.signal },
    )
    toast.success(`退货成功！退款 ¥${formatMoney(res.refund_amount)}`)
    clearReturnKey()
    closeReturnDetail()
    await searchReturns()
    historyPage.value = 1
    if (activeTab.value === 'history') loadHistory()
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || controller.signal.aborted) {
      toast.error('网络超时，可重新点击确认退货，系统会自动避免重复')
    } else {
      toast.error(apiErr(e))
      clearReturnKey()
    }
  } finally {
    clearTimeout(timer)
    returnSubmitting.value = false
  }
}

/* =====================================================
   流水 (History)
===================================================== */
function defaultHistoryRange(): [number, number] {
  const now = new Date()
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  startDay.setDate(startDay.getDate() - 29)
  const start = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate(), 0, 0, 0, 0).getTime()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime()
  return [start, end]
}
const historyDateRange = ref<[number, number] | null>(defaultHistoryRange())
const historyType = ref<'all' | 'sale' | 'return'>('all')
const historyMemberSearch = ref('')
const historyOrders = ref<Order[]>([])
const highlightedOrderId = ref<number | null>(null)
const historyLoading = ref(false)
const historyPage = ref(1)
const historyTotal = ref(0)
const historyPageSize = 20
const historyTypeOptions = [
  { label: '全部', value: 'all' },
  { label: '销售', value: 'sale' },
  { label: '退货', value: 'return' },
]

const showHistoryDetail = ref(false)
const historyDetail = ref<Order | null>(null)

const historyPagination = computed(() => ({
  page: historyPage.value,
  pageSize: historyPageSize,
  itemCount: historyTotal.value,
  showSizePicker: false,
}))

const historyTotalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyPageSize)))

const historyColumns = computed<DataTableColumns<Order>>(() => [
  { title: '单号', key: 'id', width: 80, render: (r) => `#${r.id}` },
  {
    title: '类型', key: 'type', width: 70,
    render: (r) => h(NTag, { type: r.type === 'sale' ? 'info' : 'error', size: 'small', round: true, bordered: false }, { default: () => (r.type === 'sale' ? '销售' : '退货') }),
  },
  { title: '会员', key: 'member_name', width: 100, render: (r) => r.member_name || '散客' },
  { title: '金额', key: 'amount', width: 90, render: (r) => (r.type === 'return' ? `-¥${formatMoney(r.payable_amount)}` : `¥${formatMoney(r.payable_amount)}`) },
  { title: '操作员', key: 'operator_name', width: 70, render: (r) => r.operator_name || '-' },
  { title: '时间', key: 'created_at', width: 150, render: (r) => formatTime(r.created_at) },
  {
    title: '详情', key: 'actions', width: 70,
    render: (r) => h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openHistoryDetail(r.id) }, { default: () => '详情' }),
  },
])

function onHistoryDateChange(v: [number, number] | null) {
  historyDateRange.value = v
  historyPage.value = 1
  loadHistory()
}
function onHistoryTypeChange(v: 'all' | 'sale' | 'return') {
  historyType.value = v
  historyPage.value = 1
  loadHistory()
}
function onHistorySearch() {
  historyPage.value = 1
  loadHistory()
}
function onHistoryPageChange(page: number) {
  historyPage.value = page
  loadHistory()
}
function historyRowClassName(row: Order) {
  return highlightedOrderId.value === row.id ? 'history-row-highlight' : ''
}

async function loadHistory() {
  if (!storeId.value) return
  historyLoading.value = true
  try {
    const qParams: Record<string, any> = {
      store_id: storeId.value,
      page: historyPage.value,
      pageSize: historyPageSize,
    }
    if (historyType.value !== 'all') qParams.type = historyType.value
    if (historyDateRange.value) {
      const [from, to] = historyDateRange.value
      qParams.date_from = `${new Date(from).getFullYear()}-${pad(new Date(from).getMonth() + 1)}-${pad(new Date(from).getDate())}`
      qParams.date_to = `${new Date(to).getFullYear()}-${pad(new Date(to).getMonth() + 1)}-${pad(new Date(to).getDate())}`
    }
    if (historyMemberSearch.value.trim()) qParams.search = historyMemberSearch.value.trim()
    const res = await useApiFetch<{ items: Order[]; total: number }>('/api/orders', { query: qParams })
    historyOrders.value = res.items || []
    if (res.total >= 0) historyTotal.value = res.total
  } catch (e: any) {
    toast.error(apiErr(e))
  } finally {
    historyLoading.value = false
  }
}
async function openHistoryDetail(id: number) {
  try {
    historyDetail.value = await useApiFetch<Order & { items: OrderItem[] }>(`/api/orders/${id}`)
    showHistoryDetail.value = true
  } catch (e: any) {
    toast.error(apiErr(e))
  }
}

/* ---------------- Tab change & init ---------------- */
function onTabChange(tab: string) {
  if (tab === 'history') loadHistory()
  router.replace({ query: { ...route.query, tab } })
}

watch(
  () => route.query.tab,
  (t) => {
    if (t === 'order' || t === 'return' || t === 'history') {
      if (activeTab.value !== t) {
        activeTab.value = t
        onTabChange(t)
      }
    }
  }
)

watch(storeId, () => {
  cart.value = []
  selectedMember.value = null
  returnOrders.value = []
  selectedReturnOrder.value = null
  historyOrders.value = []
  loadSettings()
  if (activeTab.value === 'order') refocusBarcode()
})

onMounted(() => {
  const tasks: Promise<any>[] = [loadSettings()]
  if (activeTab.value === 'history') tasks.push(loadHistory())
  Promise.allSettled(tasks)
  nextTick(() => {
    if (activeTab.value === 'order') refocusBarcode()
  })
})
onBeforeUnmount(() => {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null }
  if (memberTimer) { clearTimeout(memberTimer); memberTimer = null }
})
</script>

<style scoped>
.pos-page {
  padding-bottom: 12px;
}
.empty-wrap {
  padding: 40px 0;
  display: flex;
  justify-content: center;
}

/* ---------- Order layout ---------- */
.order-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.scan-bar {
  display: flex;
  gap: 8px;
  position: relative;
}
.scan-input :deep(input) {
  font-size: 16px;
}
.scan-results {
  margin-top: -4px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  max-height: 280px;
  overflow-y: auto;
  z-index: 2;
}
.scan-result-item {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}
.scan-result-item:active { background: #f7f9fa; }
.sr-name { font-size: 14px; color: #333; }
.sr-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; font-size: 12px; color: #999; }
.sr-price { color: #169c91; font-weight: 600; }

/* cart mobile cards */
.cart-mobile { display: flex; flex-direction: column; gap: 10px; }
.cart-desktop { display: none; }
.cart-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}
.cart-table th, .cart-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
  vertical-align: middle;
}
.cart-table thead th {
  background: #f7f9fa;
  font-weight: 600;
  color: #666;
}
.cart-table tbody tr:last-child td { border-bottom: none; }
.cart-table .ct-name { font-weight: 600; color: #333; }
.cart-table .ct-vip { font-size: 11px; color: #ffb740; margin-top: 2px; }
.cart-table .ct-qty { display: flex; align-items: center; gap: 6px; }
.cart-table .ct-sub { color: #f44336; font-weight: 600; }
.ct-sub-wrap { display: flex; flex-direction: column; }
.ct-vip-sub { font-size: 11px; color: #ffb740; }
.cart-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.cc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cc-name { font-size: 15px; font-weight: 600; color: #333; }
.cc-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; }
.cc-field { display: flex; align-items: center; gap: 6px; }
.cc-label { font-size: 12px; color: #999; }
.cc-value { font-size: 14px; color: #333; }
.cc-foot { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #eee; }
.qty-group { display: flex; align-items: center; gap: 8px; }
.cc-subtotal { font-size: 16px; font-weight: 700; color: #f44336; }
.cc-vip { margin-top: 6px; font-size: 11px; color: #ffb740; }

/* side panel */
.order-side { display: flex; flex-direction: column; gap: 12px; }
.member-box { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
.member-search { position: relative; }
.member-search-bar { display: flex; gap: 4px; align-items: center; }
.member-results {
  margin-top: 8px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}
.member-result-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #f5f5f5; cursor: pointer; }
.member-result-item:active { background: #f7f9fa; }
.mr-name { font-size: 14px; font-weight: 600; }
.mr-phone { font-size: 13px; color: #999; }
.member-card { }
.mc-head { display: flex; justify-content: space-between; align-items: center; }
.mc-name { font-size: 16px; font-weight: 600; margin-right: 6px; }
.mc-meta { font-size: 13px; color: #999; margin-top: 4px; }
.mc-balance { display: flex; gap: 20px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #f0f0f0; }
.mc-label { font-size: 12px; color: #999; margin-right: 6px; }
.mc-val { font-size: 15px; font-weight: 600; color: #169c91; }

.summary-box {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  position: sticky;
  bottom: 0;
}
.summary-total { display: flex; justify-content: space-between; align-items: center; }
.summary-total.has-border { padding-top: 8px; border-top: 1px solid #f0f0f0; margin-top: 4px; }
.st-label { font-size: 14px; color: #666; }
.st-amount { font-size: 26px; font-weight: 800; color: #f44336; }
.summary-detail-row { display: flex; justify-content: space-between; font-size: 13px; color: #999; padding: 2px 0; }
.summary-detail-row.discount { color: #ff9800; }
.summary-actions { display: flex; gap: 8px; margin-top: 12px; }
.summary-actions .n-button { flex: none; }
.btn-checkout { font-weight: 700; font-size: 16px; flex: 1; }
.btn-checkout-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

/* ---------- Return tab ---------- */
.return-tab { display: flex; flex-direction: column; gap: 12px; }
.return-search { display: flex; gap: 8px; }
.return-search .n-input { max-width: 360px; }
/* ---------- Return tab ---------- */
.return-detail { display: flex; flex-direction: column; gap: 12px; }
.rd-head { display: flex; align-items: center; gap: 10px; }
.rd-info-card {
  background: #f7f9fa;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
}
.rd-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
.rd-info-row { color: #666; }
.rd-info-label { color: #999; margin-right: 6px; }
.rd-items-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.rd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px 12px;
}
.rdi-info { flex: 1; }
.rdi-name { font-weight: 600; }
.rdi-meta { display: flex; gap: 12px; font-size: 12px; color: #999; margin-top: 2px; }
.rd-item-detail {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.rdi-head-row { display: flex; justify-content: space-between; align-items: center; }
.rdi-input-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.rdi-label { font-size: 14px; color: #666; width: 70px; }
.rdi-hint { font-size: 12px; color: #999; }
.rd-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  position: sticky;
  bottom: 0;
  flex-wrap: wrap;
  gap: 12px;
}
.rd-total { display: flex; align-items: center; gap: 8px; }
.rd-total > span { width: 70px; font-size: 14px; color: #666; flex-shrink: 0; }
.rd-total .n-input-number { flex: none; width: 120px; }
.rd-footer-left { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.rd-refund-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.rd-refund-tag { font-size: 12px; color: #999; background: #f5f5f5; padding: 2px 8px; border-radius: 4px; }
.rd-refund-cash { color: #f44336; background: #fff0f0; }
.rdi-refund-hint { font-size: 13px; color: #f44336; font-weight: 600; margin-left: auto; }

@media (max-width: 767px) {
  .rd-footer { flex-direction: column; align-items: stretch; }
  .rd-footer > .n-button { width: 100%; }
  .rd-total { justify-content: space-between; }
  .rd-total > span { width: auto; }
}

/* ---------- History tab ---------- */
.history-tab { display: flex; flex-direction: column; gap: 10px; }
.history-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.hf-date { flex: 1; min-width: 200px; max-width: 280px; }
.hf-type { width: 110px; }
.hf-member { width: 150px; }

.desktop-table { display: none; }
.mobile-cards { display: flex; flex-direction: column; gap: 8px; }
.order-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
}
.oc-head { display: flex; justify-content: space-between; align-items: center; }
.oc-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oc-tail { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.oc-expand { cursor: pointer; padding: 2px; display: inline-flex; align-items: center; }
.oc-id { font-size: 15px; font-weight: 600; color: #333; }
.oc-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 13px; color: #666; }
.oc-amount { font-weight: 700; color: #333; }
.oc-amount.refund { color: #f44336; }
.oc-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
}
.oc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
  font-size: 12px;
  color: #999;
}
.oc-time { }
.mobile-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.pager-info { font-size: 13px; color: #999; }

@media (max-width: 767px) {
  .hf-date { flex-basis: 100%; max-width: none; }
  .hf-type,
  .hf-member {
    flex: 1;
    min-width: 0;
    width: auto;
  }
  .history-filters > .n-button {
    flex-basis: 100%;
  }
}
.hi-amount { font-weight: 700; color: #333; }
.hi-amount.refund { color: #f44336; }
.history-link { color: #169c91; cursor: pointer; font-size: 13px; }
.history-link:hover { text-decoration: underline; }

/* ---------- Payment modal ---------- */
.pay-modal { display: flex; flex-direction: column; gap: 12px; }
.pay-summary {
  background: #f7f9fa;
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pay-summary-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #666; }
.pay-summary-row.discount { color: #f44336; }
.pay-summary-total { font-size: 16px; font-weight: 700; color: #333; padding-top: 8px; border-top: 1px solid #e5e7eb; }
.pay-total-amount { font-size: 24px; font-weight: 800; color: #f44336; }

.pay-section {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px 14px;
}
.pay-section-title { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.pay-input-row { display: flex; align-items: center; gap: 8px; }
.pay-avail { font-size: 12px; color: #999; }

.pay-due-final {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f0fbf4;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 700;
}
.pay-due-amount { font-size: 24px; font-weight: 800; color: #f44336; }
.pay-footer { display: flex; gap: 10px; justify-content: flex-end; }

/* ---------- History detail modal ---------- */
.hd-modal { display: flex; flex-direction: column; gap: 12px; }
.hd-info-card {
  background: #f7f9fa;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
}
.hd-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
.hd-info-row { color: #666; }
.hd-label { color: #999; margin-right: 6px; }
.hd-items-title { font-weight: 600; font-size: 14px; }
.hd-items { display: flex; flex-direction: column; gap: 4px; }
.hd-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff; border: 1px solid #f5f5f5; border-radius: 8px; }
.hdi-name { font-weight: 400; }
.hdi-meta { display: flex; gap: 12px; font-size: 12px; color: #999; }
.hdi-sub { color: #f44336; font-weight: 600; }
.hd-pay-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  background: #f7f9fa;
  border-radius: 10px;
  padding: 12px 16px;
}
.hd-pay-row { display: flex; justify-content: space-between; color: #666; }
.hd-pay-row.discount { color: #f44336; }
.hd-pay-row.earn { color: #169c91; }
.hd-pay-total { font-weight: 700; font-size: 15px; color: #333; padding-top: 6px; border-top: 1px solid #e5e7eb; }
.hd-pay-divider, .rd-pay-divider { height: 1px; background: #e5e7eb; margin: 6px 0; }

/* ---------- Desktop ---------- */
@media (min-width: 768px) {
  .order-layout {
    flex-direction: row;
    align-items: flex-start;
  }
  .order-main { flex: 1; min-width: 0; }
  .order-side {
    width: 320px;
    flex-shrink: 0;
    position: sticky;
    top: 70px;
  }
  .cart-mobile { display: none; }
  .cart-desktop { display: block; }
  .summary-box { position: static; }
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
}

/* ============ Payment success state ============ */
.pay-success {
  text-align: center;
  padding: 8px 0 4px;
}
.pay-success-icon {
  margin-bottom: 8px;
}
.pay-success-title {
  font-size: 20px;
  font-weight: 600;
  color: #18a058;
  margin-bottom: 4px;
}
.pay-success-sub {
  font-size: 13px;
  color: #666;
  margin-bottom: 16px;
}
.pay-success-detail {
  text-align: left;
  background: #f7f8fa;
  border-radius: 8px;
  padding: 12px 16px;
}
.psd-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 14px;
}
.psd-row span:first-child { color: #666; }
.psd-row span:last-child { font-variant-numeric: tabular-nums; font-weight: 500; }
.psd-change {
  color: #d03050;
  font-weight: 600;
}
.psd-change-amount {
  font-size: 18px;
}
.psd-points { color: #2080f0; }

@keyframes highlight-flash {
  0% { background-color: #fff7d6; }
  70% { background-color: #fff7d6; }
  100% { background-color: transparent; }
}
:deep(.history-row-highlight td) {
  background-color: #fff7d6 !important;
  animation: highlight-flash 3s ease-out;
}
.order-card-highlight {
  background-color: #fff7d6 !important;
  animation: highlight-flash 3s ease-out;
  border-color: #f0c020 !important;
}
</style>
