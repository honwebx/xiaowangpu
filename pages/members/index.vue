<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">会员管理</h2>
    </div>

    <div class="toolbar">
      <n-input
        v-model:value="search"
        placeholder="搜索姓名/手机号"
        clearable
        class="search-input"
        @keyup.enter="onSearch"
        @clear="onSearch"
      />
      <n-button type="primary" @click="onSearch">搜索</n-button>
      <div class="spacer" />
      <n-button type="warning" @click="openNew">+ 新增会员</n-button>
    </div>

    <n-spin :show="loading">
      <div v-if="!members.length && !loading" class="empty">暂无会员</div>
      <!-- Mobile cards -->
      <div v-if="members.length" class="mobile-cards">
<div
          v-for="m in members"
          :key="m.id"
          class="member-card"
        >
          <div class="mc-top">
            <div class="mc-head-left">
              <span class="mc-name">{{ m.name }}</span>
              <span class="mc-phone">{{ m.phone }}</span>
            </div>
            <div class="mc-tail">
              <n-tag :type="levelTagType(m.level)" size="small" round>{{ levelLabel(m.level) }}</n-tag>
              <span class="mc-expand" @click="toggleExpand(m.id)">
                <n-icon :component="expandedMap[m.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
              </span>
            </div>
          </div>
          <template v-if="expandedMap[m.id]">
            <div class="mc-row"><span class="mc-label">积分</span><span>{{ m.points ?? 0 }}</span></div>
            <div class="mc-row"><span class="mc-label">余额</span><span>¥{{ fmtMoney(m.balance) }}</span></div>
            <div class="mc-row mc-foot">注册: {{ fmtDate(m.created_at) }}</div>
            <div class="mc-actions">
              <n-button size="small" quaternary type="primary" @click="openDetail(m)">编辑</n-button>
              <n-button size="small" quaternary type="error" @click="onDeleteMemberRow(m)">删除</n-button>
            </div>
          </template>
        </div>
        <div class="mobile-pager">
          <n-button size="small" :disabled="memberPage <= 1" @click="onMemberPageChange(memberPage - 1)">上一页</n-button>
          <span class="pager-info">第 {{ memberPage }} 页 / 共 {{ totalPages }} 页</span>
          <n-button size="small" :disabled="memberPage >= totalPages" @click="onMemberPageChange(memberPage + 1)">下一页</n-button>
        </div>
      </div>
      <!-- Desktop table -->
      <div v-if="members.length" class="desktop-table">
        <n-data-table
          :columns="columns"
          :data="members"
          :loading="loading"
          :scroll-x="900"
          :bordered="false"
          size="small"
          :pagination="memberPagination"
          remote
          @update:page="onMemberPageChange"
        />
      </div>
    </n-spin>

    <!-- detail modal -->
    <n-modal
      v-model:show="detailVisible"
      preset="card"
      :title="detail ? `会员：${detail.name}` : '会员详情'"
      :style="detailModalStyle"
      :body-style="detailBodyStyle"
      :bordered="false"
      :mask-closable="true"
    >
      <n-spin :show="detailLoading">
        <div v-if="detail">
        <n-tabs v-model:value="activeTab" type="line" animated @update:value="onDetailTabChange">
          <n-tab-pane name="info" tab="信息">
            <n-form ref="infoFormRef" :model="infoModel" :rules="infoRules" label-placement="top" size="medium">
              <n-grid :cols="isMobile ? 1 : 2" :x-gap="16" :y-gap="12">
                <n-form-item-gi label="姓名" path="name">
                  <n-input v-model:value="infoModel.name" placeholder="请输入姓名" />
                </n-form-item-gi>
                <n-form-item-gi label="手机号" path="phone">
                  <n-input v-model:value="infoModel.phone" placeholder="请输入手机号" />
                </n-form-item-gi>
                <n-form-item-gi label="生日" path="birthday">
                  <n-date-picker v-model:value="infoModel.birthday" type="date" value-format="yyyy-MM-dd" clearable style="width:100%" />
                </n-form-item-gi>
                <n-form-item-gi label="等级" path="level">
                  <n-select v-model:value="infoModel.level" :options="levelOptions" />
                </n-form-item-gi>
                <n-form-item-gi label="备注" path="notes" :span="isMobile ? 1 : 2">
                  <n-input v-model:value="infoModel.notes" type="textarea" :autosize="{ minRows: 2 }" />
                </n-form-item-gi>
              </n-grid>
              <div class="form-actions">
                <n-button type="primary" :loading="infoSaving" :disabled="infoSaving" @click="saveInfo">保存</n-button>
              </div>
            </n-form>
          </n-tab-pane>

          <n-tab-pane name="points" tab="积分">
            <div class="big-stat">
              <div class="bs-info">
                <div class="big-stat-label">当前积分</div>
                <div class="big-stat-value">{{ detail.points ?? 0 }}</div>
              </div>
              <div class="bs-actions">
                <n-button type="primary" size="small" @click="openGiftPoints">赠送</n-button>
                <n-button size="small" @click="openRedeemPoints">兑换</n-button>
              </div>
            </div>
            <!-- Desktop table -->
            <div class="desktop-table">
              <n-data-table :columns="pointLogColumns" :data="detail.pointLogs ?? []" :scroll-x="700" size="small" :bordered="false" :pagination="{ pageSize: 20 }" />
            </div>
            <!-- Mobile cards -->
            <div class="mobile-cards">
              <div v-for="log in pointLogsPaged" :key="log.id" class="log-card">
                <div class="lc-head">
                  <div class="lc-head-left">
                    <n-tag :type="pointTagType(log.type)" size="tiny" :bordered="false" round>{{ pointTypeLabel(log.type) }}</n-tag>
                    <span class="lc-time">{{ fmtDateTime(log.created_at) }}</span>
                  </div>
                  <div class="lc-tail">
                    <span :class="['lc-change', (log.type === 'redeem' || log.type === 'deduct') ? 'down' : 'up']">
                      {{ (log.type === 'redeem' || log.type === 'deduct') ? `-${Math.abs(log.amount)}` : `+${Math.abs(log.amount)}` }}
                    </span>
                    <span class="lc-expand" @click="toggleLogExpand(log.id)">
                      <n-icon :component="logExpandedMap[log.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                    </span>
                  </div>
                </div>
                <template v-if="logExpandedMap[log.id]">
                  <div class="lc-meta">
                    <span>余 {{ log.balance_after }}</span>
                    <span>操作员 {{ log.operator_name || '-' }}</span>
                  </div>
                  <div class="lc-notes">{{ log.related_order_id ? `订单#${log.related_order_id}` : (log.notes || '-') }}</div>
                </template>
              </div>
              <div v-if="(detail.pointLogs ?? []).length" class="mobile-pager">
                <n-button size="small" :disabled="pointLogPage <= 1" @click="pointLogPage--">上一页</n-button>
                <span class="pager-info">第 {{ pointLogPage }} 页 / 共 {{ logTotalPages(detail.pointLogs ?? []) }} 页</span>
                <n-button size="small" :disabled="pointLogPage >= logTotalPages(detail.pointLogs ?? [])" @click="pointLogPage++">下一页</n-button>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="balance" tab="余额">
            <div class="big-stat">
              <div class="bs-info">
                <div class="big-stat-label">当前余额</div>
                <div class="big-stat-value">¥{{ fmtMoney(detail.balance) }}</div>
              </div>
              <div class="bs-actions">
                <n-button type="warning" size="small" @click="openRecharge">充值</n-button>
                <n-button type="error" size="small" ghost @click="openConsume">余额消费</n-button>
              </div>
            </div>
            <!-- Desktop table -->
            <div class="desktop-table">
              <n-data-table :columns="balanceLogColumns" :data="detail.balanceLogs ?? []" :scroll-x="800" size="small" :bordered="false" :pagination="{ pageSize: 20 }" />
            </div>
            <!-- Mobile cards -->
            <div class="mobile-cards">
              <div v-for="log in balanceLogsPaged" :key="log.id" class="log-card">
                <div class="lc-head">
                  <div class="lc-head-left">
                    <n-tag :type="balanceTagType(log.type)" size="tiny" :bordered="false" round>{{ balanceTypeLabel(log) }}</n-tag>
                    <span class="lc-time">{{ fmtDateTime(log.created_at) }}</span>
                  </div>
                  <div class="lc-tail">
                    <span :class="['lc-change', balanceTotal(log) < 0 ? 'down' : 'up']">{{ balanceTotal(log) < 0 ? '-' : '+' }}¥{{ fmtMoney(Math.abs(balanceTotal(log))) }}</span>
                    <span class="lc-expand" @click="toggleLogExpand(log.id)">
                      <n-icon :component="logExpandedMap[log.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                    </span>
                  </div>
                </div>
                <template v-if="logExpandedMap[log.id]">
                  <div class="lc-meta">
                    <span>本金 {{ balanceSign(log) }}¥{{ fmtMoney(Math.abs(Number(log.amount || 0))) }}</span>
                    <span v-if="Number(log.bonus_amount || 0)">赠金 {{ log.source_log_id != null ? '-' : '+' }}¥{{ fmtMoney(Math.abs(Number(log.bonus_amount || 0))) }}</span>
                    <span>余 ¥{{ fmtMoney(log.balance_after) }}</span>
                    <span>操作员 {{ log.operator_name || '-' }}</span>
                  </div>
                  <div class="lc-notes">{{ log.related_order_id ? `订单#${log.related_order_id}` : (log.notes || '-') }}</div>
                  <div v-if="canRevertBalance(log) && isOwnRecord(log.operator_id)" class="lc-actions">
                    <n-button size="tiny" quaternary type="warning" @click="openRevertBalance(log)">回退</n-button>
                  </div>
                </template>
              </div>
              <div v-if="(detail.balanceLogs ?? []).length" class="mobile-pager">
                <n-button size="small" :disabled="balanceLogPage <= 1" @click="balanceLogPage--">上一页</n-button>
                <span class="pager-info">第 {{ balanceLogPage }} 页 / 共 {{ logTotalPages(detail.balanceLogs ?? []) }} 页</span>
                <n-button size="small" :disabled="balanceLogPage >= logTotalPages(detail.balanceLogs ?? [])" @click="balanceLogPage++">下一页</n-button>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="count" tab="计次">
            <div style="margin-bottom: 12px;">
              <n-button type="primary" size="small" @click="openAssignService">分配计次项目</n-button>
            </div>
            <div v-if="!(detail.memberServices ?? []).length" class="empty">暂无计次项目</div>
            <!-- Desktop table -->
            <div v-if="(detail.memberServices ?? []).length" class="desktop-table">
              <n-data-table :columns="memberServiceColumns" :data="detail.memberServices ?? []" :scroll-x="700" size="small" :bordered="false" :pagination="{ pageSize: 20 }" />
            </div>
            <div class="mobile-cards">
              <div v-for="ms in (detail.memberServices ?? [])" :key="ms.id" class="count-card">
                <div class="cc-main">
                  <div class="cc-name">{{ ms.service_name }}</div>
                  <div class="cc-meta">
                    <span>剩余 {{ ms.remaining_count }} / {{ ms.total_count }}</span>
                    <span v-if="ms.expires_at">到期: {{ fmtDate(ms.expires_at) }}</span>
                  </div>
                </div>
                <n-button size="small" type="primary" :disabled="(ms.remaining_count ?? 0) <= 0" @click="openDeduct(ms)">扣次</n-button>
              </div>
            </div>
            <h4 class="sub-title">扣次记录</h4>
            <!-- Desktop table -->
            <div class="desktop-table">
              <n-data-table :columns="countUsageColumns" :data="detail.countUsageLogs ?? []" :scroll-x="800" size="small" :bordered="false" :pagination="{ pageSize: 20 }" />
            </div>
            <!-- Mobile cards -->
            <div class="mobile-cards">
              <div v-for="log in countUsageLogsPaged" :key="log.id" class="log-card">
                <div class="lc-head">
                  <div class="lc-head-left">
                    <span :class="['lc-change', log.deduction_count > 0 ? 'down' : 'up']">
                      {{ log.deduction_count < 0 ? `+${Math.abs(log.deduction_count)}` : `-${log.deduction_count}` }}次
                    </span>
                    <span class="lc-time">{{ fmtDateTime(log.created_at) }}</span>
                  </div>
                  <div class="lc-tail">
                    <span class="lc-expand" @click="toggleLogExpand(log.id)">
                      <n-icon :component="logExpandedMap[log.id] ? ChevronUpOutline : ChevronDownOutline" size="18" color="#999" />
                    </span>
                  </div>
                </div>
                <template v-if="logExpandedMap[log.id]">
                  <div class="lc-meta">
                    <span>剩余 {{ log.remaining_after }} 次</span>
                    <span>操作员 {{ log.operator_name || '-' }}</span>
                  </div>
                  <div v-if="log.deduction_count > 0 && isOwnRecord(log.operator_id)" class="lc-actions">
                    <n-button size="tiny" quaternary type="warning" @click="onRevertDeduct(log)">回退</n-button>
                  </div>
                </template>
              </div>
              <div v-if="(detail.countUsageLogs ?? []).length" class="mobile-pager">
                <n-button size="small" :disabled="countUsagePage <= 1" @click="countUsagePage--">上一页</n-button>
                <span class="pager-info">第 {{ countUsagePage }} 页 / 共 {{ logTotalPages(detail.countUsageLogs ?? []) }} 页</span>
                <n-button size="small" :disabled="countUsagePage >= logTotalPages(detail.countUsageLogs ?? [])" @click="countUsagePage++">下一页</n-button>
              </div>
            </div>
          </n-tab-pane>

          </n-tabs>
        </div>
        <div v-else-if="!detailLoading" style="text-align:center;padding:40px 0;color:#999;">加载失败</div>
      </n-spin>
    </n-modal>
    <n-modal v-model:show="formVisible" preset="card" title="新增会员" :style="formModalStyle" :bordered="false" :mask-closable="!formSaving">
      <n-form ref="formRef" :model="formModel" :rules="formRules" label-placement="top">
        <n-grid :cols="isMobile ? 1 : 2" :x-gap="16" :y-gap="12">
          <n-form-item-gi label="姓名" path="name">
            <n-input v-model:value="formModel.name" placeholder="请输入姓名" />
          </n-form-item-gi>
          <n-form-item-gi label="手机号" path="phone">
            <n-input v-model:value="formModel.phone" placeholder="请输入手机号" />
          </n-form-item-gi>
          <n-form-item-gi label="生日" path="birthday">
            <n-date-picker v-model:value="formModel.birthday" type="date" value-format="yyyy-MM-dd" clearable style="width:100%" />
          </n-form-item-gi>
          <n-form-item-gi label="等级" path="level">
            <n-select v-model:value="formModel.level" :options="levelOptions" />
          </n-form-item-gi>
          <n-form-item-gi label="备注" path="notes" :span="isMobile ? 1 : 2">
            <n-input v-model:value="formModel.notes" type="textarea" :autosize="{ minRows: 2 }" />
          </n-form-item-gi>
        </n-grid>
        <div class="form-actions">
          <n-button @click="formVisible = false">取消</n-button>
          <n-button type="primary" :loading="formSaving" :disabled="formSaving" @click="saveMember">保存</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- recharge modal -->
    <n-modal v-model:show="rechargeVisible" preset="card" title="会员充值" :style="formModalStyle" :bordered="false" :mask-closable="!rechargeSaving">
      <n-form label-placement="top">
        <n-form-item label="充值金额">
          <n-input-number v-model:value="rechargeModel.amount" :min="0" :step="50" :precision="2" :show-button="false" style="width:100%" />
        </n-form-item>
        <n-form-item label="赠送金额">
          <n-input-number v-model:value="rechargeModel.bonus_amount" :min="0" :step="10" :precision="2" :show-button="false" style="width:100%" placeholder="赠送金额（选填，默认0）" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="rechargeModel.notes" placeholder="备注（选填）" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="rechargeVisible = false">取消</n-button>
          <n-button type="warning" :loading="rechargeSaving" :disabled="rechargeSaving" @click="submitRecharge">充值</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- consume modal -->
    <n-modal v-model:show="consumeVisible" preset="card" title="余额消费" :style="formModalStyle" :bordered="false" :mask-closable="!consumeSaving">
      <n-form label-placement="top">
        <n-form-item label="消费金额">
          <n-input-number v-model:value="consumeModel.amount" :min="0" :max="detail?.balance || 0" :step="10" :precision="2" :show-button="false" style="width:100%" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="consumeModel.notes" placeholder="备注（选填）" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="consumeVisible = false">取消</n-button>
          <n-button type="error" :loading="consumeSaving" :disabled="consumeSaving" @click="submitConsume">确认消费</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- revert balance modal -->
    <n-modal v-model:show="revertBalanceVisible" preset="card" :title="revertTarget ? `回退流水 #${revertTarget.id}` : '回退流水'" :style="formModalStyle" :bordered="false" :mask-closable="!revertBalanceSaving">
      <div v-if="revertTarget" class="deduct-info">
        <div>类型：{{ revertTarget.type === 'recharge' ? '充值' : '消费' }}</div>
        <div>本金：¥{{ fmtMoney(revertTarget.amount) }}</div>
        <div v-if="revertTarget.type === 'recharge' && Number(revertTarget.bonus_amount || 0) > 0">赠金：¥{{ fmtMoney(revertTarget.bonus_amount) }}</div>
        <div>已回退：¥{{ fmtMoney(revertedAmount) }}</div>
      </div>
      <n-form label-placement="top" style="margin-top: 12px;">
        <n-form-item v-if="revertTarget?.type === 'recharge'" label="退本金">
          <n-input-number v-model:value="revertBalanceModel.amount" :min="0" :max="revertMaxAmount" :step="10" :precision="2" :show-button="false" style="width:100%" />
        </n-form-item>
        <n-form-item v-if="revertTarget?.type === 'recharge' && revertMaxBonus > 0" label="退赠金">
          <n-input-number v-model:value="revertBalanceModel.bonus_amount" :min="0" :max="revertMaxBonus" :step="10" :precision="2" :show-button="false" style="width:100%" />
        </n-form-item>
        <n-form-item v-if="revertTarget?.type === 'consume'" label="退金额">
          <n-input-number v-model:value="revertBalanceModel.amount" :min="0" :max="revertMaxAmount" :step="10" :precision="2" :show-button="false" style="width:100%" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="revertBalanceModel.notes" placeholder="备注（选填）" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="revertBalanceVisible = false">取消</n-button>
          <n-button type="warning" :loading="revertBalanceSaving" :disabled="revertBalanceSaving" @click="submitRevertBalance">确认回退</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- gift points modal -->
    <n-modal v-model:show="giftPointsVisible" preset="card" title="赠送积分" :style="formModalStyle" :bordered="false" :mask-closable="!giftPointsSaving">
      <div class="adjust-current">
        <span class="adjust-label">当前积分</span>
        <span class="adjust-value">{{ detail?.points ?? 0 }}</span>
      </div>
      <n-form label-placement="top" style="margin-top: 16px;">
        <n-form-item label="赠送数量">
          <n-input-number v-model:value="giftPointsModel.amount" :min="10" :step="10" :precision="0" style="width:100%" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="giftPointsModel.notes" placeholder="赠送原因（选填）" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="giftPointsVisible = false">取消</n-button>
          <n-button type="primary" :loading="giftPointsSaving" :disabled="giftPointsSaving" @click="submitGiftPoints">确认赠送</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- redeem points modal -->
    <n-modal v-model:show="redeemPointsVisible" preset="card" title="兑换积分" :style="formModalStyle" :bordered="false" :mask-closable="!redeemPointsSaving">
      <div class="adjust-current">
        <span class="adjust-label">当前积分</span>
        <span class="adjust-value">{{ detail?.points ?? 0 }}</span>
      </div>
      <n-form label-placement="top" style="margin-top: 16px;">
        <n-form-item label="兑换数量">
          <n-input-number v-model:value="redeemPointsModel.amount" :min="10" :max="detail?.points || 0" :step="10" :precision="0" style="width:100%" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="redeemPointsModel.notes" placeholder="兑换原因（选填）" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="redeemPointsVisible = false">取消</n-button>
          <n-button type="primary" :loading="redeemPointsSaving" :disabled="redeemPointsSaving" @click="submitRedeemPoints">确认兑换</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- assign service modal -->
    <n-modal v-model:show="assignServiceVisible" preset="card" title="分配计次项目" :style="formModalStyle" :bordered="false" :mask-closable="!assignServiceSaving">
      <n-form label-placement="top">
        <n-form-item label="选择项目">
          <n-select v-model:value="assignServiceModel.service_id" :options="availableServiceOptions" placeholder="选择计次项目" />
        </n-form-item>
        <n-form-item label="实收金额">
          <n-input-number v-model:value="assignServiceModel.paid_amount" :min="0" :step="10" :precision="2" :show-button="false" style="width:100%" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="assignServiceVisible = false">取消</n-button>
          <n-button type="primary" :loading="assignServiceSaving" :disabled="assignServiceSaving" @click="submitAssignService">确认分配</n-button>
        </div>
      </n-form>
    </n-modal>

    <!-- deduct count modal -->
    <n-modal v-model:show="deductVisible" preset="card" title="扣减次数" :style="formModalStyle" :bordered="false" :mask-closable="!deductSaving">
      <div v-if="deductTarget" class="deduct-info">
        <div>项目名称：{{ deductTarget.service_name }}</div>
        <div>剩余数量：{{ deductTarget.remaining_count }}</div>
      </div>
      <n-form label-placement="top">
        <n-form-item label="扣减次数">
          <n-input-number v-model:value="deductCount" :min="1" :max="deductTarget?.remaining_count || 1" :step="1" :precision="0" style="width:100%" />
        </n-form-item>
        <div class="form-actions">
          <n-button @click="deductVisible = false">取消</n-button>
          <n-button type="primary" :loading="deductSaving" :disabled="deductSaving" @click="submitDeduct">确认扣次</n-button>
        </div>
      </n-form>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NTag, NButton, type DataTableColumns, type FormInst, type FormRules } from 'naive-ui'
