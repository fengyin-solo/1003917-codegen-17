<template>
  <section class="coverage-board">
    <header class="board-head">
      <div>
        <h3>覆盖热区台</h3>
        <p class="board-desc">
          按乡镇、村组、宣传方式排列计划场次、覆盖人数与缺口；右侧同面展示可调度人员与物资余量。
        </p>
      </div>
      <div class="board-actions">
        <span class="batch-tag">当前排期：{{ board.batchKey }}</span>
        <button class="btn primary" type="button" @click="confirm">确认排期</button>
        <button class="btn ghost" type="button" @click="resetBoard">重置热区台</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in board.stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="rule-note">
      冲突优先规则：已确认场次 ＞ 历史缺覆盖村组 ＞ 威胁人口多 ＞ 提交时间早；落选场次标记「冲突待调」，可一键顺延。
      跨村借用物资需权属村组确认后，排期才能生效；同一排期重复确认只保留一版。
    </p>

    <div class="board-grid">
      <table class="data-table">
        <thead>
          <tr>
            <th>乡镇</th>
            <th>村组</th>
            <th>宣传方式</th>
            <th>计划场次</th>
            <th>覆盖人数</th>
            <th>目标覆盖</th>
            <th>缺口</th>
            <th>上轮覆盖</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in board.rows" :key="index" :class="{ 'gap-row': row.historyGap }">
            <td v-if="row.firstOfTownship" :rowspan="row.townshipSpan" class="township-cell">
              <div>{{ row.township }}</div>
              <button class="link" type="button" @click="autofill(row.township)">补齐缺覆盖村组</button>
            </td>
            <td v-if="row.firstOfVillage" :rowspan="row.villageSpan">
              {{ row.village }}
              <span v-if="row.historyGap" class="gap-tag">缺覆盖</span>
            </td>
            <td>{{ row.method }}</td>
            <td>{{ row.planned }}<span v-if="row.confirmed" class="confirmed-note">（已确认{{ row.confirmed }}）</span></td>
            <td>{{ row.cover }}</td>
            <td>{{ row.target }}</td>
            <td :class="{ 'gap-text': row.gap > 0 }">{{ row.gap > 0 ? row.gap : '—' }}</td>
            <td>{{ row.historyCover }}</td>
          </tr>
        </tbody>
      </table>

      <aside class="board-side">
        <div class="side-card">
          <h4>可调度人员</h4>
          <ul>
            <li v-for="person in board.personnel" :key="person.name">
              <strong>{{ person.name }}</strong>
              <span>{{ person.township }} · {{ person.role }}</span>
              <em v-if="person.busyDates.length">已占用：{{ person.busyDates.join('、') }}</em>
              <em v-else-if="person.pendingDates.length">待确认占用：{{ person.pendingDates.join('、') }}</em>
              <em v-else class="free">可调度</em>
            </li>
          </ul>
        </div>
        <div class="side-card">
          <h4>物资余量</h4>
          <ul>
            <li v-for="material in board.materials" :key="material.name">
              <strong>{{ material.name }}</strong>
              <span>权属 {{ material.owner }}</span>
              <em :class="{ 'low-stock': material.remain - material.pendingUse < 0 }">
                余 {{ material.remain }}{{ material.unit }}
                <template v-if="material.pendingUse">（待确认再占 {{ material.pendingUse }}）</template>
              </em>
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <form class="schedule-form" @submit.prevent="submitSession">
      <label>
        <span>乡镇</span>
        <select v-model="form.township" @change="onTownshipChange">
          <option v-for="township in townships" :key="township" :value="township">{{ township }}</option>
        </select>
      </label>
      <label>
        <span>村组</span>
        <select v-model="form.village" @change="onVillageChange">
          <option v-for="village in villageOptions" :key="village.name" :value="village.name">{{ village.name }}</option>
        </select>
      </label>
      <label>
        <span>宣传方式</span>
        <select v-model="form.method">
          <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label>
        <span>活动日期</span>
        <input v-model="form.date" type="date" />
      </label>
      <label>
        <span>场地</span>
        <select v-model="form.venue">
          <option v-for="venue in venueOptions" :key="venue" :value="venue">{{ venue }}</option>
        </select>
      </label>
      <label>
        <span>预计覆盖人数</span>
        <input v-model.number="form.cover" type="number" min="1" />
      </label>
      <label>
        <span>负责人</span>
        <select v-model="form.leader">
          <option v-for="person in leaderOptions" :key="person.name" :value="person.name">
            {{ person.name }}（{{ person.role }}）
          </option>
        </select>
      </label>
      <fieldset class="material-picker">
        <legend>物资调用（跨村借用需权属确认）</legend>
        <label v-for="material in board.materials" :key="material.name">
          <span>{{ material.name }}（权属{{ material.owner }}，余{{ material.remain }}{{ material.unit }}）</span>
          <input v-model.number="form.materials[material.name]" type="number" min="0" />
        </label>
      </fieldset>
      <button class="btn primary" type="submit">加入排期</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>场次</th>
          <th>日期</th>
          <th>场地</th>
          <th>负责人</th>
          <th>预计覆盖</th>
          <th>物资</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="session in board.sessions" :key="session.id">
          <td>
            {{ session.village }}·{{ session.method }}
            <span v-if="session.auto" class="auto-tag">乡镇补齐</span>
          </td>
          <td>{{ session.date }}</td>
          <td>{{ session.venue }}</td>
          <td>{{ session.leader }}</td>
          <td>{{ session.cover }}</td>
          <td>
            <span v-if="!session.materials.length">—</span>
            <span v-else>{{ session.materials.map((item) => `${item.name}×${item.qty}`).join('、') }}</span>
          </td>
          <td>
            <template v-if="session.status === '已确认'">已确认</template>
            <template v-else-if="session.conflicts.length">
              <span class="conflict-text">冲突待调</span>
              <div v-for="(reason, i) in session.conflicts" :key="i" class="conflict-reason">{{ reason }}</div>
            </template>
            <template v-else-if="session.borrowDenied">借用被拒，需调整</template>
            <template v-else-if="session.borrowWaiting">待权属确认（{{ session.borrowWaiting }}）</template>
            <template v-else>待确认</template>
          </td>
          <td class="row-actions">
            <template v-if="session.status === '待确认'">
              <button class="link" type="button" @click="postpone(session.id)">顺延</button>
              <button class="link" type="button" @click="remove(session.id)">移除</button>
            </template>
            <span v-else>—</span>
          </td>
        </tr>
        <tr v-if="!board.sessions.length">
          <td colspan="8" class="empty-state">还没有排期场次，可在上方加入或按乡镇补齐</td>
        </tr>
      </tbody>
    </table>

    <div v-if="board.borrows.length" class="borrow-area">
      <h4>跨村借用权属确认</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>物资</th>
            <th>数量</th>
            <th>权属村组</th>
            <th>借入村组</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in board.borrows" :key="order.id">
            <td>{{ order.material }}</td>
            <td>{{ order.qty }}</td>
            <td>{{ order.owner }}</td>
            <td>{{ order.borrower }}</td>
            <td>{{ order.status }}</td>
            <td class="row-actions">
              <template v-if="order.status === '待确认'">
                <button class="link" type="button" @click="decide(order.id, true)">同意出借</button>
                <button class="link" type="button" @click="decide(order.id, false)">拒绝</button>
              </template>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="{ 'error-text': !messageOk }">{{ message }}</span>
      <ul v-if="details.length" class="detail-list">
        <li v-for="(item, index) in details" :key="index">{{ item }}</li>
      </ul>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  addSession,
  autofillTownship,
  confirmBatch,
  decideBorrow,
  loadBoard,
  postponeSession,
  removeSession,
  resetCoverageBoard,
} from '@/api/coverage-service'
import type { BoardView, ServiceResult } from '@/api/coverage-service'
import { PERSONNEL, PUBLICITY_METHODS, TOWNSHIPS, VILLAGES, venuesOf } from '@/data/coverage'

