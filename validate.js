#!/usr/bin/env node
// Extracts the pure sim core from index.html (between ==SIM_START==/==SIM_END== markers)
// and runs Monte Carlo checks: (1) no dominant fixed strategy, (2) no faction dominates Score.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const startMarker = '// ==SIM_START==';
const endMarker = '// ==SIM_END==';
const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) throw new Error('SIM markers not found in index.html');
const coreSrc = html.slice(startIdx, endIdx + endMarker.length);

const tmpFile = path.join(os.tmpdir(), 'dram-sim-core.generated.js');
fs.writeFileSync(tmpFile, coreSrc);
const Sim = require(tmpFile);

// A strategy that never reacts to margin at all isn't a playstyle, it's a script bug: any
// sane player (or the AI competitors, via their own inertia-gated logic) cuts utilization when
// losing money in a soft market. This baseline reaction is shared across strategies so the thing
// actually being differentiated/tested is capex pacing, HBM commitment, and node timing.
function adaptiveUtil(p, base, floor) {
  const margin = p.lastFin ? p.lastFin.opIncome / Math.max(1, p.lastFin.rev) : 0.1;
  if (margin < -0.05) return Math.max(floor, base - 0.15);
  if (margin < 0.05) return Math.max(floor, base - 0.05);
  return base;
}

// ---- fixed strategies (player decision functions) ----
const STRATEGIES = {
  '균형형': (state, p) => ({
    utilization: adaptiveUtil(p, 0.85, 0.65),
    hbmShareTarget: 0.15,
    yieldInvestLevel: 1,
    cashStance: 0,
    expandAmount: (state.turn % 8 === 0 && p.cash > p.capacity * 4) ? p.capacity * 0.1 : 0,
    startNodeTransition: !p.nodeTransition && p.node < Sim.NODES.length - 1 && state.turn % 12 === 4,
  }),
  'HBM올인': (state, p) => ({
    utilization: adaptiveUtil(p, 0.9, 0.7),
    hbmShareTarget: 0.40,
    yieldInvestLevel: 2,
    cashStance: -1,
    expandAmount: 0,
    startNodeTransition: !p.nodeTransition && p.node < Sim.NODES.length - 1,
  }),
  '물량방어': (state, p) => ({
    utilization: adaptiveUtil(p, 1.0, 0.85),
    hbmShareTarget: 0.05,
    yieldInvestLevel: 1,
    cashStance: 0,
    expandAmount: (state.turn % 6 === 0) ? p.capacity * 0.08 : 0,
    startNodeTransition: !p.nodeTransition && p.node < Sim.NODES.length - 1 && state.turn % 16 === 8,
  }),
  '보수적생존': (state, p) => ({
    utilization: adaptiveUtil(p, 0.75, 0.55),
    hbmShareTarget: 0.05,
    yieldInvestLevel: 0,
    cashStance: 1,
    expandAmount: 0,
    startNodeTransition: !p.nodeTransition && p.node < Sim.NODES.length - 1 && state.turn % 20 === 10,
  }),
  '공격증설': (state, p) => ({
    utilization: adaptiveUtil(p, 0.95, 0.75),
    hbmShareTarget: 0.2,
    yieldInvestLevel: 2,
    cashStance: -1,
    expandAmount: (state.turn % 4 === 0 && p.cash > p.capacity * 2) ? p.capacity * 0.15 : 0,
    startNodeTransition: !p.nodeTransition && p.node < Sim.NODES.length - 1,
  }),
};

function playGame(factionId, eraKey, seed, strategyFn) {
  const rng = Sim.mulberry32(seed);
  let state = Sim.createInitialState(factionId, eraKey, rng);
  let nodeTransitionDecidedAtTurn = null;
  while (!state.gameOver) {
    const p = state.companies.find(c => c.isPlayer);
    const decisions = strategyFn(state, p);
    if (decisions.startNodeTransition && !p.nodeTransition && nodeTransitionDecidedAtTurn === null) {
      nodeTransitionDecidedAtTurn = state.turn + 1;
    }
    state = Sim.runQuarter(state, decisions, rng);
  }
  const all = state.companies;
  const results = {};
  for (const c of all) results[c.id] = Sim.finalScore(c, all, state.initialGap);
  return { state, results, nodeTransitionDecidedAtTurn };
}

const SEEDS = Array.from({ length: 15 }, (_, i) => 1000 + i * 37);
const FACTION_IDS = Sim.FACTIONS.map(f => f.id);
const ERA = 'SLOWDOWN';

console.log('='.repeat(70));
console.log('DRAM SIM v0.2 — Monte Carlo Validation');
console.log('seeds:', SEEDS.length, '| strategies:', Object.keys(STRATEGIES).length, '| factions:', FACTION_IDS.length);
console.log('='.repeat(70));

