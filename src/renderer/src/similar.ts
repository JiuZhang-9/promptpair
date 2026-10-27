/** 名称归一化与编辑距离：标签 / 模型治理共用 */
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 编辑距离（按字符而不是 UTF-16 码元，中文/emoji 都按一个字算） */
export function levenshtein(a: string, b: string): number {
  const A = Array.from(a)
  const B = Array.from(b)
  if (!A.length) return B.length
  if (!B.length) return A.length
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i)
  for (let i = 1; i <= A.length; i++) {
    const cur = [i]
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[B.length]
}
