// 覆盖热区台的领域数据：乡镇/村组/人员/物资在这里播种，排期状态由 coverage-store 持久化。

export type VillageSeed = {
  name: string // 村组名称
  township: string // 所属乡镇
  population: number // 常住人口
  targetCover: number // 本轮目标覆盖人数
  historyCover: number // 上一轮实际覆盖人数（判定历史缺覆盖用）
  threatened: number // 隐患点威胁人口
  hazards: string[] // 关联隐患点编号（确认排期时生成宣传提醒用）
  venue: string // 本村默认场地
}

export type PersonnelSeed = {
  name: string
  township: string
  role: string // 宣讲员 / 群测群防员 / 联络员
}

export type MaterialSeed = {
  name: string
  owner: string // 权属村组：跨村使用需权属确认
  total: number
  unit: string
}

export type SessionMaterial = {
  name: string
  qty: number
  owner: string // 物资权属村组，快照在场次上
}

export type Session = {
  id: number
  batch: string // 所属排期批次号
  township: string
  village: string
  method: string // 宣传方式
  date: string // 活动日期 YYYY-MM-DD
  venue: string // 场地
  cover: number // 预计覆盖人数
  leader: string // 负责人（占用人员）
  materials: SessionMaterial[]
  status: '待确认' | '已确认'
  seq: number // 提交顺序，冲突时「提交早优先」用
  auto: boolean // 是否乡镇补齐自动生成
}

export type BorrowOrder = {
  id: number
  sessionId: number
  material: string
  qty: number
  owner: string // 权属村组
  borrower: string // 借入村组
  status: '待确认' | '已同意' | '已拒绝'
}

export type BatchInfo = {
  key: string
  status: '待确认' | '已确认'
  confirmedAt?: string
}

export type CoverageState = {
  sessions: Session[]
  borrows: BorrowOrder[]
  batches: BatchInfo[]
  currentBatch: string
  seq: number // 全局自增序号（场次 id、借用单 id、批次号共用）
}

export const PUBLICITY_METHODS = ['集中宣讲', '入户走访', '校园宣传', '演练结合']

// 历史覆盖率低于该值视为「历史缺覆盖村组」
export const HISTORY_GAP_RATIO = 0.6

export const TOWNSHIPS: string[] = ['青云镇', '柳林镇', '石桥乡']

export const VILLAGES: VillageSeed[] = [
  { name: '张家村', township: '青云镇', population: 860, targetCover: 690, historyCover: 640, threatened: 46, hazards: ['HAZA-0001'], venue: '张家村文化广场' },
  { name: '李家沟', township: '青云镇', population: 620, targetCover: 500, historyCover: 80, threatened: 38, hazards: ['HAZA-0002'], venue: '李家沟村委会院坝' },
  { name: '王家坪', township: '青云镇', population: 540, targetCover: 430, historyCover: 410, threatened: 21, hazards: ['HAZA-0003'], venue: '王家坪小学操场' },
  { name: '柳林村', township: '柳林镇', population: 980, targetCover: 780, historyCover: 750, threatened: 52, hazards: ['HAZA-0004'], venue: '柳林村文化广场' },
  { name: '河口村', township: '柳林镇', population: 710, targetCover: 570, historyCover: 120, threatened: 67, hazards: ['HAZA-0005'], venue: '河口村渡口院坝' },
  { name: '石桥村', township: '石桥乡', population: 650, targetCover: 520, historyCover: 90, threatened: 33, hazards: ['HAZA-0006'], venue: '石桥村村委会会议室' },
]

// 乡镇级共享场地：跨村组共用，容易撞期，用来体现场地冲突
export const SHARED_VENUES: Record<string, string[]> = {
  青云镇: ['青云镇文化站'],
  柳林镇: ['柳林镇礼堂'],
  石桥乡: ['石桥乡便民服务中心'],
}

export const PERSONNEL: PersonnelSeed[] = [
  { name: '陈立', township: '青云镇', role: '宣讲员' },
  { name: '王芳', township: '青云镇', role: '群测群防员' },
  { name: '刘洋', township: '青云镇', role: '联络员' },
  { name: '赵强', township: '柳林镇', role: '宣讲员' },
  { name: '孙梅', township: '柳林镇', role: '群测群防员' },
  { name: '周斌', township: '石桥乡', role: '宣讲员' },
  { name: '吴霞', township: '石桥乡', role: '群测群防员' },
  { name: '郑凯', township: '石桥乡', role: '联络员' },
]

export const MATERIALS: MaterialSeed[] = [
  { name: '宣传折页', owner: '柳林村', total: 500, unit: '份' },
  { name: '警示横幅', owner: '张家村', total: 10, unit: '条' },
  { name: '扩音喇叭', owner: '张家村', total: 2, unit: '台' },
  { name: '应急手电', owner: '河口村', total: 30, unit: '把' },
  { name: '雨衣', owner: '石桥村', total: 50, unit: '件' },
  { name: '折叠椅', owner: '李家沟', total: 40, unit: '把' },
]

// 乡镇补齐时每个村组标配的物资包
export const STANDARD_KIT: { name: string; qty: number }[] = [
  { name: '宣传折页', qty: 50 },
  { name: '警示横幅', qty: 2 },
  { name: '扩音喇叭', qty: 1 },
]

export function villageOf(name: string): VillageSeed | undefined {
  return VILLAGES.find((item) => item.name === name)
}

export function isHistoryGap(village: VillageSeed): boolean {
  return village.historyCover / village.population < HISTORY_GAP_RATIO
}

export function materialOf(name: string): MaterialSeed | undefined {
  return MATERIALS.find((item) => item.name === name)
}

export function venuesOf(township: string, village: string): string[] {
  const own = villageOf(village)?.venue
  const shared = SHARED_VENUES[township] ?? []
  return [...(own ? [own] : []), ...shared]
}
