// 覆盖热区台的数据模型与本地持久化：乡镇→村组→宣传方式 的排期、人员、物资、借用单与确认批次。
// 与 local-store 同思路：数据放 localStorage，刷新不丢；独立于业务模块清单，互不干扰。

export type VillageGroup = {
  id: string
  name: string
  township: string
  population: number // 应覆盖人数
  coveredHistory: number // 历史已覆盖人数
}

export type Venue = {
  id: string
  name: string
  township: string
  village: string // 所在村组 id，乡镇级场地填所属乡镇政府所在村组
  scope: '乡镇' | '村组' // 补齐优先用村组级场地，乡镇级场地留给大型集中宣讲
  capacity: number
}

export type Worker = {
  id: string
  name: string
  township: string
  role: string
}

export type Material = {
  id: string
  name: string
  township: string
  ownerVillage: string // 权属村组 id：跨村借用就发生在 ownerVillage 与用物村组不一致时
  total: number
}

export type MaterialAllocation = {
  materialId: string
  quantity: number
}

export type SessionStatus = '待确认' | '已确认' | '冲突暂缓'

export type PlanSession = {
  id: string
  township: string
  village: string // 村组 id
  method: string // 宣传方式
  date: string
  venueId: string
  workerIds: string[]
  allocations: MaterialAllocation[]
  plannedCoverage: number
  makeUp: boolean // 是否「缺覆盖补齐」生成，补齐场次冲突时优先
  status: SessionStatus
  note: string
  batchId: string // 确认批次，未确认为空
}

export type BorrowStatus = '待权属确认' | '已同意' | '已拒绝'

export type BorrowRequest = {
  id: string
  sessionId: string
  materialId: string
  fromVillage: string // 权属村组 id
  toVillage: string // 借入村组 id
  quantity: number
  status: BorrowStatus
}

export type ConfirmBatch = {
  id: string
  signature: string // 排期签名：同一排期重复确认时凭它只保留一版
  confirmedAt: string
  sessionIds: string[]
  conflicts: { id: string; reason: string }[]
}

export type CoverageState = {
  villages: VillageGroup[]
  venues: Venue[]
  workers: Worker[]
  materials: Material[]
  sessions: PlanSession[]
  borrows: BorrowRequest[]
  batches: ConfirmBatch[]
  seq: { session: number; borrow: number; batch: number }
}

const STORAGE_KEY = 'geohazard-monitor-prevention:coverage'

export const PUBLICITY_METHODS = ['集中宣讲', '入户宣传', '院坝会', '村村响广播']