const emit = defineEmits<{ generated: [] }>()

const townships = TOWNSHIPS
const methods = PUBLICITY_METHODS

const board = ref<BoardView>(loadBoard())
const message = ref('')
const messageOk = ref(true)
const details = ref<string[]>([])

const form = reactive({
  township: TOWNSHIPS[0],
  village: '',
  method: PUBLICITY_METHODS[0],
  date: '',
  venue: '',
  cover: 100,
  leader: '',
  materials: {} as Record<string, number>,
})

const villageOptions = computed(() => VILLAGES.filter((item) => item.township === form.township))
const venueOptions = computed(() => venuesOf(form.township, form.village))
const leaderOptions = computed(() => PERSONNEL.filter((item) => item.township === form.township))

function onTownshipChange() {
  form.village = villageOptions.value[0]?.name ?? ''
  onVillageChange()
  form.leader = leaderOptions.value[0]?.name ?? ''
}

function onVillageChange() {
  form.venue = venueOptions.value[0] ?? ''
}

function applyResult(result: ServiceResult) {
  message.value = result.message
  messageOk.value = result.ok
  details.value = result.detail ?? []
  board.value = loadBoard()
}

function submitSession() {
  const materials = Object.entries(form.materials)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([name, qty]) => ({ name, qty: Number(qty) }))
  applyResult(addSession({ ...form, materials }))
}