import { ChevronDownOutline, ChevronUpOutline } from '@vicons/ionicons5'
import type { Member, PointLog, BalanceLog, MemberCountService, MemberCountServiceView } from '~/types'

definePageMeta({ layout: 'default' })

const { isMobile } = useIsMobile()
const { storeId, requireStoreId } = useStoreId()
const toast = useToast()
const authStore = useAuthStore()
function isOwnRecord(operatorId: number | null | undefined): boolean {
  if (authStore.userRole.value !== 'clerk') return true
  return operatorId != null && Number(operatorId) === Number(authStore.user.value?.id)
}

const expandedMap = ref<Record<number, boolean>>({})
function toggleExpand(id: number) {
  expandedMap.value = { ...expandedMap.value, [id]: !expandedMap.value[id] }
}

const logExpandedMap = ref<Record<number, boolean>>({})
function toggleLogExpand(id: number) {
  logExpandedMap.value = { ...logExpandedMap.value, [id]: !logExpandedMap.value[id] }
}

const loading = ref(false)
const members = ref<(Member & { level?: string })[]>([])
const search = ref('')

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-'
  return s.slice(0, 10)
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '-'
  return s.length >= 16 ? s.slice(0, 16) : s
}
const fmtMoney = formatMoney

function balanceTypeLabel(r: any): string {
  const isRevert = r.source_log_id != null
  const map: Record<string, string> = { recharge: '充值', consume: '消费', refund: '退款' }
  const label = map[r.type as string] || r.type
  return isRevert ? `${label}·回退` : label
}
function balanceTagType(type: string): any {
  const map: Record<string, any> = { recharge: 'success', consume: 'warning', refund: 'info' }
  return map[type] || 'default'
}
function balanceSign(r: any): string {
  return r.type === 'consume' || r.source_log_id != null ? '-' : '+'
}
function balanceTotal(r: any): number {
  return Number(r.amount || 0) + Number(r.bonus_amount || 0)
}
function canRevertBalance(r: any): boolean {
  return r.source_log_id == null && r.amount > 0
    && (r.type === 'recharge' || (r.type === 'consume' && r.related_order_id == null))
}
function pointTagType(type: string): any {
  if (type === 'earn') return 'success'
  if (type === 'redeem') return 'warning'
  if (type === 'deduct') return 'error'
  return 'info'
}
function pointTypeLabel(type: string): string {
  const map: Record<string, string> = { earn: '获取', redeem: '兑换', refund: '退还', deduct: '扣除' }
  return map[type] || type
}

