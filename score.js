// 개인 산출 비중 = Σ (유형 가중치 × 유형 내 활동 비중)
// 팀 전체에 기록이 없는 유형의 가중치는 기록이 있는 유형에 비례 배분 → 팀 합계 100%
// ponytail: 유형 내 비중 = 해당 유형 기록 건수 비율. 변경량·품질 가중은 시범 운영 검증 후 추가.
export function computeScores(members, records, weights) {
  const counts = new Map(members.map(m => [m.id, weights.map(() => 0)]));
  const totals = weights.map(() => 0);
  for (const r of records) {
    const c = counts.get(r.member_id);
    if (!c || r.type == null || r.type >= weights.length) continue;
    c[r.type]++;
    totals[r.type]++;
  }
  const active = weights.reduce((a, w, i) => a + (totals[i] ? w : 0), 0);
  const applied = weights.map((w, i) => (totals[i] && active ? (w / active) * 100 : 0));
  return members.map(m => {
    const c = counts.get(m.id);
    const shares = c.map((n, i) => (totals[i] ? (n / totals[i]) * 100 : 0));
    const parts = shares.map((s, i) => (s * applied[i]) / 100);
    const score = Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10;
    return { member_id: m.id, counts: c, shares, applied, parts, score };
  });
}
