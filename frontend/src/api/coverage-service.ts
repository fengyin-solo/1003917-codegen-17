// 覆盖热区台业务逻辑：看板聚合、缺覆盖补齐、确认排期（冲突裁决 + 幂等 + 联动生成）、跨村借用审批。
import {
  PUBLICITY_METHODS,
  coverageState,
  saveCoverage,
  type CoverageState,
  type Material,
  type PlanSession,
} from '@/data/coverage'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// —— 冲突优先规则（既定）：缺覆盖补齐场次优先 → 计划覆盖人数多者优先 → 场次编号小者优先 ——
export const PRIORITY_RULE = '缺覆盖补齐场次优先 → 计划覆盖人数多者优先 → 先排期者优先'

const MAKEUP_BASE_DATE = '2026-10-14' // 补齐场次从该日期起找空闲日
const MAKEUP_MAX_PER_VILLAGE = 5 // 单次补齐每村上限，防止异常数据下死循环

export type BoardRow = {
  township: string
  villageId: string
  village: string
  method: string
  sessions: number
  confirmedCover: number
  pendingCover: number
  coveredHistory: number
  population: number
  gap: number
}

export type SessionRow = {
  id: string
  township: string
  village: string
  method: string
  date: string
  venue: string
  workers: string
  plannedCoverage: number
  materials: string
  source: string
  status: string
  note: string
}

export type WorkerRow = {
  id: string
  name: string
  township: string
  role: string
  booked: number
  dates: string
  dispatchable: boolean
}

export type MaterialRow = {
  id: string
  name: string
  township: string
  ownerVillage: string
  total: number
  confirmedUse: number
  pendingUse: number
  left: number
}

export type BorrowRow = {
  id: string
  sessionId: string
  material: string
  fromVillage: string
  toVillage: string
  quantity: number
  status: string
}

export type ConfirmResult = {
  ok: boolean
  message: string
  accepted: string[]
  conflicts: { id: string; reason: string }[]
  skipped: { id: string; reason: string }[]
  duplicated: boolean
}

function villageName(state: CoverageState, id: string): string {
  return state.villages.find((item) => item.id === id)?.name ?? id
}

function venueName(state: CoverageState, id: string): string {
  return state.venues.find((item) => item.id === id)?.name ?? id
}

function workerName(state: CoverageState, id: string): string {
  return state.workers.find((item) => item.id === id)?.name ?? id
}