const levelOptions = [
  { label: '普通会员', value: 'normal' },
  { label: 'VIP', value: 'vip' },
]
function levelLabel(l?: string | null): string {
  if (l === 'vip') return 'VIP'
  if (l === 'normal') return '普通'
  return '-'
}
function levelTagType(l?: string | null): 'warning' | 'default' {
  if (l === 'vip') return 'warning'
  return 'default'
}

const totalMembers = ref(0)
const memberPage = ref(1)
const memberPageSize = 20
let memberSeq = 0

const memberPagination = computed(() => ({
  page: memberPage.value,
  pageSize: memberPageSize,
  itemCount: totalMembers.value,
  showSizePicker: false,
}))

const totalPages = computed(() => Math.max(1, Math.ceil(totalMembers.value / memberPageSize)))

async function loadMembers() {
  if (!storeId.value) {
    members.value = []
    return
  }
  const session = ++memberSeq
  loading.value = true
  try {
    const res = await useApiFetch<{ items: any[]; total: number }>('/api/members', {
      query: {
        store_id: storeId.value,
        search: search.value.trim() || undefined,
        page: memberPage.value,
        pageSize: memberPageSize,
      },
    })
    if (session !== memberSeq) return
    members.value = res.items || []
    if (res.total >= 0) totalMembers.value = res.total
  } catch (e) {
    if (session !== memberSeq) return
    toast.error(apiErr(e))
  } finally {
    if (session === memberSeq) loading.value = false
  }
}