function seedState(): CoverageState {
  return {
    villages: [
      { id: 'VG-01', name: '青溪社区', township: '青溪镇', population: 520, coveredHistory: 500 },
      { id: 'VG-02', name: '石坝村', township: '青溪镇', population: 410, coveredHistory: 120 },
      { id: 'VG-03', name: '瓦窑村', township: '青溪镇', population: 260, coveredHistory: 40 },
      { id: 'VG-04', name: '沙河社区', township: '沙河镇', population: 610, coveredHistory: 600 },
      { id: 'VG-05', name: '双河村', township: '沙河镇', population: 380, coveredHistory: 90 },
      { id: 'VG-06', name: '桂花村', township: '沙河镇', population: 300, coveredHistory: 260 },
    ],
    venues: [
      { id: 'V-01', name: '青溪镇文化广场', township: '青溪镇', village: 'VG-01', scope: '乡镇', capacity: 300 },
      { id: 'V-02', name: '青溪社区活动中心', township: '青溪镇', village: 'VG-01', scope: '村组', capacity: 120 },
      { id: 'V-03', name: '石坝村村委会院坝', township: '青溪镇', village: 'VG-02', scope: '村组', capacity: 150 },
      { id: 'V-04', name: '瓦窑村小学操场', township: '青溪镇', village: 'VG-03', scope: '村组', capacity: 130 },
      { id: 'V-05', name: '沙河镇文化站', township: '沙河镇', village: 'VG-04', scope: '乡镇', capacity: 260 },
      { id: 'V-06', name: '双河村晒场', township: '沙河镇', village: 'VG-05', scope: '村组', capacity: 120 },
      { id: 'V-07', name: '桂花村活动室', township: '沙河镇', village: 'VG-06', scope: '村组', capacity: 100 },
    ],
    workers: [
      { id: 'W-01', name: '王磊', township: '青溪镇', role: '宣传干事' },
      { id: 'W-02', name: '李娟', township: '青溪镇', role: '群测群防专干' },
      { id: 'W-03', name: '赵强', township: '青溪镇', role: '应急队员' },
      { id: 'W-04', name: '陈芳', township: '沙河镇', role: '宣传干事' },
      { id: 'W-05', name: '刘洋', township: '沙河镇', role: '群测群防专干' },
      { id: 'W-06', name: '周敏', township: '沙河镇', role: '应急队员' },
    ],
    materials: [
      { id: 'M-01', name: '宣传手册', township: '青溪镇', ownerVillage: 'VG-01', total: 600 },
      { id: 'M-02', name: '宣传横幅', township: '青溪镇', ownerVillage: 'VG-01', total: 6 },
      { id: 'M-03', name: '便携喇叭', township: '青溪镇', ownerVillage: 'VG-01', total: 2 },
      { id: 'M-04', name: '宣传手册', township: '青溪镇', ownerVillage: 'VG-02', total: 200 },
      { id: 'M-05', name: '宣传横幅', township: '青溪镇', ownerVillage: 'VG-02', total: 3 },
      { id: 'M-06', name: '宣传手册', township: '青溪镇', ownerVillage: 'VG-03', total: 100 },
      { id: 'M-07', name: '宣传横幅', township: '青溪镇', ownerVillage: 'VG-03', total: 2 },
      { id: 'M-08', name: '宣传手册', township: '沙河镇', ownerVillage: 'VG-04', total: 500 },
      { id: 'M-09', name: '宣传横幅', township: '沙河镇', ownerVillage: 'VG-04', total: 5 },
      { id: 'M-10', name: '宣传手册', township: '沙河镇', ownerVillage: 'VG-05', total: 60 },
      { id: 'M-11', name: '宣传横幅', township: '沙河镇', ownerVillage: 'VG-05', total: 2 },
      { id: 'M-12', name: '宣传手册', township: '沙河镇', ownerVillage: 'VG-06', total: 200 },
      { id: 'M-13', name: '宣传横幅', township: '沙河镇', ownerVillage: 'VG-06', total: 2 },
    ],
    sessions: [
      {
        id: 'PS-0001',
        township: '青溪镇',
        village: 'VG-02',
        method: '集中宣讲',
        date: '2026-10-12',
        venueId: 'V-01',
        workerIds: ['W-01', 'W-02'],
        allocations: [
          { materialId: 'M-04', quantity: 150 },
          { materialId: 'M-05', quantity: 1 },
        ],
        plannedCoverage: 150,
        makeUp: false,
        status: '待确认',
        note: '',
        batchId: '',
      },
      {
        // 与 PS-0001 同场地同日，覆盖人数更少，确认时按优先规则暂缓
        id: 'PS-0002',
        township: '青溪镇',
        village: 'VG-03',
        method: '院坝会',
        date: '2026-10-12',
        venueId: 'V-01',
        workerIds: ['W-03'],
        allocations: [
          { materialId: 'M-06', quantity: 100 },
          { materialId: 'M-07', quantity: 1 },
        ],
        plannedCoverage: 120,
        makeUp: false,
        status: '待确认',
        note: '',
        batchId: '',
      },
      {
        // 与 PS-0001 同人员（W-01）同日，确认时按优先规则暂缓
        id: 'PS-0003',
        township: '青溪镇',
        village: 'VG-01',
        method: '入户宣传',
        date: '2026-10-12',
        venueId: 'V-02',
        workerIds: ['W-01'],
        allocations: [{ materialId: 'M-01', quantity: 60 }],
        plannedCoverage: 60,
        makeUp: false,
        status: '待确认',
        note: '',
        batchId: '',
      },
      {
        // 双河村手册不足，跨村借沙河社区 40 本，权属确认前场次不可确认
        id: 'PS-0004',
        township: '沙河镇',
        village: 'VG-05',
        method: '院坝会',
        date: '2026-10-13',
        venueId: 'V-06',
        workerIds: ['W-05'],
        allocations: [
          { materialId: 'M-10', quantity: 60 },
          { materialId: 'M-08', quantity: 40 },
        ],
        plannedCoverage: 100,
        makeUp: false,
        status: '待确认',
        note: '',
        batchId: '',
      },
    ],
    borrows: [
      {
        id: 'BR-0001',
        sessionId: 'PS-0004',
        materialId: 'M-08',
        fromVillage: 'VG-04',
        toVillage: 'VG-05',
        quantity: 40,
        status: '待权属确认',
      },
    ],
    batches: [],
    seq: { session: 1000, borrow: 1000, batch: 0 },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readState(): CoverageState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return { ...fallback, ...(JSON.parse(raw) as CoverageState) }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: CoverageState | null = null

export function coverageState(): CoverageState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function saveCoverage(state: CoverageState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetCoverage(): CoverageState {
  const fresh = clone(seedState())
  saveCoverage(fresh)
  return fresh
}
