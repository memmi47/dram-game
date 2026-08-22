#!/usr/bin/env node
// P0 결함 재현 스크립트 — docs/plan-claude-response.md의 모든 수치를 재생성한다.
//
// 사용법: node tools/audit-repro.js
//
// Codex의 design-audit-v0.2-v0.4.md §6이 "각 결함 의심 항목을 재현하거나 반박하고 코드 근거를
// 남긴다"를 요청했으므로, 주장이 아니라 실행 결과로 답하기 위해 만들었다. src/core.js를 그대로
// 로드하므로 코어를 수정하면 이 스크립트의 판정도 함께 바뀐다 — P0 수정 후 회귀 확인에도 쓸 수 있다.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(ROOT, 'src/core.js'), 'utf8');

function loadCore(src, tag) {
  const f = path.join(os.tmpdir(), `dram-core-${tag}-${process.pid}.js`);
  fs.writeFileSync(f, src);
  return require(f);
}
const Sim = loadCore(coreSrc, 'orig');

const results = [];
function verdict(id, title, confirmed, detail) {
  results.push({ id, confirmed });
  console.log(`\n  → 판정: ${confirmed ? 'CONFIRMED — 결함 존재' : 'REFUTED — 설계대로 동작'}${detail ? ` (${detail})` : ''}`);
}
function header(id, title) {
  console.log('\n' + '='.repeat(78));
  console.log(`${id}: ${title}`);
  console.log('='.repeat(78));
}

// ---------------------------------------------------------------- P0-A
header('P0-A', 'Ramp Valley — 설계 2분기 -20%가 실제로 몇 분기 적용되는가');
{
  const rng = Sim.mulberry32(42);
  let s = Sim.createInitialState('SKH', 'SLOWDOWN', rng);
  let penalized = 0;
  for (let t = 1; t <= 16 && !s.gameOver; t++) {
    s = Sim.runQuarter(s, { startNodeTransition: t === 1 }, rng);
    const p = s.companies.find(c => c.isPlayer);
    if (p.lastProd.rampMult < 1) {
      penalized++;
      console.log(`  T${String(s.turn).padStart(2)} node=${p.node} valleyCounter=${p.rampValleyQuartersRemaining} rampMult=${p.lastProd.rampMult.toFixed(2)}  <== 페널티`);
    }
  }
  console.log(`\n  페널티 적용 분기 수: ${penalized}  /  설계 요구: ${Sim.RAMP_VALLEY_QUARTERS}`);
  verdict('P0-A', 'Ramp Valley', penalized !== Sim.RAMP_VALLEY_QUARTERS, `${penalized}분기만 적용`);
}

// ---------------------------------------------------------------- P0-B
header('P0-B', '분기당 최대 3개 결정 제한을 코어가 강제하는가');
{
  const rng = Sim.mulberry32(7);
  let s = Sim.createInitialState('SKH', 'SLOWDOWN', rng);
  const b = s.companies.find(c => c.isPlayer);
  const before = { u: b.utilization, h: b.hbmShareTarget, y: b.yieldInvestLevel, c: b.cashStance, p: b.pendingCapacity.length, t: !!b.nodeTransition };
  s = Sim.runQuarter(s, {
    utilization: 1.0, hbmShareTarget: 0.45, yieldInvestLevel: 2,
    cashStance: -1, expandAmount: 50, startNodeTransition: true,
  }, rng);
  const a = s.companies.find(c => c.isPlayer);
  const applied = [];
  if (a.utilization !== before.u) applied.push('utilization');
  if (a.hbmShareTarget !== before.h) applied.push('hbmShareTarget');
  if (a.yieldInvestLevel !== before.y) applied.push('yieldInvestLevel');
  if (a.cashStance !== before.c) applied.push('cashStance');
  if (a.pendingCapacity.length !== before.p) applied.push('expandAmount');
  if (!!a.nodeTransition !== before.t) applied.push('startNodeTransition');
  console.log(`  6개 레버를 한 분기에 동시 제출 → 실제 반영: ${applied.length}개`);
  console.log(`  ${applied.join(', ')}`);
  verdict('P0-B', '결정 예산', applied.length > 3, `${applied.length}개 반영, UI만 3개로 제한`);
}

// ---------------------------------------------------------------- P0-C
header('P0-C', 'HBM 배분 0%에도 퀄(qual) 시간이 누적되는가');
{
  const rng = Sim.mulberry32(99);
  let s = Sim.createInitialState('MU', 'SLOWDOWN', rng);
  for (let t = 1; t <= 6; t++) s = Sim.runQuarter(s, { hbmShareTarget: 0 }, rng);
  const p = s.companies.find(c => c.isPlayer);
  console.log(`  HBM 배분 0%를 6분기 유지 후: hbmQualQuarters=${p.hbmQualQuarters}, qualPassed=${p.lastMix.qualPassed}, hbmBits=${p.lastProd.hbmBits.toFixed(1)}`);
  verdict('P0-C', 'HBM 퀄 게이트', p.hbmQualQuarters > 0, '준비 활동 없이 퀄 누적');
}