function onSearch() {
  memberPage.value = 1
  loadMembers()
}

function onMemberPageChange(page: number) {
  memberPage.value = page
  loadMembers()
}

const columns = computed<DataTableColumns<any>>(() => [
  { title: '姓名', key: 'name', width: 120 },
  { title: '手机号', key: 'phone', width: 140 },
  {
    title: '等级', key: 'level', width: 90,
    render: (r) => h(NTag, { type: levelTagType(r.level), size: 'small', round: true }, { default: () => levelLabel(r.level) }),
  },
  { title: '积分', key: 'points', width: 90, render: (r) => r.points ?? 0 },
  { title: '余额', key: 'balance', width: 100, render: (r) => `¥${fmtMoney(r.balance)}` },
  { title: '注册时间', key: 'created_at', width: 160, render: (r) => fmtDateTime(r.created_at) },
  {
    title: '操作', key: 'actions', width: 120, fixed: 'right',
    render: (r) => [
      h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(r) }, { default: () => '编辑' }),
      h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => onDeleteMemberRow(r) }, { default: () => '删除' }),
    ],
  },
])

// detail modal
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)
const LOG_PAGE_SIZE = 20
const pointLogPage = ref(1)
const balanceLogPage = ref(1)
const countUsagePage = ref(1)
function logPageSlice(list: any[], page: number): any[] {
  return list.slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE)
}
function logTotalPages(list: any[]): number {
  return Math.max(1, Math.ceil(list.length / LOG_PAGE_SIZE))
}
const pointLogsPaged = computed(() => logPageSlice(detail.value?.pointLogs ?? [], pointLogPage.value))
const balanceLogsPaged = computed(() => logPageSlice(detail.value?.balanceLogs ?? [], balanceLogPage.value))
const countUsageLogsPaged = computed(() => logPageSlice(detail.value?.countUsageLogs ?? [], countUsagePage.value))
const activeTab = ref<'info' | 'points' | 'balance' | 'count'>('info')
const infoFormRef = ref<FormInst | null>(null)
const infoSaving = ref(false)
const infoModel = reactive<{ name: string; phone: string; birthday: string | null; level: string; notes: string }>({
  name: '', phone: '', birthday: null, level: 'normal', notes: '',
})
const infoRules: FormRules = {
  name: { required: true, message: '请输入姓名', trigger: ['blur', 'input'] },
  phone: [
    { required: true, message: '请输入手机号', trigger: ['blur', 'input'] },
    { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确', trigger: ['blur', 'input'] },
  ],
}

const detailModalStyle = computed(() =>
  isMobile.value
    ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', margin: '0', borderRadius: '0' }
    : { width: '880px', maxWidth: '92vw' },
)
const detailBodyStyle = computed(() => ({ overflow: 'auto', maxHeight: isMobile.value ? 'calc(100vh - 56px)' : 'calc(100vh - 130px)' }))
const formModalStyle = computed(() => (isMobile.value ? { width: '92vw', maxWidth: '92vw' } : { width: '480px', maxWidth: '92vw' }))

async function openDetail(member: Member) {
  const session = ++detailSession
  detailVisible.value = true
  detailLoading.value = true
  activeTab.value = 'info'
  loadedTabs.value = new Set()
  pointLogPage.value = 1
  balanceLogPage.value = 1
  countUsagePage.value = 1
  detail.value = null
  try {
    const data = await useApiFetch<any>(`/api/members/${member.id}`, { query: { include: 'none' } })
    if (session !== detailSession) return
    detail.value = data
    syncInfoModel()
  } catch (e: any) {
    if (session !== detailSession) return
    toast.error(apiErr(e))
  } finally {
    if (session === detailSession) detailLoading.value = false
  }
}

// 详情各 tab 懒加载：打开弹窗只查本行（1 查询），切 tab 才查对应日志
const TAB_INCLUDE: Record<string, string> = {
  info: 'none',
  points: 'point',
  balance: 'balance',
  count: 'services,usage',
}
let detailSession = 0
const INCLUDE_KEYS: Record<string, string[]> = {
  point: ['pointLogs'],
  balance: ['balanceLogs'],
  services: ['memberServices'],
  usage: ['countUsageLogs'],
}
function mergeIncludeData(inc: string, data: any) {
  const patch: Record<string, any> = {}
  for (const k of inc.split(',')) {
    for (const key of INCLUDE_KEYS[k.trim()] ?? []) patch[key] = data[key]
  }
  detail.value = { ...detail.value, ...patch }
}
const loadedTabs = ref<Set<string>>(new Set())
async function loadTabData(tab: string) {
  if (!detail.value || loadedTabs.value.has(tab)) return
  const inc = TAB_INCLUDE[tab] ?? 'none'
  if (inc === 'none') return
  const session = detailSession
  const memberId = detail.value.id
  try {
    const data = await useApiFetch<any>(`/api/members/${memberId}`, { query: { include: inc } })
    if (session !== detailSession || detail.value?.id !== memberId) return
    mergeIncludeData(inc, data)
    loadedTabs.value.add(tab)
  } catch (e: any) {
    toast.error(apiErr(e))
  }
}
function onDetailTabChange(tab: string) {
  loadTabData(tab)
}

function parseBirthday(v: any): string | null {
  if (!v) return null
  const num = Number(v)
  if (!isNaN(num) && num > 0) {
    const d = new Date(num)
    if (!isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

function syncInfoModel() {
  const d = detail.value
  if (!d) return
  infoModel.name = d.name ?? ''
  infoModel.phone = d.phone ?? ''
  infoModel.birthday = parseBirthday(d.birthday)
  infoModel.level = d.level ?? 'normal'
  infoModel.notes = d.notes ?? ''
}

async function saveInfo() {
  if (!detail.value) return
  try {
    await infoFormRef.value?.validate()
  } catch {
    return
  }
  infoSaving.value = true
  try {
    const updated = await useApiFetch<Member>(`/api/members/${detail.value.id}`, {
      method: 'PUT',
      body: {
        name: infoModel.name,
        phone: infoModel.phone,
        birthday: infoModel.birthday || null,
        level: infoModel.level,
        notes: infoModel.notes || null,
      },
    })
    detail.value = { ...detail.value, ...updated }
    syncInfoModel()
    toast.success('保存成功')
    loadMembers()
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    infoSaving.value = false
  }
}

function onDeleteMemberRow(row: any) {
  const doDelete = async () => {
    try {
      await useApiFetch(`/api/members/${row.id}`, { method: 'DELETE' })
      toast.success('已删除')
      loadMembers()
    } catch (e) {
      toast.error(apiErr(e))
    }
  }
  const dlg = (window as any).$dialog
  if (!dlg) {
    if (window.confirm(`确定删除会员「${row.name}」吗？若存在订单、余额、积分或未用完计次将无法删除。`)) doDelete()
    return
  }
  dlg.warning({
    title: '确认删除',
    content: `确定删除会员「${row.name}」吗？若存在订单、余额、积分或未用完计次将无法删除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: doDelete,
  })
}

// point logs
const pointLogColumns = computed<DataTableColumns<any>>(() => [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtDateTime(r.created_at) },
  {
    title: '类型', key: 'type', width: 80,
    render: (r) => h(NTag, {
      type: r.type === 'earn' ? 'success' : r.type === 'redeem' ? 'warning' : r.type === 'deduct' ? 'error' : 'info',
      size: 'small'
    }, { default: () => ({ earn: '获取', redeem: '兑换', refund: '退还', deduct: '扣除' }[r.type as string] || r.type) }),
  },
  { title: '数量', key: 'amount', width: 90, render: (r) => {
    if (r.type === 'redeem' || r.type === 'deduct') return `-${Math.abs(r.amount)}`
    if (r.type === 'refund') return `+${Math.abs(r.amount)}`
    return `+${r.amount}`
  } },
  { title: '变动后', key: 'balance_after', width: 90 },
  { title: '操作员', key: 'operator_name', width: 90, render: (r) => r.operator_name || '-' },
  { title: '备注', key: 'notes', width: 150, render: (r: any) => {
    if (r.related_order_id) return `订单#${r.related_order_id}`
    return r.notes || '-'
  }},
])

// balance logs
const balanceLogColumns = computed<DataTableColumns<any>>(() => [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtDateTime(r.created_at) },
  {
    title: '类型', key: 'type', width: 90,
    render: (r) => {
      const isRevert = r.source_log_id != null
      const map: Record<string, { label: string; type: any }> = {
        recharge: { label: '充值', type: 'success' },
        consume: { label: '消费', type: 'warning' },
        refund: { label: '退款', type: 'info' },
      }
      const m = map[r.type as string] || { label: r.type, type: 'default' }
      const label = isRevert ? `${m.label}·回退` : m.label
      return h(NTag, { type: m.type, size: 'small' }, { default: () => label })
    },
  },
  { title: '本金', key: 'amount', width: 100, render: (r) => {
    const v = Number(r.amount || 0)
    const sign = r.type === 'consume' || r.source_log_id != null ? '-' : '+'
    return `${sign}${fmtMoney(Math.abs(v))}`
  } },
  { title: '赠金', key: 'bonus_amount', width: 100, render: (r) => {
    const v = Number(r.bonus_amount || 0)
    if (!v) return '-'
    const sign = r.source_log_id != null ? '-' : '+'
    return `${sign}${fmtMoney(Math.abs(v))}`
  } },
  { title: '变动后', key: 'balance_after', width: 100, render: (r) => `¥${fmtMoney(r.balance_after)}` },
  { title: '操作员', key: 'operator_name', width: 90, render: (r) => r.operator_name || '-' },
  { title: '备注', key: 'notes', width: 140, render: (r: any) => {
    if (r.related_order_id) return `订单#${r.related_order_id}`
    return r.notes || '-'
  }},
  {
    title: '操作', key: 'actions', width: 90, fixed: 'right',
    render: (r: any) => {
      const canRevert = r.source_log_id == null && r.amount > 0
        && (r.type === 'recharge' || (r.type === 'consume' && r.related_order_id == null))
        && isOwnRecord(r.operator_id)
      return canRevert
        ? h(NButton, { size: 'tiny', quaternary: true, type: 'warning', onClick: () => openRevertBalance(r) }, { default: () => '回退' })
        : h('span', { style: 'color:#ccc;font-size:12px;' }, '-')
    },
  },
])

// member count services
const memberServiceColumns = computed<DataTableColumns<any>>(() => [
  { title: '项目', key: 'service_name', width: 150 },
  { title: '剩余/总次', key: 'remaining_count', width: 110, render: (r) => `${r.remaining_count} / ${r.total_count ?? '-'}` },
  { title: '实收', key: 'paid_amount', width: 100, render: (r) => `¥${fmtMoney(r.paid_amount)}` },
  { title: '购买时间', key: 'purchased_at', width: 120, render: (r) => fmtDate(r.purchased_at) },
  { title: '到期', key: 'expires_at', width: 120, render: (r) => (r.expires_at ? fmtDate(r.expires_at) : '-') },
  {
    title: '操作', key: 'actions', width: 80,
    render: (r: any) => h(NButton, { size: 'tiny', type: 'primary', disabled: (r.remaining_count ?? 0) <= 0, onClick: () => openDeduct(r) }, { default: () => '扣次' }),
  },
])

// count usage logs
const countUsageColumns = computed<DataTableColumns<any>>(() => [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtDateTime(r.created_at) },
  { title: '变动数量', key: 'deduction_count', width: 100, render: (r) => (r.deduction_count < 0 ? `+${Math.abs(r.deduction_count)}` : `-${r.deduction_count}`) },
  { title: '剩余数量', key: 'remaining_after', width: 100 },
  { title: '操作员', key: 'operator_name', width: 90, render: (r) => r.operator_name || '-' },
  {
    title: '操作', key: 'actions', width: 80,
    render: (r: any) => r.deduction_count > 0 && isOwnRecord(r.operator_id)
      ? h(NButton, { size: 'tiny', quaternary: true, type: 'warning', onClick: () => onRevertDeduct(r) }, { default: () => '回退' })
      : h('span', { style: 'color:#ccc;font-size:12px;' }, '-')
  },
])



// recharge
const rechargeVisible = ref(false)
const rechargeSaving = ref(false)
const rechargeModel = reactive({ amount: 0 as number | null, bonus_amount: 0 as number | null, notes: '' })
const rechargeAmount = computed(() => Number(rechargeModel.amount) || 0)
const rechargeSubmit = useIdempotentSubmit({
  slot: 'member_recharge',
  fingerprint: () => `${detail.value?.id || ''}:${rechargeAmount.value}:${Number(rechargeModel.bonus_amount) || 0}`,
})
function openRecharge() {
  rechargeModel.amount = 0
  rechargeModel.bonus_amount = 0
  rechargeModel.notes = ''
  rechargeVisible.value = true
  rechargeSubmit.reset()
}
async function submitRecharge() {
  if (!detail.value) return
  if (rechargeAmount.value <= 0) {
    toast.warning('请输入充值金额')
    return
  }
  rechargeSaving.value = true
  try {
    await rechargeSubmit.post(`/api/members/${detail.value.id}/recharge`, {
      amount: rechargeAmount.value,
      bonus_amount: Number(rechargeModel.bonus_amount) || 0,
      notes: rechargeModel.notes,
    })
    toast.success('充值成功')
    rechargeSubmit.clear()
    rechargeVisible.value = false
    await refreshDetail()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(apiErr(e))
  } finally {
    rechargeSaving.value = false
  }
}

// consume
const consumeVisible = ref(false)
const consumeSaving = ref(false)
const consumeModel = reactive({ amount: 0 as number | null, notes: '' })
const consumeSubmit = useIdempotentSubmit({
  slot: 'member_consume',
  fingerprint: () => `${detail.value?.id || ''}:${Number(consumeModel.amount) || 0}`,
})
function openConsume() {
  consumeModel.amount = 0
  consumeModel.notes = ''
  consumeVisible.value = true
  consumeSubmit.reset()
}
async function submitConsume() {
  if (!detail.value) return
  if (!consumeModel.amount || consumeModel.amount <= 0) {
    toast.warning('请输入消费金额')
    return
  }
  if (Number(consumeModel.amount) > Number(detail.value.balance ?? 0)) {
    toast.warning('超出可用余额')
    return
  }
  consumeSaving.value = true
  try {
    await consumeSubmit.post(`/api/members/${detail.value.id}/consume`, {
      amount: consumeModel.amount,
      notes: consumeModel.notes,
    })
    toast.success('消费成功')
    consumeSubmit.clear()
    consumeVisible.value = false
    await refreshDetail()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(apiErr(e))
  } finally {
    consumeSaving.value = false
  }
}

// deduct
const deductVisible = ref(false)
const deductSaving = ref(false)
const deductTarget = ref<MemberCountServiceView | null>(null)
const deductCount = ref(1)
const deductSubmit = useIdempotentSubmit({
  slot: 'member_deduct',
  fingerprint: () => `${detail.value?.id || ''}:${deductTarget.value?.id || ''}:${deductCount.value}`,
})
function openDeduct(ms: MemberCountServiceView) {
  deductTarget.value = ms
  deductCount.value = 1
  deductVisible.value = true
  deductSubmit.reset()
}

async function submitDeduct() {
  if (!detail.value || !deductTarget.value) return
  if (!deductCount.value || deductCount.value <= 0) {
    toast.warning('请输入扣减次数')
    return
  }
  if (Number(deductCount.value) > Number(deductTarget.value.remaining_count ?? 0)) {
    toast.warning('超出剩余次数')
    return
  }
  deductSaving.value = true
  try {
    await deductSubmit.post(`/api/members/${detail.value.id}/deduct`, {
      member_service_id: deductTarget.value.id,
      count: deductCount.value,
    })
    toast.success('扣次成功')
    deductSubmit.clear()
    deductVisible.value = false
    await refreshDetail()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(apiErr(e))
  } finally {
    deductSaving.value = false
  }
}

// revert balance
const revertBalanceVisible = ref(false)
const revertBalanceSaving = ref(false)
const revertTarget = ref<any>(null)
const revertBalanceModel = reactive({ amount: 0 as number | null, bonus_amount: 0 as number | null, notes: '' })
const revertedAmount = ref(0)
const revertedBonus = ref(0)
const revertMaxAmount = computed(() => {
  if (!revertTarget.value) return 0
  return Math.max(0, round2(Number(revertTarget.value.amount) - revertedAmount.value))
})
const revertMaxBonus = computed(() => {
  if (!revertTarget.value) return 0
  return Math.max(0, round2(Number(revertTarget.value.bonus_amount || 0) - revertedBonus.value))
})
const revertBalanceSubmit = useIdempotentSubmit({
  slot: 'member_revert_balance',
  fingerprint: () => `${detail.value?.id || ''}:${revertTarget.value?.id || ''}:${Number(revertBalanceModel.amount) || 0}:${Number(revertBalanceModel.bonus_amount) || 0}`,
})
function openRevertBalance(log: any) {
  revertTarget.value = log
  revertBalanceModel.amount = 0
  revertBalanceModel.bonus_amount = 0
  revertBalanceModel.notes = ''
  if (log.reverted_amount != null || log.reverted_bonus != null) {
    revertedAmount.value = round2(Number(log.reverted_amount || 0))
    revertedBonus.value = round2(Number(log.reverted_bonus || 0))
  } else {
    const logs = detail.value?.balanceLogs ?? []
    let rAmt = 0, rBonus = 0
    for (const l of logs) {
      if (l.source_log_id === log.id) {
        rAmt += Math.abs(Number(l.amount || 0))
        rBonus += Math.abs(Number(l.bonus_amount || 0))
      }
    }
    revertedAmount.value = round2(rAmt)
    revertedBonus.value = round2(rBonus)
  }
  revertBalanceVisible.value = true
  revertBalanceSubmit.reset()
}
async function submitRevertBalance() {
  if (!detail.value || !revertTarget.value) return
  const amt = Number(revertBalanceModel.amount) || 0
  const bonus = Number(revertBalanceModel.bonus_amount) || 0
  if (amt <= 0 && bonus <= 0) {
    toast.warning('请输入回退金额')
    return
  }
  revertBalanceSaving.value = true
  try {
    await revertBalanceSubmit.post(`/api/members/${detail.value.id}/revert-balance`, {
      source_log_id: revertTarget.value.id,
      amount: amt,
      bonus_amount: revertTarget.value.type === 'recharge' ? bonus : undefined,
      notes: revertBalanceModel.notes,
    })
    toast.success('回退成功')
    revertBalanceSubmit.clear()
    revertBalanceVisible.value = false
    await refreshDetail()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(apiErr(e))
  } finally {
    revertBalanceSaving.value = false
  }
}

// gift points
const giftPointsVisible = ref(false)
const giftPointsSaving = ref(false)
const giftPointsModel = reactive({ amount: 10, notes: '' })
const giftPointsSubmit = useIdempotentSubmit({
  slot: 'member_gift_points',
  fingerprint: () => `${detail.value?.id || ''}:${Number(giftPointsModel.amount) || 0}`,
})
function openGiftPoints() {
  giftPointsModel.amount = 10
  giftPointsModel.notes = ''
  giftPointsVisible.value = true
  giftPointsSubmit.reset()
}
async function submitGiftPoints() {
  if (!detail.value) return
  if (!giftPointsModel.amount || giftPointsModel.amount <= 0) {
    toast.warning('请输入数量')
    return
  }
  giftPointsSaving.value = true
  try {
    await giftPointsSubmit.post(`/api/members/${detail.value.id}/gift-points`, {
      amount: giftPointsModel.amount,
      notes: giftPointsModel.notes,
    })
    toast.success('赠送成功')
    giftPointsSubmit.clear()
    giftPointsVisible.value = false
    await refreshDetail()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(apiErr(e))
  } finally {
    giftPointsSaving.value = false
  }
}

// redeem points
const redeemPointsVisible = ref(false)
const redeemPointsSaving = ref(false)
const redeemPointsModel = reactive({ amount: 10, notes: '' })
const redeemPointsSubmit = useIdempotentSubmit({
  slot: 'member_redeem_points',
  fingerprint: () => `${detail.value?.id || ''}:${Number(redeemPointsModel.amount) || 0}`,
})
function openRedeemPoints() {
  redeemPointsModel.amount = 10
  redeemPointsModel.notes = ''
  redeemPointsVisible.value = true
  redeemPointsSubmit.reset()
}
async function submitRedeemPoints() {
  if (!detail.value) return
  if (!redeemPointsModel.amount || redeemPointsModel.amount <= 0) {
    toast.warning('请输入数量')
    return
  }
  if (Number(redeemPointsModel.amount) > Number(detail.value.points ?? 0)) {
    toast.warning('超出可用积分')
    return
  }
  redeemPointsSaving.value = true
  try {
    await redeemPointsSubmit.post(`/api/members/${detail.value.id}/redeem-points`, {
      amount: redeemPointsModel.amount,
      notes: redeemPointsModel.notes,
    })
    toast.success('兑换成功')
    redeemPointsSubmit.clear()
    redeemPointsVisible.value = false
    await refreshDetail()
  } catch (e: any) {
    if (e?.isTimeout) toast.error(e.message)
    else toast.error(apiErr(e))
  } finally {
    redeemPointsSaving.value = false
  }
}

// assign service
const assignServiceVisible = ref(false)
const assignServiceSaving = ref(false)
const assignServiceModel = reactive({ service_id: null as number | null, paid_amount: null as number | null })
const assignServiceIdemKey = ref('')
function genAssignServiceKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}
const availableServiceOptions = ref<{ label: string; value: number }[]>([])
const availableServices = ref<any[]>([])
watch(() => assignServiceModel.service_id, (id) => {
  const s = availableServices.value.find((x: any) => Number(x.id) === Number(id))
  assignServiceModel.paid_amount = s ? Number(s.price) : null
})
async function openAssignService() {
  assignServiceModel.service_id = null
  assignServiceModel.paid_amount = null
  assignServiceIdemKey.value = genAssignServiceKey()
  try {
    const services = await useApiFetch<any>('/api/settings/count-services', { query: { store_id: storeId.value, pageSize: 100 } })
    availableServices.value = ((Array.isArray(services) ? services : (services?.items || [])) || []).filter((s: any) => s.status !== 'inactive')
    availableServiceOptions.value = availableServices.value.map((s: any) => ({ label: `${s.name}（${s.total_count}次/¥${s.price}）`, value: s.id }))
  } catch {
    availableServiceOptions.value = []
    availableServices.value = []
  }
  assignServiceVisible.value = true
}
async function submitAssignService() {
  if (!detail.value || !assignServiceModel.service_id) {
    toast.warning('请选择计次项目')
    return
  }
  assignServiceSaving.value = true
  try {
    await useApiFetch(`/api/members/${detail.value.id}/assign-service`, {
      method: 'POST',
      body: {
        service_id: assignServiceModel.service_id,
        paid_amount: assignServiceModel.paid_amount,
        idempotency_key: assignServiceIdemKey.value || undefined,
      },
    })
    toast.success('分配成功')
    assignServiceIdemKey.value = ''
    assignServiceVisible.value = false
    const memberId = detail.value.id
    const session = detailSession
    try {
      const data = await useApiFetch<any>(`/api/members/${memberId}`, { query: { include: 'services,usage' } })
      if (session === detailSession && detail.value?.id === memberId) {
        mergeIncludeData('services,usage', data)
        loadedTabs.value.add('count')
      }
    } catch (e) {
      toast.error(apiErr(e))
    }
    loadMembers()
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    assignServiceSaving.value = false
  }
}

function genIdemKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

async function onRevertDeduct(log: any) {
  if (!detail.value) return
  const doRevert = async () => {
    try {
      await useApiFetch(`/api/members/${detail.value!.id}/revert-deduct`, {
        method: 'POST',
        body: { log_id: log.id, idempotency_key: genIdemKey() },
      })
      toast.success('回退成功')
      await refreshDetail()
    } catch (e) {
      toast.error(apiErr(e))
    }
  }
  const dlg = (window as any).$dialog
  if (!dlg) {
    if (window.confirm(`确认回退这次扣减（${log.deduction_count}次）吗？回退后次数将加回。`)) doRevert()
    return
  }
  dlg.warning({
    title: '确认回退',
    content: `确认回退这次扣减（${log.deduction_count}次）吗？回退后次数将加回。`,
    positiveText: '确认回退',
    negativeText: '取消',
    onPositiveClick: doRevert,
  })
}

async function refreshDetail() {
  if (!detail.value) return
  const session = detailSession
  const memberId = detail.value.id
  const tab = activeTab.value
  try {
    // 本行 + 当前 tab 一起刷新（1~2 查询，原 6 查询）
    const inc = TAB_INCLUDE[tab] ?? 'none'
    const data = await useApiFetch<any>(`/api/members/${memberId}`, { query: { include: inc } })
    if (session !== detailSession || detail.value?.id !== memberId) return
    const { pointLogs, balanceLogs, memberServices, orders, countUsageLogs, ...member } = data
    detail.value = { ...detail.value, ...member }
    mergeIncludeData(inc, data)
    if (inc !== 'none') loadedTabs.value.add(tab)
    syncInfoModel()
    loadMembers()
  } catch (e) {
    toast.error(apiErr(e))
  }
}