function autofill(township: string) {
  applyResult(autofillTownship(township))
}

function postpone(id: number) {
  applyResult(postponeSession(id))
}

function remove(id: number) {
  applyResult(removeSession(id))
}

function decide(id: number, approve: boolean) {
  applyResult(decideBorrow(id, approve))
}

function confirm() {
  const result = confirmBatch()
  applyResult(result)
  if (result.ok && result.message.includes('已确认')) {
    emit('generated')
  }
}

function resetBoard() {
  applyResult(resetCoverageBoard())
  emit('generated')
}

onMounted(() => {
  onTownshipChange()
  const week = new Date()
  week.setDate(week.getDate() + 7)
  form.date = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`
  board.value = loadBoard()
})
</script>

<style scoped>
.coverage-board {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.board-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}
.board-head h3 {
  margin: 0;
}
.board-desc {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 0;
}
.board-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.batch-tag {
  font-size: 12px;
  color: var(--muted);
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
}
.rule-note {
  font-size: 12px;
  color: var(--muted);
  background: #f0f6ff;
  border: 1px solid #d3e2fb;
  border-radius: 6px;
  padding: 6px 10px;
}
.board-grid {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: 12px;
  margin-bottom: 12px;
}
.board-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.side-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.side-card h4 {
  margin: 0 0 6px;
  font-size: 13px;
}
.side-card ul {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
}
.side-card li {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border);
}
.side-card li:last-child {
  border-bottom: none;
}
.side-card li span {
  color: var(--muted);
}
.side-card li em {
  font-style: normal;
  color: #b42318;
}
.side-card li em.free {
  color: #067647;
}
.low-stock {
  color: #b42318;
  font-weight: 600;
}
.township-cell {
  vertical-align: top;
  background: #f8fafc;
}
.township-cell .link {
  display: block;
  margin-top: 6px;
  font-size: 12px;
}
.gap-row {
  background: #fff8f0;
}
.gap-tag {
  display: inline-block;
  background: #fde3cf;
  color: #b43418;
  border-radius: 4px;
  font-size: 11px;
  padding: 0 6px;
  margin-left: 4px;
}
.auto-tag {
  display: inline-block;
  background: #e0ecff;
  color: #1f6feb;
  border-radius: 4px;
  font-size: 11px;
  padding: 0 6px;
  margin-left: 4px;
}
.gap-text {
  color: #b42318;
  font-weight: 600;
}
.confirmed-note {
  color: var(--muted);
  font-size: 12px;
}
.conflict-text {
  color: #b42318;
  font-weight: 600;
}
.conflict-reason {
  font-size: 11px;
  color: var(--muted);
}
.schedule-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.schedule-form label span {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.schedule-form input,
.schedule-form select {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.material-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  width: 100%;
}
.material-picker legend {
  font-size: 12px;
  color: var(--muted);
  padding: 0 4px;
}
.material-picker label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
}
.material-picker input {
  width: 72px;
}
.borrow-area {
  margin-top: 12px;
}
.borrow-area h4 {
  margin: 0 0 6px;
  font-size: 13px;
}
.detail-list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: #b42318;
}
</style>