// ---------------------------------------------------------------- P0-D
header('P0-D', 'CXMT 노드격차 KPI가 플레이어의 initialGap을 잘못 공유하는가');
{
  const rng = Sim.mulberry32(5);
  const s = Sim.createInitialState('SKH', 'SLOWDOWN', rng);
  const cxmt = s.companies.find(c => c.id === 'CXMT');
  const leader = Math.max(...s.companies.map(c => c.node));
  const cxmtOwnGap = leader - cxmt.node;
  console.log(`  플레이어=SKH 기준 state.initialGap = ${s.initialGap}`);
  console.log(`  CXMT의 실제 initial gap      = ${cxmtOwnGap}`);
  console.log(`  → strategicIndex(CXMT)는 ${s.initialGap}을 받아 gapClose 항이 ${s.initialGap > 0 ? '왜곡' : '항상 0으로 강제'}됨`);
  verdict('P0-D', 'CXMT KPI', s.initialGap !== cxmtOwnGap, '진영별 자기 격차 미사용');
}

// ---------------------------------------------------------------- P0-E
header('P0-E', '[Claude 신규] capacityPressure 부호 반전 — 공급 급증이 가격을 올리는가');
{
  const ANCHOR = 'const dlnP = clamp(s.market.regimePerQuarterLogReturn + noise + capacityPressure, -0.28, 0.28);';
  const FIXED = ANCHOR.replace('+ capacityPressure', '- capacityPressure');
  if (!coreSrc.includes(ANCHOR)) {
    console.log('  (앵커 라인 없음 — 이미 수정되었거나 코드가 변경됨. P0-E 검사 건너뜀)');
    console.log('\n  → 판정: SKIPPED');
  } else {
    const Fix = loadCore(coreSrc.replace(ANCHOR, FIXED), 'fixed');
    const run = (S, seed, mode) => {
      const rng = S.mulberry32(seed);
      let st = S.createInitialState('SEC', 'SLOWDOWN', rng);
      while (!st.gameOver) {
        const p = st.companies.find(c => c.isPlayer);
        st = S.runQuarter(st, mode === 'FLOOD'
          ? { utilization: 1.0, expandAmount: p.cash > p.capacity * 2 ? p.capacity * 0.25 : 0 }
          : { utilization: 0.55, expandAmount: 0 }, rng);
      }
      return st.market.priceIndex;
    };
    console.log('  동일 시드에서 "공급폭탄 최종가 ÷ 공급억제 최종가"  (>1 이면 공급 늘릴수록 가격 상승 = 비정상)\n');
    console.log('    seed |  현재구현 |  부호수정');
    console.log('   ' + '-'.repeat(36));
    let badOrig = 0, badFix = 0, n = 0;
    for (let i = 0; i < 14; i++) {
      const seed = 3000 + i * 191;
      const ro = run(Sim, seed, 'FLOOD') / run(Sim, seed, 'SQUEEZE');
      const rf = run(Fix, seed, 'FLOOD') / run(Fix, seed, 'SQUEEZE');
      if (ro > 1) badOrig++;
      if (rf > 1) badFix++;
      n++;
      console.log(`   ${String(seed).padStart(5)} | ${ro.toFixed(3).padStart(9)}${ro > 1 ? '!' : ' '} | ${rf.toFixed(3).padStart(9)}${rf > 1 ? '!' : ' '}`);
    }
    console.log(`\n  공급 늘렸는데 가격이 오른 시드: 현재구현 ${badOrig}/${n},  부호수정 ${badFix}/${n}`);
    console.log('  근거: 반응함수 ΔlnP = k + 2.7×(-ln Sufficiency), Sufficiency=Supply/Demand');
    console.log('        → 공급↑ ⇒ Sufficiency↑ ⇒ 가격↓ 이어야 하나, 코드는 capacityPressure를 더한다.');
    verdict('P0-E', '부호 반전', badOrig > badFix, `${badOrig}/${n} → ${badFix}/${n}`);
  }
}

// ---------------------------------------------------------------- 요약
console.log('\n' + '='.repeat(78));
console.log('요약');
console.log('='.repeat(78));
for (const r of results) console.log(`  ${r.id}: ${r.confirmed ? 'CONFIRMED' : 'REFUTED'}`);
const nConfirmed = results.filter(r => r.confirmed).length;
console.log(`\n  확인된 결함 ${nConfirmed} / 검사 ${results.length}`);
console.log('  상세 분석: docs/plan-claude-response.md');