// new member form
const formVisible = ref(false)
const formSaving = ref(false)
const formRef = ref<FormInst | null>(null)
const formModel = reactive<{ name: string; phone: string; birthday: string | null; level: string; notes: string }>({
  name: '', phone: '', birthday: null, level: 'normal', notes: '',
})
const formRules: FormRules = {
  name: { required: true, message: '请输入姓名', trigger: ['blur', 'input'] },
  phone: [
    { required: true, message: '请输入手机号', trigger: ['blur', 'input'] },
    { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确', trigger: ['blur', 'input'] },
  ],
}
function openNew() {
  formModel.name = ''
  formModel.phone = ''
  formModel.birthday = null
  formModel.level = 'normal'
  formModel.notes = ''
  formVisible.value = true
}
async function saveMember() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  let sid: number
  try {
    sid = requireStoreId()
  } catch {
    toast.warning('请先选择店铺')
    return
  }
  formSaving.value = true
  try {
    await useApiFetch('/api/members', {
      method: 'POST',
      body: {
        store_id: sid,
        name: formModel.name,
        phone: formModel.phone,
        birthday: formModel.birthday || null,
        level: formModel.level,
        notes: formModel.notes || null,
      },
    })
    toast.success('新增成功')
    formVisible.value = false
    loadMembers()
  } catch (e) {
    toast.error(apiErr(e))
  } finally {
    formSaving.value = false
  }
}

