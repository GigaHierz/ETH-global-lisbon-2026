// Cheap text similarity: Jaccard over lowercase word shingles.
// Good enough to separate "same model, temp 0" (high overlap) from
// "different model" (different phrasing) without an embedding dependency.

export function similarity(a: string, b: string): number {
  const shingles = (s: string) => {
    const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) set.add(`${words[i]} ${words[i + 1]}`);
    if (set.size === 0 && words.length) set.add(words[0]);
    return set;
  };
  const A = shingles(a), B = shingles(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
