// 覆盖热区台冒烟测试：esbuild 打包 scripts/coverage-smoke.ts 后用 node 跑。
// 用法：npm run smoke
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outfile = join(root, 'node_modules', '.cache', 'coverage-smoke.mjs')

await build({
  entryPoints: [join(root, 'scripts', 'coverage-smoke.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': join(root, 'src') },
  outfile,
})

const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
process.exit(run.status ?? 1)