watch(storeId, () => {
  memberPage.value = 1
  loadMembers()
})
onMounted(() => loadMembers())
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.page-title {
  margin: 0;
  font-size: 18px;
  color: #333;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.search-input {
  flex: 1;
  min-width: 160px;
  max-width: 320px;
}
@media (max-width: 767px) {
  .search-input { max-width: 100%; }
  .spacer { display: none; }
}
.spacer {
  flex: 1;
}
.empty {
  text-align: center;
  color: #999;
  padding: 32px 0;
  font-size: 13px;
}

.member-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
}
.mc-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #eee;
  justify-content: flex-end;
}
.mc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.mc-head-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mc-phone {
  font-size: 12px;
  color: #999;
}
.mc-tail {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mc-expand {
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  align-items: center;
}
.mobile-pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.pager-info { font-size: 13px; color: #999; }
.mc-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}
.mc-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #666;
  line-height: 1.8;
}
.mc-label {
  color: #999;
}
.mc-foot {
  margin-top: 4px;
  font-size: 12px;
  color: #bbb;
}

.stat-row {
  display: flex;
  gap: 24px;
  margin: 16px 0;
  padding: 12px 16px;
  background: #f7f9fa;
  border-radius: 8px;
}
.stat-label {
  font-size: 12px;
  color: #999;
}
.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #169c91;
  margin-top: 2px;
}
.big-stat {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  row-gap: 10px;
  padding: 12px 16px;
  background: #f7f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
}
.bs-info {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}
.bs-actions {
  display: flex;
  gap: 10px;
}
.big-stat-label {
  font-size: 13px;
  color: #999;
}
.big-stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #169c91;
  flex: 1;
}
@media (max-width: 767px) {
  .big-stat { flex-direction: column; align-items: stretch; }
  .bs-info { justify-content: space-between; }
  .bs-actions .n-button { flex: 1; }
}

.count-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  margin-bottom: 8px;
}
.cc-name {
  font-weight: 600;
  color: #333;
}
.cc-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.sub-title {
  margin: 16px 0 8px;
  font-size: 14px;
  color: #333;
}
.deduct-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
  padding: 8px 12px;
  background: #f7f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #666;
  line-height: 1.8;
}
.adjust-current {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #E6F7F5, #f7f9fa);
  border-radius: 8px;
}
.adjust-label {
  font-size: 13px;
  color: #666;
}
.adjust-value {
  font-size: 22px;
  font-weight: 700;
  color: #169C91;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

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
.lc-time { font-size: 12px; color: #999; }
.lc-meta { display: flex; gap: 12px; align-items: center; margin-top: 6px; font-size: 13px; color: #666; }
.lc-change.up { color: #36c676; font-weight: 600; }
.lc-change.down { color: #f44336; font-weight: 600; }
.lc-notes { font-size: 12px; color: #999; margin-top: 4px; }
.lc-actions { display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #eee; }

@media (min-width: 768px) {
  .desktop-table { display: block; }
  .mobile-cards { display: none; }
  .page-title {
    font-size: 20px;
  }
}
</style>
