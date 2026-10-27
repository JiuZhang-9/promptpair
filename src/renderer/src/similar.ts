/** 名称归一化与编辑距离：标签 / 模型治理共用 */
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 提取名称里的版本号签名（3.0 / v6 / 2.5 …）。
 * 用于“疑似重复”：即梦 3.0 和即梦 4.0 不是重复，不能只按编辑距离判断。
 */
export function versionKey(s: string): string {
  const nums = normalizeName(s).match(/\d+(?:\.\d+)*/g)
  return nums ? nums.join('.') : ''
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
