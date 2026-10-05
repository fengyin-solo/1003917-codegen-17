import {
  isHistoryGap,
  materialOf,
  MATERIALS,
  PUBLICITY_METHODS,
  PERSONNEL,
  STANDARD_KIT,
  TOWNSHIPS,
  VILLAGES,
  villageOf,
} from '@/data/coverage'
import type { BorrowOrder, Session, SessionMaterial } from '@/data/coverage'
import { cloneState, nextSeq, resetCoverage, saveCoverage } from '@/data/coverage-store'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// —— 冲突优先规则（本系统约定）——
// 同一日期下同一场地或同一负责人撞期时：
//   1. 已确认场次优先（已生效的排期不被未确认的挤占）
//   2. 历史缺覆盖村组优先（上一轮覆盖不足的村组先补）
//   3. 隐患威胁人口多的村组优先
//   4. 提交时间早的优先
// 落选场次标记「冲突待调」，可顺延到下一个不撞期的日期。

export type ServiceResult = ActionResult & { detail?: string[] }

export type BoardRow = {
  township: string
  village: string
  method: string
  planned: number // 计划场次（待确认 + 已确认）
  confirmed: number // 已确认场次
  cover: number // 计划覆盖人数
  target: number // 目标覆盖人数
  gap: number // 缺口 = 目标 - 计划覆盖
  historyCover: number
  historyGap: boolean // 历史缺覆盖标记
  firstOfTownship: boolean
  townshipSpan: number
  firstOfVillage: boolean
  villageSpan: number
}

export type PersonnelView = {
  name: string
  township: string
  role: string
  busyDates: string[] // 已确认场次占用的日期
  pendingDates: string[] // 待确认场次占用的日期
}

export type MaterialView = {
  name: string
  owner: string
  unit: string
  total: number
  confirmedUse: number
  pendingUse: number
  remain: number // 余量 = 总量 - 已确认占用
}

export type SessionView = Session & {
  conflicts: string[] // 冲突待调原因
  borrowWaiting: number // 待权属确认的借用单数
  borrowDenied: number // 被权属村组拒绝的借用单数
}

export type BoardView = {
  rows: BoardRow[]
  personnel: PersonnelView[]
  materials: MaterialView[]
  sessions: SessionView[]
  borrows: BorrowOrder[]
  batchKey: string
  stats: { label: string; value: string | number }[]
}

export type SessionInput = {
  township: string
  village: string
  method: string
  date: string
  venue: string
  cover: number
  leader: string
  materials: { name: string; qty: number }[]
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00`)
  base.setDate(base.getDate() + days)
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const day = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${month}-${day}`
}

function activeSessions(sessions: Session[]): Session[] {
  return sessions.filter((item) => item.status === '待确认' || item.status === '已确认')
}

// 优先级排序：已确认 > 历史缺覆盖 > 威胁人口多 > 提交早
function comparePriority(a: Session, b: Session): number {
  const villageA = villageOf(a.village)
  const villageB = villageOf(b.village)
  const confirmedA = a.status === '已确认' ? 1 : 0
  const confirmedB = b.status === '已确认' ? 1 : 0
  if (confirmedA !== confirmedB) return confirmedB - confirmedA
  const gapA = villageA && isHistoryGap(villageA) ? 1 : 0
  const gapB = villageB && isHistoryGap(villageB) ? 1 : 0
  if (gapA !== gapB) return gapB - gapA
  const threatenedA = villageA?.threatened ?? 0
  const threatenedB = villageB?.threatened ?? 0
  if (threatenedA !== threatenedB) return threatenedB - threatenedA
  return a.seq - b.seq
}

