// 冒烟测试入口：用 esbuild 打包后在 node 里跑，localStorage 用内存 Map 顶替。
const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
}

let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ok: ${msg}`)
  } else {
    failures += 1
    console.error(`  FAIL: ${msg}`)
  }
}

async function main() {
  const svc = await import('@/api/coverage-service')
  const { listRows } = await import('@/data/local-store')

  const tagged = (key: string) => listRows(key).filter((row) => row['来源排期'])

  console.log('1. 初始热区台')
  let board = svc.loadBoard()
  assert(board.rows.length === 6, `6 个村组行（实际 ${board.rows.length}）`)
  assert(board.stats[1].value === 3, `3 个历史缺覆盖村组（实际 ${board.stats[1].value}）`)
  assert(board.rows.every((row) => row.gap === row.target), '未排期时缺口等于目标覆盖')

  console.log('2. 按乡镇补齐历史缺覆盖村组')
  let result = svc.autofillTownship('青云镇')
  assert(result.ok, `青云镇补齐：${result.message}`)
  board = svc.loadBoard()
  assert(board.sessions.length === 1 && board.sessions[0].village === '李家沟', '李家沟自动生成 1 场')
  assert(board.sessions[0].auto, '补齐场次带「乡镇补齐」标记')
  assert(board.borrows.length === 3, `标准物资包产生 3 张跨村借用单（实际 ${board.borrows.length}）`)
  const gapRow = board.rows.find((row) => row.village === '李家沟')
  assert(gapRow?.gap === 0, '补齐后李家沟缺口归零')

  console.log('3. 借用未确认前排期不能确认')
  result = svc.confirmBatch()
  assert(!result.ok && (result.detail?.length ?? 0) > 0, `确认被借用单拦住：${result.message}`)

  console.log('4. 权属确认后排期生效并生成联动记录')
  for (const order of svc.loadBoard().borrows) {
    svc.decideBorrow(order.id, true)
  }
  result = svc.confirmBatch()
  assert(result.ok, `确认成功：${result.message}`)
  assert(tagged('propaganda').length === 1, '防灾宣传生成 1 场活动')
  assert(tagged('training').length === 1, '群测群防培训生成 1 门联动课程')
  assert(tagged('hazard').length === 1, '隐患点台账生成 1 条宣传提醒')
  const linked = tagged('training')[0]
  assert(String(linked['联动活动'] ?? '').startsWith('PROP-'), `联动课程回引活动编号 ${linked['联动活动']}`)
  board = svc.loadBoard()
  assert(board.sessions[0].status === '已确认', '场次状态变为已确认')
  const horn = board.materials.find((item) => item.name === '扩音喇叭')
  assert(horn?.remain === 1, `扩音喇叭余量 2-1=1（实际 ${horn?.remain}）`)

  console.log('5. 同一排期重复确认只保留一版')
  result = svc.confirmBatch()
  assert(result.ok && result.message.includes('仅保留一版'), `重复确认幂等：${result.message}`)
  assert(tagged('propaganda').length === 1 && tagged('training').length === 1, '联动记录没有翻倍')

  console.log('6. 场地冲突按优先规则落选，顺延后可确认')
  const date = '2026-10-20'
  svc.addSession({ township: '青云镇', village: '张家村', method: '集中宣讲', date, venue: '青云镇文化站', cover: 200, leader: '陈立', materials: [] })
  svc.addSession({ township: '青云镇', village: '王家坪', method: '入户走访', date, venue: '青云镇文化站', cover: 100, leader: '王芳', materials: [] })
  board = svc.loadBoard()
  const conflicted = board.sessions.filter((item) => item.conflicts.length > 0)
  assert(conflicted.length === 1 && conflicted[0].village === '王家坪', '威胁人口少的王家坪落选（张家村威胁人口 46 > 21）')
  result = svc.confirmBatch()
  assert(!result.ok, '有冲突待调时整批不能确认')
  const loser = conflicted[0]
  result = svc.postponeSession(loser.id)
  assert(result.ok, `落选场次顺延：${result.message}`)
  board = svc.loadBoard()
  assert(board.sessions.every((item) => item.conflicts.length === 0), '顺延后再无冲突')
  result = svc.confirmBatch()
  assert(result.ok, `冲突消解后确认：${result.message}`)
  assert(tagged('propaganda').length === 3, '防灾宣传累计生成 3 场活动')

  console.log('7. 跨村借用被权属村组拒绝后不能确认')
  svc.addSession({ township: '石桥乡', village: '石桥村', method: '校园宣传', date: '2026-10-22', venue: '石桥村村委会会议室', cover: 80, leader: '周斌', materials: [{ name: '应急手电', qty: 5 }] })
  board = svc.loadBoard()
  const denied = board.borrows.find((item) => item.status === '待确认')
  assert(!!denied && denied.owner === '河口村', '石桥村借河口村的应急手电产生借用单')
  svc.decideBorrow(denied!.id, false)
  result = svc.confirmBatch()
  assert(!result.ok && (result.detail ?? []).some((item) => item.includes('拒绝')), `借用被拒后确认被拦：${result.detail?.join('；') ?? result.message}`)

  console.log('8. 重置热区台，联动记录一并撤下')
  result = svc.resetCoverageBoard()
  assert(result.ok, result.message)
  assert(tagged('propaganda').length === 0 && tagged('training').length === 0 && tagged('hazard').length === 0, '三个模块的联动记录全部撤下')
  board = svc.loadBoard()
  assert(board.sessions.length === 0 && board.borrows.length === 0, '排期与借用单清空')

  if (failures > 0) {
    console.error(`\n${failures} 项未通过`)
    process.exit(1)
  }
  console.log('\n全部通过')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
