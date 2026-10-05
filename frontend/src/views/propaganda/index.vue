<template>
  <section class="page" data-module="propaganda">
    <header class="page-head">
      <div>
        <h2>防灾宣传管理</h2>
        <p class="page-desc">维护宣传活动，围绕活动编号、宣传主题、宣传方式、覆盖村组做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记宣传活动</button>
        <button class="btn" type="button" @click="exportRows">导出防灾宣传清单</button>
      </div>
    </header>

    <section class="panel" data-panel="coverage-board">
      <div class="panel-head">
        <h3 class="panel-title">覆盖热区台</h3>
        <div class="page-actions">
          <button class="btn" type="button" @click="makeUp">按乡镇补齐缺覆盖</button>
          <button class="btn primary" type="button" @click="confirm">确认排期</button>
        </div>
      </div>
      <p class="hint-text">
        冲突优先规则：{{ priorityRule }}；跨村借用物资须经权属村确认后，对应场次才能参与确认。
      </p>
      <p v-if="boardMessage" class="board-message" :class="{ 'error-text': boardError }">{{ boardMessage }}</p>

      <table class="data-table">
        <thead>
          <tr>
            <th>乡镇</th>
            <th>村组</th>
            <th>宣传方式</th>
            <th>计划场次</th>
            <th>已确认覆盖</th>
            <th>在途覆盖</th>
            <th>历史已覆盖</th>
            <th>应覆盖</th>
            <th>缺口</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in board" :key="`${row.villageId}-${row.method}`">
            <td>{{ row.township }}</td>
            <td>{{ row.village }}</td>
            <td>{{ row.method }}</td>
            <td>{{ row.sessions }}</td>
            <td>{{ row.confirmedCover }}</td>
            <td>{{ row.pendingCover }}</td>
            <td>{{ row.coveredHistory }}</td>
            <td>{{ row.population }}</td>
            <td :class="{ 'gap-cell': row.gap > 0 }">{{ row.gap > 0 ? row.gap : '—' }}</td>
          </tr>
          <tr v-if="!board.length">
            <td colspan="9" class="empty-state">暂无村组覆盖数据</td>
          </tr>
        </tbody>
      </table>

      <h4 class="sub-title">场次排期</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>场次编号</th>
            <th>乡镇</th>
            <th>村组</th>
            <th>宣传方式</th>
            <th>日期</th>
            <th>场地</th>
            <th>人员</th>
            <th>计划覆盖</th>
            <th>物资调配</th>
            <th>来源</th>
            <th>状态</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sessions" :key="row.id">
            <td>{{ row.id }}</td>
            <td>{{ row.township }}</td>
            <td>{{ row.village }}</td>
            <td>{{ row.method }}</td>
            <td>{{ row.date }}</td>
            <td>{{ row.venue }}</td>
            <td>{{ row.workers }}</td>
            <td>{{ row.plannedCoverage }}</td>
            <td>{{ row.materials }}</td>
            <td>{{ row.source }}</td>
            <td>
              <span class="badge" :class="sessionBadge(row.status)">{{ row.status }}</span>
            </td>
            <td>{{ row.note }}</td>
          </tr>
          <tr v-if="!sessions.length">
            <td colspan="12" class="empty-state">暂无排期场次，可先按乡镇补齐缺覆盖</td>
          </tr>
        </tbody>
      </table>

      <div class="sub-grid">
        <div>
          <h4 class="sub-title">可调度人员</h4>
          <table class="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>乡镇</th>
                <th>角色</th>
                <th>已排期</th>
                <th>占用日期</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in workers" :key="row.id">
                <td>{{ row.name }}</td>
                <td>{{ row.township }}</td>
                <td>{{ row.role }}</td>
                <td>{{ row.booked }} 场</td>
                <td>{{ row.dates }}</td>
                <td>
                  <span class="badge" :class="row.dispatchable ? 'ok' : 'warn'">
                    {{ row.dispatchable ? '可调度' : '已排期' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 class="sub-title">物资余量</h4>
          <table class="data-table">
            <thead>
              <tr>
                <th>物资</th>
                <th>权属村组</th>
                <th>总量</th>
                <th>已确认占用</th>
                <th>待确认占用</th>
                <th>余量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in materials" :key="row.id">
                <td>{{ row.name }}</td>
                <td>{{ row.ownerVillage }}</td>
                <td>{{ row.total }}</td>
                <td>{{ row.confirmedUse }}</td>
                <td>{{ row.pendingUse }}</td>
                <td :class="{ 'gap-cell': row.left < 0 }">{{ row.left }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h4 class="sub-title">跨村借用审批</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>借用单号</th>
            <th>关联场次</th>
            <th>物资</th>
            <th>权属村组</th>
            <th>借入村组</th>
            <th>数量</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in borrows" :key="row.id">
            <td>{{ row.id }}</td>
            <td>{{ row.sessionId }}</td>
            <td>{{ row.material }}</td>
            <td>{{ row.fromVillage }}</td>
            <td>{{ row.toVillage }}</td>
            <td>{{ row.quantity }}</td>
            <td>
              <span class="badge" :class="borrowBadge(row.status)">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <template v-if="row.status === '待权属确认'">
                <button class="link" type="button" @click="settleBorrow(row.id, true)">同意出借</button>
                <button class="link" type="button" @click="settleBorrow(row.id, false)">拒绝</button>
              </template>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!borrows.length">
            <td colspan="8" class="empty-state">暂无跨村借用申请</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无防灾宣传数据，可先登记宣传活动</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条防灾宣传记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  PRIORITY_RULE,
  boardRows,
  borrowRows,
  confirmSchedule,
  generateMakeUp,
  materialRows,
  resolveBorrow,
  sessionRows,
  workerRows,
  type BoardRow,
  type BorrowRow,
  type MaterialRow,
  type SessionRow,
  type WorkerRow,
} from '@/api/coverage-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('propaganda')
const columns = ["活动编号", "宣传主题", "宣传方式", "覆盖村组", "活动日期", "参与人数", "组织人", "活动状态"]
const actions = ["开展活动", "确认完成", "取消活动"]
const statuses = ["待开展", "进行中", "已完成", "已取消"]
const stats = [{"label": "本月活动数", "value": 0}, {"label": "已完成数", "value": 0}, {"label": "覆盖人次", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const priorityRule = PRIORITY_RULE
const board = ref<BoardRow[]>([])
const sessions = ref<SessionRow[]>([])
const workers = ref<WorkerRow[]>([])
const materials = ref<MaterialRow[]>([])
const borrows = ref<BorrowRow[]>([])
const boardMessage = ref('')
const boardError = ref(false)

function sessionBadge(status: string): string {
  if (status === '已确认') {
    return 'ok'
  }
  if (status === '冲突暂缓') {
    return 'err'
  }
  return 'warn'
}

function borrowBadge(status: string): string {
  if (status === '已同意') {
    return 'ok'
  }
  if (status === '已拒绝') {
    return 'err'
  }
  return 'warn'
}

function refreshBoard() {
  board.value = boardRows()
  sessions.value = sessionRows()
  workers.value = workerRows()
  materials.value = materialRows()
  borrows.value = borrowRows()
}

function makeUp() {
  boardError.value = false
  const result = generateMakeUp()
  boardMessage.value = result.message
  refreshBoard()
}

function confirm() {
  boardError.value = false
  const result = confirmSchedule()
  boardMessage.value = result.message
  boardError.value = !result.ok && !result.duplicated
  refreshBoard()
  reload()
}

function settleBorrow(id: string, approve: boolean) {
  boardError.value = false
  const result = resolveBorrow(id, approve)
  boardMessage.value = result.message
  boardError.value = !result.ok
  refreshBoard()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '宣传活动登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '防灾宣传列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshBoard()
})
</script>