// 撞期检测：同日期同场地、同日期同负责人各算一组，组内按优先规则只留一个
export function detectConflicts(sessions: Session[]): Map<number, string[]> {
  const groups = new Map<string, Session[]>()
  for (const session of activeSessions(sessions)) {
    const keys = [
      `场地|${session.venue}|${session.date}`,
      `负责人|${session.leader}|${session.date}`,
    ]
    for (const key of keys) {
      const group = groups.get(key) ?? []
      group.push(session)
      groups.set(key, group)
    }
  }
  const conflicts = new Map<number, string[]>()
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const sorted = [...group].sort(comparePriority)
    const winner = sorted[0]
    const resource = key.startsWith('场地|') ? `场地「${winner.venue}」` : `负责人「${winner.leader}」`
    for (const loser of sorted.slice(1)) {
      const reasons = conflicts.get(loser.id) ?? []
      reasons.push(`${resource}与${winner.village}场次同日撞期，按优先规则落选`)
      conflicts.set(loser.id, reasons)
    }
  }
  return conflicts
}

// 从某天起找下一个场地和负责人都空闲的日期（已确认与待确认场次都算占用）
function nextFreeDate(sessions: Session[], venue: string, leader: string, from: string, excludeId = 0): string {
  const active = activeSessions(sessions).filter((item) => item.id !== excludeId)
  for (let offset = 1; offset <= 30; offset += 1) {
    const candidate = addDays(from, offset)
    const venueBusy = active.some((item) => item.date === candidate && item.venue === venue)
    const leaderBusy = active.some((item) => item.date === candidate && item.leader === leader)
    if (!venueBusy && !leaderBusy) return candidate
  }
  return ''
}

function materialUsage(sessions: Session[]): Map<string, { confirmed: number; pending: number }> {
  const usage = new Map<string, { confirmed: number; pending: number }>()
  for (const session of activeSessions(sessions)) {
    for (const material of session.materials) {
      const entry = usage.get(material.name) ?? { confirmed: 0, pending: 0 }
      if (session.status === '已确认') entry.confirmed += material.qty
      else entry.pending += material.qty
      usage.set(material.name, entry)
    }
  }
  return usage
}

export function loadBoard(): BoardView {
  const state = cloneState()
  const conflicts = detectConflicts(state.sessions)
  const usage = materialUsage(state.sessions)

  const rows: BoardRow[] = []
  for (const township of TOWNSHIPS) {
    const villages = VILLAGES.filter((item) => item.township === township)
    const townshipRows: BoardRow[] = []
    for (const village of villages) {
      const sessions = activeSessions(state.sessions).filter((item) => item.village === village.name)
      const methods = PUBLICITY_METHODS.filter((method) => sessions.some((item) => item.method === method))
      const totalCover = sessions.reduce((sum, item) => sum + item.cover, 0)
      const gap = Math.max(0, village.targetCover - totalCover)
      const confirmed = sessions.filter((item) => item.status === '已确认').length
      const base = {
        township,
        village: village.name,
        target: village.targetCover,
        gap,
        historyCover: village.historyCover,
        historyGap: isHistoryGap(village),
        confirmed,
        firstOfTownship: false,
        townshipSpan: 0,
        firstOfVillage: false,
        villageSpan: 0,
      }
      if (methods.length === 0) {
        townshipRows.push({ ...base, method: '—', planned: 0, cover: 0 })
      } else {
        for (const method of methods) {
          const matched = sessions.filter((item) => item.method === method)
          townshipRows.push({
            ...base,
            method,
            planned: matched.length,
            cover: matched.reduce((sum, item) => sum + item.cover, 0),
          })
        }
      }
    }
    townshipRows.forEach((row, index) => {
      row.firstOfTownship = index === 0
      row.townshipSpan = townshipRows.length
    })
    let cursor = 0
    for (const village of villages) {
      const span = townshipRows.filter((row) => row.village === village.name).length
      const at = townshipRows.findIndex((row, index) => index >= cursor && row.village === village.name)
      if (at >= 0) {
        townshipRows[at].firstOfVillage = true
        townshipRows[at].villageSpan = span
      }
      cursor = at + span
    }
    rows.push(...townshipRows)
  }

  const personnel: PersonnelView[] = PERSONNEL.map((person) => {
    const mine = activeSessions(state.sessions).filter((item) => item.leader === person.name)
    return {
      ...person,
      busyDates: mine.filter((item) => item.status === '已确认').map((item) => item.date),
      pendingDates: mine.filter((item) => item.status === '待确认').map((item) => item.date),
    }
  })

  const materials: MaterialView[] = MATERIALS.map((material) => {
    const used = usage.get(material.name) ?? { confirmed: 0, pending: 0 }
    return {
      name: material.name,
      owner: material.owner,
      unit: material.unit,
      total: material.total,
      confirmedUse: used.confirmed,
      pendingUse: used.pending,
      remain: material.total - used.confirmed,
    }
  })

  const sessions: SessionView[] = state.sessions
    .filter((item) => item.status === '待确认' || item.status === '已确认')
    .sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1))
    .map((session) => {
      const related = state.borrows.filter((item) => item.sessionId === session.id)
      return {
        ...session,
        conflicts: conflicts.get(session.id) ?? [],
        borrowWaiting: related.filter((item) => item.status === '待确认').length,
        borrowDenied: related.filter((item) => item.status === '已拒绝').length,
      }
    })

  const gapVillages = VILLAGES.filter((item) => isHistoryGap(item)).length
  const totalGap = rows
    .filter((row) => row.firstOfVillage || row.villageSpan === 0)
    .reduce((sum, row) => sum + row.gap, 0)
  const stats = [
    { label: '乡镇 / 村组', value: `${TOWNSHIPS.length} 乡镇 / ${VILLAGES.length} 村组` },
    { label: '历史缺覆盖村组', value: gapVillages },
    { label: '覆盖缺口人数', value: totalGap },
    { label: '待确认场次', value: sessions.filter((item) => item.status === '待确认').length },
    { label: '待权属确认借用', value: state.borrows.filter((item) => item.status === '待确认').length },
  ]

  return {
    rows,
    personnel,
    materials,
    sessions,
    borrows: state.borrows,
    batchKey: state.currentBatch,
    stats,
  }
}