function materialOf(state: CoverageState, id: string): Material | undefined {
  return state.materials.find((item) => item.id === id)
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00`)
  base.setDate(base.getDate() + days)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 在途覆盖：待确认场次占用指标，冲突暂缓的不算（需重排）。 */
function liveSessions(state: CoverageState): PlanSession[] {
  return state.sessions.filter((item) => item.status !== '冲突暂缓')
}

function villageGap(state: CoverageState, villageId: string): number {
  const village = state.villages.find((item) => item.id === villageId)
  if (!village) {
    return 0
  }
  const booked = liveSessions(state)
    .filter((item) => item.village === villageId)
    .reduce((sum, item) => sum + item.plannedCoverage, 0)
  return Math.max(0, village.population - village.coveredHistory - booked)
}

/** 覆盖热区看板：乡镇 → 村组 → 宣传方式 的计划场次、覆盖人数与缺口。 */
export function boardRows(): BoardRow[] {
  const state = coverageState()
  const rows: BoardRow[] = []
  for (const village of state.villages) {
    const sessions = state.sessions.filter((item) => item.village === village.id)
    const methods = [...new Set(sessions.map((item) => item.method))]
    if (methods.length === 0) {
      rows.push({
        township: village.township,
        villageId: village.id,
        village: village.name,
        method: '—',
        sessions: 0,
        confirmedCover: 0,
        pendingCover: 0,
        coveredHistory: village.coveredHistory,
        population: village.population,
        gap: villageGap(state, village.id),
      })
      continue
    }
    for (const method of methods) {
      const group = sessions.filter((item) => item.method === method)
      rows.push({
        township: village.township,
        villageId: village.id,
        village: village.name,
        method,
        sessions: group.length,
        confirmedCover: group
          .filter((item) => item.status === '已确认')
          .reduce((sum, item) => sum + item.plannedCoverage, 0),
        pendingCover: group
          .filter((item) => item.status === '待确认')
          .reduce((sum, item) => sum + item.plannedCoverage, 0),
        coveredHistory: village.coveredHistory,
        population: village.population,
        gap: villageGap(state, village.id),
      })
    }
  }
  return rows.sort(
    (a, b) => a.township.localeCompare(b.township) || a.villageId.localeCompare(b.villageId),
  )
}

/** 场次列表（看板下方），含场地、人员、物资与冲突原因。 */
export function sessionRows(): SessionRow[] {
  const state = coverageState()
  return state.sessions.map((item) => ({
    id: item.id,
    township: item.township,
    village: villageName(state, item.village),
    method: item.method,
    date: item.date,
    venue: venueName(state, item.venueId),
    workers: item.workerIds.map((id) => workerName(state, id)).join('、'),
    plannedCoverage: item.plannedCoverage,
    materials: item.allocations
      .map((alloc) => {
        const material = materialOf(state, alloc.materialId)
        if (!material) {
          return `${alloc.materialId}×${alloc.quantity}`
        }
        const borrowed = material.ownerVillage !== item.village
        const tag = borrowed ? `（借${villageName(state, material.ownerVillage)}）` : ''
        return `${material.name}×${alloc.quantity}${tag}`
      })
      .join('、') || '—',
    source: item.makeUp ? '缺覆盖补齐' : '人工排期',
    status: item.status,
    note: item.note || '—',
  }))
}

/** 可调度人员：没有被已确认场次占用即为可调度。 */
export function workerRows(): WorkerRow[] {
  const state = coverageState()
  return state.workers.map((worker) => {
    const booked = state.sessions.filter(
      (item) => item.status === '已确认' && item.workerIds.includes(worker.id),
    )
    return {
      id: worker.id,
      name: worker.name,
      township: worker.township,
      role: worker.role,
      booked: booked.length,
      dates: booked.map((item) => item.date).join('、') || '—',
      dispatchable: booked.length === 0,
    }
  })
}

/** 物资余量：总量 − 已确认占用 − 待确认占用（冲突暂缓不占用）。 */
export function materialRows(): MaterialRow[] {
  const state = coverageState()
  return state.materials.map((material) => {
    let confirmedUse = 0
    let pendingUse = 0
    for (const session of state.sessions) {
      if (session.status === '冲突暂缓') {
        continue
      }
      for (const alloc of session.allocations) {
        if (alloc.materialId !== material.id) {
          continue
        }
        if (session.status === '已确认') {
          confirmedUse += alloc.quantity
        } else {
          pendingUse += alloc.quantity
        }
      }
    }
    return {
      id: material.id,
      name: material.name,
      township: material.township,
      ownerVillage: villageName(state, material.ownerVillage),
      total: material.total,
      confirmedUse,
      pendingUse,
      left: material.total - confirmedUse - pendingUse,
    }
  })
}

export function borrowRows(): BorrowRow[] {
  const state = coverageState()
  return state.borrows.map((item) => ({
    id: item.id,
    sessionId: item.sessionId,
    material: materialOf(state, item.materialId)?.name ?? item.materialId,
    fromVillage: villageName(state, item.fromVillage),
    toVillage: villageName(state, item.toVillage),
    quantity: item.quantity,
    status: item.status,
  }))
}

function materialLeft(state: CoverageState, materialId: string): number {
  const material = materialOf(state, materialId)
  if (!material) {
    return 0
  }
  const used = liveSessions(state)
    .flatMap((item) => item.allocations)
    .filter((alloc) => alloc.materialId === materialId)
    .reduce((sum, alloc) => sum + alloc.quantity, 0)
  return material.total - used
}

function busyVenueDates(state: CoverageState, venueId: string): Set<string> {
  return new Set(
    liveSessions(state)
      .filter((item) => item.venueId === venueId)
      .map((item) => item.date),
  )
}

function busyWorkerDates(state: CoverageState, workerId: string): Set<string> {
  return new Set(
    liveSessions(state)
      .filter((item) => item.workerIds.includes(workerId))
      .map((item) => item.date),
  )
}

/**
 * 历史缺覆盖村组按所属乡镇补齐：缺口 = 应覆盖 − 历史已覆盖 − 在途场次覆盖。
 * 场地用本村场地，人员派本乡镇当天空闲人员，物资先用本村库存、不足再向同乡镇余量最多的村借用（生成待权属确认借用单）。
 */
export function generateMakeUp(): { created: number; message: string } {
  const state = coverageState()
  let created = 0
  const notes: string[] = []
  for (const village of state.villages) {
    let gap = villageGap(state, village.id)
    if (gap <= 0) {
      continue
    }
    const venue =
      state.venues.find((item) => item.village === village.id && item.scope === '村组') ??
      state.venues.find((item) => item.township === village.township && item.scope === '乡镇') ??
      state.venues.find((item) => item.township === village.township)
    if (!venue) {
      notes.push(`${village.name}：所属${village.township}没有可用场地，跳过`)
      continue
    }
    let rounds = 0
    let dayOffset = 0
    while (gap > 0 && rounds < MAKEUP_MAX_PER_VILLAGE) {
      // 找场地与两名本乡镇人员同时空闲的日期
      let date = ''
      let crew: string[] = []
      for (; dayOffset < 60; dayOffset += 1) {
        const candidate = addDays(MAKEUP_BASE_DATE, dayOffset)
        if (busyVenueDates(state, venue.id).has(candidate)) {
          continue
        }
        const free = state.workers
          .filter(
            (worker) =>
              worker.township === village.township &&
              !busyWorkerDates(state, worker.id).has(candidate),
          )
          .map((worker) => worker.id)
        if (free.length >= 2) {
          date = candidate
          crew = free.slice(0, 2)
          break
        }
      }
      if (!date) {
        notes.push(`${village.name}：60 天内排不出场地和人员，剩余缺口 ${gap} 人待协调`)
        break
      }
      const coverage = Math.min(venue.capacity, gap)
      // 物资：手册按覆盖人数、横幅 1 条；本村不足向同乡镇余量最多的村借
      const allocations: { materialId: string; quantity: number }[] = []
      const wants: { name: string; quantity: number }[] = [
        { name: '宣传手册', quantity: coverage },
        { name: '宣传横幅', quantity: 1 },
      ]
      for (const want of wants) {
        let need = want.quantity
        const own = state.materials.find(
          (item) => item.ownerVillage === village.id && item.name === want.name,
        )
        if (own) {
          const take = Math.min(need, Math.max(0, materialLeft(state, own.id)))
          if (take > 0) {
            allocations.push({ materialId: own.id, quantity: take })
            need -= take
          }
        }
        if (need > 0) {
          const donor = state.materials
            .filter(
              (item) =>
                item.name === want.name &&
                item.township === village.township &&
                item.ownerVillage !== village.id &&
                materialLeft(state, item.id) > 0,
            )
            .sort((a, b) => materialLeft(state, b.id) - materialLeft(state, a.id))[0]
          if (donor) {
            const take = Math.min(need, materialLeft(state, donor.id))
            allocations.push({ materialId: donor.id, quantity: take })
            state.seq.borrow += 1
            state.borrows.push({
              id: `BR-${String(state.seq.borrow).padStart(4, '0')}`,
              sessionId: `PS-${String(state.seq.session + 1).padStart(4, '0')}`,
              materialId: donor.id,
              fromVillage: donor.ownerVillage,
              toVillage: village.id,
              quantity: take,
              status: '待权属确认',
            })
            need -= take
          }
        }
        if (need > 0) {
          notes.push(`${village.name}：${want.name}差 ${need}，全乡库存不足`)
        }
      }
      state.seq.session += 1
      state.sessions.push({
        id: `PS-${String(state.seq.session).padStart(4, '0')}`,
        township: village.township,
        village: village.id,
        method: PUBLICITY_METHODS[rounds % PUBLICITY_METHODS.length],
        date,
        venueId: venue.id,
        workerIds: crew,
        allocations,
        plannedCoverage: coverage,
        makeUp: true,
        status: '待确认',
        note: `历史缺覆盖 ${village.coveredHistory}/${village.population} 人，按所属${village.township}补齐`,
        batchId: '',
      })
      gap -= coverage
      rounds += 1
      created += 1
      dayOffset += 1
    }
  }
  saveCoverage(state)
  const suffix = notes.length ? `；${notes.join('；')}` : ''
  return {
    created,
    message: created > 0 ? `已按所属乡镇补齐 ${created} 场缺覆盖村组活动${suffix}` : `当前没有需要补齐的缺覆盖村组${suffix}`,
  }
}

/** 排期签名：同一排期重复确认时凭它只保留一版。 */
function scheduleSignature(sessions: PlanSession[]): string {
  return sessions
    .map((item) => `${item.id}|${item.date}|${item.venueId}|${[...item.workerIds].sort().join('+')}`)
    .sort()
    .join(';')
}

function nextCode(rows: EntryRow[], field: string, prefix: string): string {
  const max = rows.reduce((acc, row) => {
    const match = String(row[field] ?? '').match(/(\d+)$/)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((acc, row) => Math.max(acc, Number(row.id) || 0), 0) + 1
}

/** 确认排期：裁决冲突、幂等落批次，并联动生成宣传活动、培训联动课程与隐患点宣传提醒。 */
export function confirmSchedule(): ConfirmResult {
  const state = coverageState()
  const result: ConfirmResult = {
    ok: false,
    message: '',
    accepted: [],
    conflicts: [],
    skipped: [],
    duplicated: false,
  }
  const pending = state.sessions.filter((item) => item.status === '待确认')
  if (pending.length === 0) {
    result.message = '没有待确认的场次；同一排期重复确认只保留一版，不会重复生成联动记录'
    result.duplicated = state.batches.length > 0
    return result
  }
  // 跨村借用未过权属确认的场次本轮跳过，保持待确认
  const blocked = new Set(
    state.borrows.filter((item) => item.status === '待权属确认').map((item) => item.sessionId),
  )
  const ready = pending.filter((item) => {
    if (blocked.has(item.id)) {
      result.skipped.push({ id: item.id, reason: '跨村借用物资待权属确认' })
      return false
    }
    return true
  })
  if (ready.length === 0) {
    result.message = '待确认场次都卡在跨村借用权属确认上，请先处理借用单'
    return result
  }
  const signature = scheduleSignature(ready)
  if (state.batches.some((item) => item.signature === signature)) {
    result.duplicated = true
    result.message = '同一排期已确认过，仅保留一版，不重复生成联动课程与宣传提醒'
    return result
  }
  // 按优先规则排序，依次占用场地与人员
  const ordered = [...ready].sort(
    (a, b) =>
      Number(b.makeUp) - Number(a.makeUp) ||
      b.plannedCoverage - a.plannedCoverage ||
      a.id.localeCompare(b.id),
  )
  const venueTaken = new Map<string, string>() // `${venueId}|${date}` -> sessionId
  const workerTaken = new Map<string, string>() // `${workerId}|${date}` -> sessionId
  for (const item of state.sessions.filter((row) => row.status === '已确认')) {
    venueTaken.set(`${item.venueId}|${item.date}`, item.id)
    for (const workerId of item.workerIds) {
      workerTaken.set(`${workerId}|${item.date}`, item.id)
    }
  }
  const accepted: PlanSession[] = []
  for (const item of ordered) {
    const venueKey = `${item.venueId}|${item.date}`
    if (venueTaken.has(venueKey)) {
      const winner = venueTaken.get(venueKey) ?? ''
      item.status = '冲突暂缓'
      item.note = `场地「${venueName(state, item.venueId)}」${item.date} 已被 ${winner} 占用，按优先规则暂缓（${PRIORITY_RULE}）`
      result.conflicts.push({ id: item.id, reason: `场地与 ${winner} 冲突` })
      continue
    }
    const busyWorker = item.workerIds.find((workerId) => workerTaken.has(`${workerId}|${item.date}`))
    if (busyWorker) {
      const winner = workerTaken.get(`${busyWorker}|${item.date}`) ?? ''
      item.status = '冲突暂缓'
      item.note = `人员「${workerName(state, busyWorker)}」${item.date} 已排给 ${winner}，按优先规则暂缓（${PRIORITY_RULE}）`
      result.conflicts.push({ id: item.id, reason: `人员与 ${winner} 冲突` })
      continue
    }
    venueTaken.set(venueKey, item.id)
    for (const workerId of item.workerIds) {
      workerTaken.set(`${workerId}|${item.date}`, item.id)
    }
    accepted.push(item)
  }
  if (accepted.length === 0) {
    saveCoverage(state)
    result.message = '本轮场次全部因冲突暂缓，未生成任何联动记录'
    return result
  }
  // 落批次
  state.seq.batch += 1
  const batchId = `PB-${String(state.seq.batch).padStart(4, '0')}`
  const confirmedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  // 联动生成：宣传活动、群测群防培训联动课程、隐患点台账宣传提醒
  const propagandaRows = listRows('propaganda')
  const trainingRows = listRows('training')
  const hazardRows = listRows('hazard')
  let propagandaId = nextId(propagandaRows)
  let trainingId = nextId(trainingRows)
  const remindedHazards = new Set<number>()
  for (const item of accepted) {
    item.status = '已确认'
    item.batchId = batchId
    item.note = item.makeUp ? item.note : ''
    const village = villageName(state, item.village)
    const workers = item.workerIds.map((id) => workerName(state, id)).join('、')
    const activityCode = nextCode(propagandaRows, '活动编号', 'PROP')
    propagandaRows.push({
      id: propagandaId,
      status: '待开展',
      pending: true,
      abnormal: false,
      活动编号: activityCode,
      宣传主题: `${village}${item.method}`,
      宣传方式: item.method,
      覆盖村组: village,
      活动日期: item.date,
      参与人数: item.plannedCoverage,
      组织人: workers,
      活动状态: '待开展',
      排期批次: batchId,
    } as EntryRow)
    propagandaId += 1
    trainingRows.push({
      id: trainingId,
      status: '待开展',
      pending: true,
      abnormal: false,
      培训编号: nextCode(trainingRows, '培训编号', 'TRAI'),
      培训主题: `${village}防灾宣传联动课程`,
      培训对象: `${village}群测群防员`,
      培训日期: item.date,
      授课人: workers,
      参训人数: item.plannedCoverage,
      考核通过率: '—',
      培训状态: '待开展',
      关联活动: activityCode,
    } as EntryRow)
    trainingId += 1
    // 隐患点台账：所在乡镇匹配的隐患点写入宣传提醒
    const reminder = `${item.date} ${village}${item.method}（${activityCode}），请组织威胁住户参加`
    for (let i = 0; i < hazardRows.length; i += 1) {
      if (String(hazardRows[i]['所在乡镇']) !== item.township) {
        continue
      }
      const old = String(hazardRows[i]['宣传提醒'] ?? '')
      hazardRows[i] = {
        ...hazardRows[i],
        宣传提醒: old ? `${old}；${reminder}` : reminder,
        pending: true,
      }
      remindedHazards.add(Number(hazardRows[i].id))
    }
    result.accepted.push(item.id)
  }
  saveRows('propaganda', propagandaRows)
  saveRows('training', trainingRows)
  saveRows('hazard', hazardRows)
  state.batches.push({
    id: batchId,
    signature,
    confirmedAt,
    sessionIds: accepted.map((item) => item.id),
    conflicts: result.conflicts,
  })
  saveCoverage(state)
  result.ok = true
  const parts = [
    `批次 ${batchId} 已确认 ${accepted.length} 场`,
    `联动生成宣传活动 ${accepted.length} 条、培训联动课程 ${accepted.length} 条、隐患点宣传提醒 ${remindedHazards.size} 条`,
  ]
  if (result.conflicts.length) {
    parts.push(`冲突暂缓 ${result.conflicts.length} 场（${result.conflicts.map((c) => c.id).join('、')}）`)
  }
  if (result.skipped.length) {
    parts.push(`借用待权属确认跳过 ${result.skipped.length} 场（${result.skipped.map((s) => s.id).join('、')}）`)
  }
  result.message = parts.join('；')
  return result
}

/** 跨村借用权属确认：同意后场次方可确认；拒绝则卸下该笔借用物资。 */
export function resolveBorrow(id: string, approve: boolean): { ok: boolean; message: string } {
  const state = coverageState()
  const borrow = state.borrows.find((item) => item.id === id)
  if (!borrow) {
    return { ok: false, message: `没有找到借用单 ${id}` }
  }
  if (borrow.status !== '待权属确认') {
    return { ok: false, message: `借用单 ${id} 已是「${borrow.status}」，不用重复处理` }
  }
  borrow.status = approve ? '已同意' : '已拒绝'
  if (!approve) {
    const session = state.sessions.find((item) => item.id === borrow.sessionId)
    if (session) {
      session.allocations = session.allocations.filter((alloc) => alloc.materialId !== borrow.materialId)
      session.note = `跨村借用 ${borrow.id} 被拒，已卸下该笔物资，请重新调配`
    }
  }
  saveCoverage(state)
  const from = villageName(state, borrow.fromVillage)
  const to = villageName(state, borrow.toVillage)
  return {
    ok: true,
    message: approve
      ? `${from}已同意借出 ${borrow.quantity} 份物资给${to}，对应场次可参与确认`
      : `${from}拒绝了${to}的借用申请，该笔物资已从场次卸下`,
  }
}