// ---- Check 1: dominant strategy absence ----
console.log('\n[1] 지배 전략(dominant strategy) 부재 검증 — player=SKH, era=SLOWDOWN\n');
const stratScores = {};
const nodeTransitionTurns = [];
for (const [name, fn] of Object.entries(STRATEGIES)) {
  stratScores[name] = [];
  for (const seed of SEEDS) {
    const { results, nodeTransitionDecidedAtTurn } = playGame('SKH', ERA, seed, fn);
    stratScores[name].push(results.SKH);
    if (nodeTransitionDecidedAtTurn) nodeTransitionTurns.push(nodeTransitionDecidedAtTurn);
  }
}
function stats(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0], max = sorted[sorted.length - 1];
  const sd = Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length);
  return { mean, median, min, max, sd };
}
const stratStats = {};
for (const [name, arr] of Object.entries(stratScores)) {
  stratStats[name] = stats(arr);
  const s = stratStats[name];
  console.log(`  ${name.padEnd(8)}  mean=${s.mean.toFixed(0).padStart(7)}  median=${s.median.toFixed(0).padStart(7)}  min=${s.min.toFixed(0).padStart(7)}  max=${s.max.toFixed(0).padStart(7)}  sd=${s.sd.toFixed(0)}`);
}
const means = Object.values(stratStats).map(s => s.mean);
const bestMean = Math.max(...means), worstMean = Math.min(...means);
const spread = worstMean !== 0 ? (bestMean - worstMean) / Math.abs(worstMean) : Infinity;
console.log(`\n  best-mean=${bestMean.toFixed(0)}  worst-mean=${worstMean.toFixed(0)}  spread=${(spread * 100).toFixed(0)}%`);
console.log(`  ${spread < 0.6 ? 'PASS' : 'WARN'}: 전략간 평균 Score 격차 ${spread < 0.6 ? '허용 범위 내' : '큼 — 밸런스 재검토 권장'} (임계 60%)`);

// ---- Check 2: faction balance ----
console.log('\n[2] 진영 균형(faction balance) 검증 — strategy=균형형, era=SLOWDOWN\n');
const factionScores = {};
for (const fid of FACTION_IDS) {
  factionScores[fid] = [];
  for (const seed of SEEDS) {
    const { results } = playGame(fid, ERA, seed, STRATEGIES['균형형']);
    factionScores[fid].push(results[fid]);
  }
}
const factionStats = {};
for (const [fid, arr] of Object.entries(factionScores)) {
  factionStats[fid] = stats(arr);
  const s = factionStats[fid];
  console.log(`  ${fid.padEnd(6)}  mean=${s.mean.toFixed(0).padStart(7)}  median=${s.median.toFixed(0).padStart(7)}  min=${s.min.toFixed(0).padStart(7)}  max=${s.max.toFixed(0).padStart(7)}  sd=${s.sd.toFixed(0)}`);
}
// win-rate check: for each seed, which faction (played with the same 균형형 strategy) scores highest?
let winCounts = {}; FACTION_IDS.forEach(f => winCounts[f] = 0);
for (const seed of SEEDS) {
  let best = null, bestScore = -Infinity;
  for (const fid of FACTION_IDS) {
    const { results } = playGame(fid, ERA, seed, STRATEGIES['균형형']);
    if (results[fid] > bestScore) { bestScore = results[fid]; best = fid; }
  }
  winCounts[best]++;
}
console.log('\n  진영별 "자기 진영으로 플레이 시 최고 스코어" 우세 횟수(참고용, 시드 수=' + SEEDS.length + '):');
for (const fid of FACTION_IDS) console.log(`  ${fid.padEnd(6)} ${winCounts[fid]} / ${SEEDS.length}`);
const maxWinShare = Math.max(...Object.values(winCounts)) / SEEDS.length;
console.log(`\n  ${maxWinShare < 0.7 ? 'PASS' : 'WARN'}: 특정 진영 독점 우세 ${maxWinShare < 0.7 ? '없음' : '있음 — 밸런스 재검토 권장'} (임계 70%)`);

// ---- Check 3: bankruptcy sanity ----
console.log('\n[3] 파산 발생률 (균형형 전략, 전체 진영×시드)\n');
let bankruptCount = 0, total = 0;
for (const fid of FACTION_IDS) {
  for (const seed of SEEDS) {
    const { state } = playGame(fid, ERA, seed, STRATEGIES['균형형']);
    total++;
    if (state.companies.find(c => c.isPlayer).bankrupt) bankruptCount++;
  }
}
console.log(`  파산: ${bankruptCount} / ${total} (${((bankruptCount / total) * 100).toFixed(0)}%) — 균형형 전략 기준, 과도하면(>25%) 난이도 재검토 필요`);

// ---- Check 4: node-transition timing tension ----
console.log('\n[4] 노드 전환 타이밍 고민 시점 (전략들의 첫 전환 결정 턴, 목표 T12~T20 부근)\n');
if (nodeTransitionTurns.length) {
  const s = stats(nodeTransitionTurns);
  console.log(`  n=${nodeTransitionTurns.length}  mean=T${s.mean.toFixed(1)}  median=T${s.median}  min=T${s.min}  max=T${s.max}`);
} else {
  console.log('  (스크립트형 전략은 고정 턴에 전환하므로 별도 자가점검 필요 — 아래 요약 참고)');
}

console.log('\n' + '='.repeat(70));
console.log('검증 완료.');
console.log('='.repeat(70));