export function addSession(input: SessionInput): ServiceResult {
  const village = villageOf(input.village)
  if (!village || village.township !== input.township) {
    return { ok: false, message: '村组与所属乡镇对不上，请重新选择' }
  }
  if (!PUBLICITY_METHODS.includes(input.method)) {
    return { ok: false, message: `宣传方式只能是：${PUBLICITY_METHODS.join('、')}` }
  }
  if (!input.date) {
    return { ok: false, message: '请选择活动日期' }
  }
  if (!input.venue.trim()) {
    return { ok: false, message: '请填写或选择场地' }
  }
  if (!input.leader) {
    return { ok: false, message: '请选择负责人' }
  }
  if (!Number.isFinite(input.cover) || input.cover <= 0) {
    return { ok: false, message: '预计覆盖人数要大于 0' }
  }
  const materials: SessionMaterial[] = []
  for (const item of input.materials) {
    if (item.qty <= 0) continue
    const seed = materialOf(item.name)
    if (!seed) {
      return { ok: false, message: `没有登记名为「${item.name}」的物资` }
    }
    materials.push({ name: seed.name, qty: item.qty, owner: seed.owner })
  }

  const state = cloneState()
  const id = nextSeq(state)
  const session: Session = {
    id,
    batch: state.currentBatch,
    township: input.township,
    village: input.village,
    method: input.method,
    date: input.date,
    venue: input.venue.trim(),
    cover: Math.round(input.cover),
    leader: input.leader,
    materials,
    status: '待确认',
    seq: id,
    auto: false,
  }
  state.sessions.push(session)

  // 跨村借用：物资权属村组不是本村，就生成待确认的借用单
  const borrowed: string[] = []
  for (const material of materials) {
    if (material.owner === input.village) continue
    state.borrows.push({
      id: nextSeq(state),
      sessionId: id,
      material: material.name,
      qty: material.qty,
      owner: material.owner,
      borrower: input.village,
      status: '待确认',
    })
    borrowed.push(`${material.name}×${material.qty}（权属${material.owner}）`)
  }
  saveCoverage(state)
  const suffix = borrowed.length ? `；跨村借用${borrowed.join('、')}已生成，待权属村组确认` : ''
  return { ok: true, message: `已加入排期 ${state.currentBatch}：${input.village}·${input.method}（${input.date}）${suffix}` }
}

