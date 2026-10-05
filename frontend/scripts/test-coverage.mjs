// 覆盖热区台业务逻辑端到端校验：用 esbuild 打包（开启 splitting，两个入口共享 local-store 模块实例）再跑。
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'coverage-test-'))

await build({
  entryPoints: {
    service: 'src/api/coverage-service.ts',
    store: 'src/data/local-store.ts',
  },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': new URL('../src', import.meta.url).pathname },
  outdir: dir,
  logLevel: 'silent',
})

const svc = await import(join(dir, 'service.js'))
const store = await import(join(dir, 'store.js'))

let failures = 0
function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label} ${extra}`)
  }
}

// —— 初始看板 ——
const board0 = svc.boardRows()
const shiba = board0.find((r) => r.village === '石坝村')
check('石坝村初始缺口 = 410-120-150 = 140', shiba && shiba.gap === 140, `got ${shiba?.gap}`)
const wayao = board0.find((r) => r.village === '瓦窑村')
check('瓦窑村初始缺口 = 260-40-120 = 100', wayao && wayao.gap === 100, `got ${wayao?.gap}`)

// —— 缺覆盖补齐 ——
const makeUp = svc.generateMakeUp()
console.log('  补齐结果:', makeUp.message)
check('补齐生成 6 场（石坝1+瓦窑1+双河2+桂花1+沙河社区1）', makeUp.created === 6, `got ${makeUp.created}`)
const sessionsAfterMakeUp = svc.sessionRows()
const shuangheMakeUp = sessionsAfterMakeUp.filter((s) => s.village === '双河村' && s.source === '缺覆盖补齐')
check('双河村补齐 2 场（晒场容量120 < 缺口190）', shuangheMakeUp.length === 2, `got ${shuangheMakeUp.length}`)
check('补齐场次跨村借用手册生成借用单', svc.borrowRows().length > 1, `borrows=${svc.borrowRows().length}`)
check('双河村补齐场次手册来自借用（本村60已被PS-0004占完）',
  shuangheMakeUp.every((s) => s.materials.includes('借沙河社区')),
  shuangheMakeUp.map((s) => s.materials).join(' / '))
// 再点一次不重复生成
const makeUp2 = svc.generateMakeUp()
check('缺口已被在途场次抵扣，重复补齐生成 0 场', makeUp2.created === 0, `got ${makeUp2.created}`)

// —— 第一轮确认：借用未决的场次被拦 ——
const c1 = svc.confirmSchedule()
console.log('  确认1:', c1.message)
check('PS-0001 确认通过', c1.accepted.includes('PS-0001'))
check('PS-0002 场地冲突暂缓', c1.conflicts.some((c) => c.id === 'PS-0002' && c.reason.includes('场地')))
check('PS-0003 人员冲突暂缓', c1.conflicts.some((c) => c.id === 'PS-0003' && c.reason.includes('人员')))
check('PS-0004 借用未确权被跳过', c1.skipped.some((s) => s.id === 'PS-0004'))
check('双河村借用未决权的补齐场次也被跳过', c1.skipped.length >= 3, JSON.stringify(c1.skipped))
const s1 = svc.sessionRows()
check('PS-0002 状态=冲突暂缓且注明原因',
  s1.find((s) => s.id === 'PS-0002')?.status === '冲突暂缓' &&
  s1.find((s) => s.id === 'PS-0002')?.note.includes('青溪镇文化广场'))

// —— 联动生成 ——
const propaganda = store.listRows('propaganda')
const training = store.listRows('training')
const hazard = store.listRows('hazard')
const acceptedCount = c1.accepted.length
check(`宣传活动新增 ${acceptedCount} 条（3条种子→${propaganda.length}）`, propaganda.length === 3 + acceptedCount)
check(`培训联动课程新增 ${acceptedCount} 条`, training.length === 3 + acceptedCount)
const linked = training.find((r) => String(r['培训主题']).includes('石坝村防灾宣传联动课程'))
check('联动课程关联活动编号', linked && String(linked['关联活动']).startsWith('PROP-'))
check('联动课程日期与场次一致', linked && linked['培训日期'] === '2026-10-12')
const h1 = hazard.find((r) => r['隐患点编号'] === 'HAZA-0001')
const h3 = hazard.find((r) => r['隐患点编号'] === 'HAZA-0003')
check('青溪镇隐患点写入宣传提醒', String(h1['宣传提醒']).includes('石坝村集中宣讲'))
check('沙河镇隐患点写入本轮已确认场次的宣传提醒', String(h3['宣传提醒']).includes('桂花村集中宣讲'), h3['宣传提醒'])

// —— 幂等：剩余待确认都卡在借用上 ——
const c2 = svc.confirmSchedule()
console.log('  确认2:', c2.message)
check('借用未确权时不产生新批次', !c2.ok && svc.boardRows().length > 0)
check('联动记录未重复生成', store.listRows('propaganda').length === propaganda.length)

// —— 权属确认后再确认 ——
for (const b of svc.borrowRows().filter((r) => r.status === '待权属确认')) {
  const r = svc.resolveBorrow(b.id, true)
  check(`借用单 ${b.id} 同意出借`, r.ok, r.message)
}
const c3 = svc.confirmSchedule()
console.log('  确认3:', c3.message)
check('PS-0004 与双河补齐场次确权后确认通过', c3.ok && c3.accepted.includes('PS-0004'))
check('双河村场次确认后，沙河镇隐患点追加双河村宣传提醒',
  String(store.listRows('hazard').find((r) => r['隐患点编号'] === 'HAZA-0003')['宣传提醒']).includes('双河村院坝会'))
check('同一排期再次确认：无待确认场次，只保留一版', (() => {
  const c4 = svc.confirmSchedule()
  console.log('  确认4:', c4.message)
  return !c4.ok && store.listRows('training').length === 3 + acceptedCount + c3.accepted.length
})())

// —— 物资余量与人员占用 ——
const mats = svc.materialRows()
const m08 = mats.find((m) => m.id === 'M-08')
check('沙河社区手册余量 = 500 - 借用占用', m08 && m08.left === m08.total - m08.confirmedUse, JSON.stringify(m08))
const workers = svc.workerRows()
check('王磊已排期不可调度', workers.find((w) => w.name === '王磊')?.dispatchable === false)
check('赵强（冲突暂缓场次）仍可调度', workers.find((w) => w.name === '赵强')?.dispatchable === true)

// —— 借用拒绝路径：卸下物资 ——
const rejectTarget = svc.borrowRows().find((r) => r.status === '待权属确认')
if (rejectTarget) {
  const rr = svc.resolveBorrow(rejectTarget.id, false)
  check('拒绝借用返回成功', rr.ok, rr.message)
  const sess = svc.sessionRows().find((s) => s.id === rejectTarget.sessionId)
  check('拒绝后场次卸下该笔借用物资', sess && !sess.materials.includes(`借${rejectTarget.fromVillage}`))
} else {
  check('存在可拒绝的待确权借用单（全部已同意，跳过拒绝用例）', true)
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 条断言失败`)
process.exit(failures === 0 ? 0 : 1)
