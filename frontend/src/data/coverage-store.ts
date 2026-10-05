import type { CoverageState } from './coverage'

// 排期状态单独存一个 localStorage 键，和业务清单（entries）互不干扰。
const STORAGE_KEY = 'geohazard-monitor-prevention:coverage'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function freshState(): CoverageState {
  return {
    sessions: [],
    borrows: [],
    batches: [{ key: 'SCH-0001', status: '待确认' }],
    currentBatch: 'SCH-0001',
    seq: 1,
  }
}

function readStorage(): CoverageState {
  const fallback = freshState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as CoverageState
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: CoverageState | null = null

export function coverageState(): CoverageState {
  if (cache === null) {
    cache = readStorage()
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
  const state = freshState()
  saveCoverage(state)
  return state
}

export function nextSeq(state: CoverageState): number {
  state.seq += 1
  return state.seq
}

export function cloneState(): CoverageState {
  return clone(coverageState())
}