// 历史缺覆盖村组按所属乡镇补齐：每个还有缺口的缺覆盖村组自动排一场集中宣讲
export function autofillTownship(township: string): ServiceResult {
  if (!TOWNSHIPS.includes(township)) {
    return { ok: false, message: `没有登记名为 ${township} 的乡镇` }
  }
  const state = cloneState()
  const targets = VILLAGES.filter((item) => item.township === township && isHistoryGap(item))
  if (!targets.length) {
    return { ok: false, message: `${township}没有历史缺覆盖村组，不用补齐` }
  }
  const created: string[] = []
  const skipped: string[] = []
  for (const village of targets) {
    const existing = activeSessions(state.sessions).filter((item) => item.village === village.name)
    const covered = existing.reduce((sum, item) => sum + item.cover, 0)
    const gap = village.targetCover - covered
    if (gap <= 0) {
      skipped.push(village.name)
      continue
    }
    const leader =
      PERSONNEL.find((item) => item.township === township && item.role === '宣讲员')?.name ??
      PERSONNEL.find((item) => item.township === township)?.name ??
      ''
    const date = nextFreeDate(state.sessions, village.venue, leader, today())
    if (!leader || !date) {
      skipped.push(village.name)
      continue
    }
    const id = nextSeq(state)
    const materials = STANDARD_KIT.map((item) => ({
      name: item.name,
      qty: item.qty,
      owner: materialOf(item.name)?.owner ?? village.name,
    }))
    state.sessions.push({
      id,
      batch: state.currentBatch,
      township,
      village: village.name,
      method: '集中宣讲',
      date,
      venue: village.venue,
      cover: gap,
      leader,
      materials,
      status: '待确认',
      seq: id,
      auto: true,
    })
    for (const material of materials) {
      if (material.owner === village.name) continue
      state.borrows.push({
        id: nextSeq(state),
        sessionId: id,
        material: material.name,
        qty: material.qty,
        owner: material.owner,
        borrower: village.name,
        status: '待确认',
      })
    }
    created.push(`${village.name}（${date}，补${gap}人）`)
  }
  saveCoverage(state)
  if (!created.length) {
    return { ok: false, message: `${township}的缺覆盖村组本轮已排满，没有新增补齐场次` }
  }
  const suffix = skipped.length ? `；${skipped.join('、')}已覆盖无需补齐` : ''
  return { ok: true, message: `${township}已按缺口补齐 ${created.length} 场：${created.join('、')}${suffix}` }
}

export function postponeSession(id: number): ServiceResult {
  const state = cloneState()
  const session = state.sessions.find((item) => item.id === id)
  if (!session) {
    return { ok: false, message: '没有找到这条场次' }
  }
  if (session.status !== '待确认') {
    return { ok: false, message: '已确认的场次不能顺延，如需调整请先联系管理员' }
  }
  const date = nextFreeDate(state.sessions, session.venue, session.leader, session.date, session.id)
  if (!date) {
    return { ok: false, message: '未来 30 天内找不到场地和负责人都空闲的日期' }
  }
  session.date = date
  saveCoverage(state)
  return { ok: true, message: `${session.village}·${session.method}已顺延到 ${date}` }
}

export function removeSession(id: number): ServiceResult {
  const state = cloneState()
  const session = state.sessions.find((item) => item.id === id)
  if (!session) {
    return { ok: false, message: '没有找到这条场次' }
  }
  if (session.status !== '待确认') {
    return { ok: false, message: '已确认的场次不能移除' }
  }
  state.sessions = state.sessions.filter((item) => item.id !== id)
  state.borrows = state.borrows.filter((item) => item.sessionId !== id)
  saveCoverage(state)
  return { ok: true, message: `已移除${session.village}·${session.method}（${session.date}）及其借用单` }
}

