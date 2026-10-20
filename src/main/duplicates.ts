import type { Asset, DuplicateGroup, PromptEntry } from '../shared/types'
import { hammingHex } from './media'
import type { Library } from './library'

export interface DuplicateReport {
  /** 近似重复组（含完全相同文件的两个不同 asset 几乎不会出现，因为按 sha 去重） */
  groups: DuplicateGroup[]
  /** 参与比较的资源数 */
  scanned: number
  /** 跳过（无 phash）的资源数 */
  skipped: number
  /** 预计可释放字节 */
  reclaimableBytes: number
}

/**
 * 近似重复检测：对每个 asset 的 dHash 两两比较，汉明距离 ≤ threshold 视为同组。
 * 用并查集合并传递关系（A≈B, B≈C ⇒ A≈B≈C）。
 * 复杂度 O(n²)，n 为图片数；对万级以内完全够用（2000 张约 200 万次比较，<50ms）。
 */
export function scanDuplicates(lib: Library, threshold = 6): DuplicateReport {
  const assets = lib.data.assets.filter((a) => !!a.phash)
  const skipped = lib.data.assets.length - assets.length
  const n = assets.length
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i

  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r]
    while (parent[x] !== r) {
      const nx = parent[x]
      parent[x] = r
      x = nx
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  const pairMax = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = hammingHex(assets[i].phash!, assets[j].phash!)
      if (d <= threshold) {
        union(i, j)
        const root = find(i)
        pairMax.set(root, Math.max(pairMax.get(root) ?? 0, d))
      }
    }
  }

  const buckets = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const arr = buckets.get(r) ?? []
    arr.push(i)
    buckets.set(r, arr)
  }

  const groups: DuplicateGroup[] = []
  let reclaimableBytes = 0
  for (const [root, idxs] of buckets) {
    if (idxs.length < 2) continue
    const list = idxs.map((i) => assets[i])
    // 组内最大的文件被保留，其余视为可清理
    const sorted = [...list].sort((a, b) => b.bytes - a.bytes)
    for (let k = 1; k < sorted.length; k++) reclaimableBytes += sorted[k].bytes
    groups.push({
      assetIds: idxs.map((i) => assets[i].id),
      maxDistance: pairMax.get(root) ?? 0,
      exact: new Set(list.map((a) => a.sha256)).size === 1
    })
  }

  groups.sort((a, b) => b.assetIds.length - a.assetIds.length)
  return { groups, scanned: n, skipped, reclaimableBytes }
}

/** 某个资源被哪些条目引用（删除/合并时提示用） */
export function entriesUsingAsset(lib: Library, assetId: string): PromptEntry[] {
  return lib.data.entries.filter((e) => e.assetIds.includes(assetId))
}

export function assetById(lib: Library, id: string): Asset | undefined {
  return lib.getAsset(id)
}
