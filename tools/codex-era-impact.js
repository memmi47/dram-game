#!/usr/bin/env node
// P0-E 부호 수정 전후의 시대별 ASP 드리프트를 같은 시드로 비교한다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/core.js'), 'utf8');
const anchor = 'const dlnP = clamp(s.market.regimePerQuarterLogReturn + noise + capacityPressure, -0.28, 0.28);';
if (!source.includes(anchor)) throw new Error('P0-E 앵커가 없다. core 변경 뒤 스크립트를 갱신해야 한다.');

function loadCore(text, tag) {
  const filename = path.join(os.tmpdir(), `dram-era-${tag}-${process.pid}.js`);
  fs.writeFileSync(filename, text);
  return require(filename);
}

const versions = {
  current: loadCore(source, 'current'),
  signFixed: loadCore(source.replace(anchor, anchor.replace('+ capacityPressure', '- capacityPressure')), 'fixed'),
};
const eras = ['MATURE', 'SLOWDOWN', 'AI_SUPERCYCLE'];
const modes = ['game-default', 'static-supply', 'trend-matched'];

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}

function run(Sim, era, seed, mode) {
  const rng = Sim.mulberry32(seed);
  let state = Sim.createInitialState('SKH', era, rng);
  state.eraBreakDone = true;
  state.companies.find(company => company.isPlayer).cash = 1e9;

  if (mode !== 'game-default') {
    state.companies.forEach(company => {
      company.isPlayer = true;
      company.cash = 1e9;
    });
  }

  const trendQGrowth = Math.pow(1 + Sim.ERAS[era].bitYoY, 0.25) - 1;
  while (!state.gameOver) {
    if (mode === 'trend-matched') {
      state.companies.forEach(company => { company.capacity *= 1 + trendQGrowth; });
    }
    state = Sim.runQuarter(state, {}, rng);
  }
  return Math.pow(state.market.priceIndex / 100, 4 / state.turn) - 1;
}

for (const mode of modes) {
  console.log(`\n[${mode}] annualized ASP return over 40Q; structural break disabled`);
  for (const era of eras) {
    const rows = {};
    for (const [name, Sim] of Object.entries(versions)) {
      const values = [];
      for (let i = 0; i < 500; i++) values.push(run(Sim, era, 10000 + i * 97, mode));
      rows[name] = {
        p25: percentile(values, 0.25),
        median: percentile(values, 0.5),
        p75: percentile(values, 0.75),
      };
    }
    const format = row => `median=${(row.median * 100).toFixed(1)}% p25=${(row.p25 * 100).toFixed(1)}% p75=${(row.p75 * 100).toFixed(1)}%`;
    console.log(`  ${era.padEnd(14)} current ${format(rows.current)}`);
    console.log(`  ${''.padEnd(14)} fixed   ${format(rows.signFixed)}`);
  }
}