export function decideBorrow(id: number, approve: boolean): ServiceResult {
  const state = cloneState()
  const order = state.borrows.find((item) => item.id === id)
  if (!order) {
    return { ok: false, message: '没有找到这条借用单' }
  }
  if (order.status !== '待确认') {
    return { ok: false, message: `这条借用单已${order.status}，不用重复操作` }
  }
  order.status = approve ? '已同意' : '已拒绝'
  saveCoverage(state)
  const verb = approve ? '同意' : '拒绝'
  return {
    ok: true,
    message: `${order.owner}已${verb}向${order.borrower}出借${order.material}×${order.qty}`,
  }
}

function nextCode(rows: EntryRow[], field: string, prefix: string): number {
  let max = 0
  for (const row of rows) {
    const match = String(row[field] ?? '').match(new RegExp(`^${prefix}-(\\d+)$`))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

function nextRowId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 确认排期后真正落到三个模块：防灾宣传活动、群测群防联动课程、隐患点台账宣传提醒。
// 所有生成记录都带「来源排期」标记，重复确认时凭标记跳过，只保留一版。
function generateLinkedRecords(batchKey: string, sessions: Session[]): string {
  const touched = ['propaganda', 'training', 'hazard']
  const already = touched.some((key) => listRows(key).some((row) => row['来源排期'] === batchKey))
  if (already) {
    return '联动记录已存在，未重复生成'
  }

  const propaganda = listRows('propaganda')
  const training = listRows('training')
  const hazard = listRows('hazard')
  let propagandaId = nextRowId(propaganda)
  let trainingId = nextRowId(training)
  let hazardId = nextRowId(hazard)
  let propagandaCode = nextCode(propaganda, '活动编号', 'PROP')
  let trainingCode = nextCode(training, '培训编号', 'TRAI')
  let reminders = 0

  for (const session of sessions) {
    const activityCode = `PROP-${String(propagandaCode).padStart(4, '0')}`
    propagandaCode += 1
    propaganda.push({
      id: propagandaId,
      status: '待开展',
      pending: true,
      abnormal: false,
      活动编号: activityCode,
      宣传主题: `${session.village}防灾宣传（${session.method}）`,
      宣传方式: session.method,
      覆盖村组: session.village,
      活动日期: session.date,
      参与人数: session.cover,
      组织人: session.leader,
      活动状态: '待开展',
      来源排期: batchKey,
    })
    propagandaId += 1

    training.push({
      id: trainingId,
      status: '待开展',
      pending: true,
      abnormal: false,
      培训编号: `TRAI-${String(trainingCode).padStart(4, '0')}`,
      培训主题: `${session.village}群测群防联动课（${session.method}）`,
      培训对象: `${session.village}群测群防员及受威胁群众`,
      培训日期: session.date,
      授课人: session.leader,
      参训人数: session.cover,
      考核通过率: '待考核',
      培训状态: '待开展',
      来源排期: batchKey,
      联动活动: activityCode,
    })
    trainingId += 1
    trainingCode += 1

    const village = villageOf(session.village)
    for (const point of village?.hazards ?? []) {
      hazard.push({
        id: hazardId,
        status: '新增',
        pending: true,
        abnormal: false,
        隐患点编号: point,
        隐患点名称: `宣传提醒｜${session.village}｜${session.method}｜${session.date}`,
        灾害类型: '宣传提醒',
        所在乡镇: session.township,
        经纬度坐标: '—',
        威胁户数: '—',
        威胁人口: village?.threatened ?? '—',
        隐患状态: '待宣传',
        来源排期: batchKey,
        联动活动: activityCode,
      })
      hazardId += 1
      reminders += 1
    }
  }

  saveRows('propaganda', propaganda)
  saveRows('training', training)
  saveRows('hazard', hazard)
  return `防灾宣传活动 ${sessions.length} 场、群测群防联动课程 ${sessions.length} 门、隐患点宣传提醒 ${reminders} 条`
}

// 确认当前排期批次：整批生效或整批不生效。重复确认只保留一版。
export function confirmBatch(): ServiceResult {
  const state = cloneState()
  const batch = state.batches.find((item) => item.key === state.currentBatch)
  if (!batch) {
    return { ok: false, message: '没有当前排期批次' }
  }
  if (batch.status === '已确认') {
    return { ok: true, message: `排期 ${batch.key} 已确认过，仅保留一版，未重复生成联动记录` }
  }
  const pending = state.sessions.filter((item) => item.batch === batch.key && item.status === '待确认')
  if (!pending.length) {
    // 重复确认同一排期：上一批已确认过就只保留一版，按幂等成功返回，不重复生成
    const lastDone = [...state.batches].reverse().find((item) => item.status === '已确认')
    if (lastDone) {
      return {
        ok: true,
        message: `排期 ${lastDone.key} 已确认过，仅保留一版，未重复生成联动记录；当前批次 ${batch.key} 还没有场次`,
      }
    }
    return { ok: false, message: `排期 ${batch.key} 没有待确认场次，请先排期或按乡镇补齐` }
  }

  const blocked: string[] = []
  const conflicts = detectConflicts(state.sessions)
  for (const session of pending) {
    const reasons = conflicts.get(session.id)
    if (reasons?.length) {
      blocked.push(`${session.village}·${session.method}（${session.date}）：${reasons.join('；')}，请顺延或移除`)
    }
  }
  for (const session of pending) {
    const related = state.borrows.filter((item) => item.sessionId === session.id)
    const waiting = related.filter((item) => item.status === '待确认')
    const denied = related.filter((item) => item.status === '已拒绝')
    if (waiting.length) {
      const list = waiting.map((item) => `${item.material}×${item.qty}（权属${item.owner}）`).join('、')
      blocked.push(`${session.village}·${session.method}（${session.date}）：跨村借用${list}待权属确认`)
    }
    if (denied.length) {
      const list = denied.map((item) => `${item.material}×${item.qty}（权属${item.owner}）`).join('、')
      blocked.push(`${session.village}·${session.method}（${session.date}）：借用${list}已被权属村组拒绝，请移除场次或调整物资`)
    }
  }
  const usage = materialUsage(state.sessions)
  for (const [name, used] of usage) {
    const seed = materialOf(name)
    if (seed && used.confirmed + used.pending > seed.total) {
      blocked.push(
        `物资「${name}」余量不足：本批确认后共需 ${used.confirmed + used.pending}${seed.unit}，权属库存仅 ${seed.total}${seed.unit}`,
      )
    }
  }
  if (blocked.length) {
    return { ok: false, message: `排期 ${batch.key} 暂不能确认，还有 ${blocked.length} 项要先处理`, detail: blocked }
  }

  for (const session of pending) {
    session.status = '已确认'
  }
  batch.status = '已确认'
  batch.confirmedAt = today()
  const generated = generateLinkedRecords(batch.key, pending)
  const nextKey = `SCH-${String(nextSeq(state)).padStart(4, '0')}`
  state.batches.push({ key: nextKey, status: '待确认' })
  state.currentBatch = nextKey
  saveCoverage(state)
  return {
    ok: true,
    message: `排期 ${batch.key} 已确认：${pending.length} 场活动生效，已生成${generated}；新批次 ${nextKey} 已开启`,
  }
}

// 重置热区台：清掉排期状态，同时撤下各模块里由排期生成的联动记录
export function resetCoverageBoard(): ServiceResult {
  resetCoverage()
  for (const key of ['propaganda', 'training', 'hazard']) {
    const rows = listRows(key).filter((row) => !row['来源排期'])
    saveRows(key, rows)
  }
  return { ok: true, message: '覆盖热区台已重置，联动生成的活动、课程与宣传提醒已一并撤下' }
}
