// ==SIM_START==
// ---- DRAM Cycle Sim — Pure Simulation Core (no DOM). Extractable via sed for Node.js Monte Carlo validation. ----

const TOTAL_TURNS = 40;
const NODE_LEAD_TIME_Q = 12;
const CAPEX_LEAD_TIME_Q = 6;
const HBM_TRADE_RATIO = 3.5;
const RAMP_VALLEY_PENALTY = 0.20;
const RAMP_VALLEY_QUARTERS = 2;
const MATURE_YIELD = 0.92;
const MIN_YIELD = 0.55;
const HBM_PREMIUM = 5.0;
const TIER3_DISCOUNT = 0.13;
const STRATEGIC_SCALE = 6000;
const BANKRUPTCY_PENALTY = 4000;

const ERAS = {
  MATURE:        { name:'성숙기',      aspYoY:-0.30, bitYoY:0.65 },
  SLOWDOWN:      { name:'성장둔화기',  aspYoY:-0.16, bitYoY:0.26 },
  AI_SUPERCYCLE: { name:'AI슈퍼사이클', aspYoY: 0.106, bitYoY:0.17 },
};

const PHASES = {
  EXTREME_TIGHT: { key:'EXTREME_TIGHT', name:'극단타이트', max:0.97,      k: 0.111 },
  TIGHT:         { key:'TIGHT',         name:'타이트',     max:1.00,      k: 0.051 },
  BALANCED:      { key:'BALANCED',      name:'균형',       max:1.03,      k:-0.027 },
  LOOSE:         { key:'LOOSE',         name:'루즈',       max:Infinity,  k:-0.161 },
};
const B_COEF = 2.7;

const NODES = [
  { name:'N-3 (레거시)',  grossBit:1.00, waferCostMult:1.00 },
  { name:'N-2',           grossBit:1.16, waferCostMult:1.08 },
  { name:'N-1',           grossBit:1.34, waferCostMult:1.17 },
  { name:'N (표준)',      grossBit:1.55, waferCostMult:1.27 },
  { name:'N+1 (선단)',    grossBit:1.80, waferCostMult:1.38 },
  { name:'N+2 (차세대)',  grossBit:2.08, waferCostMult:1.50 },
];

const FACTIONS = [
  { id:'SKH',  name:'SK하이닉스', capa:230, node:2, cash:7000,  hbmShare:0.16, kpi:'hbmShare',
    behavior:{ inertia:0.35, shareObsession:0.40, overconfidence:0.65, lossAversion:0.40, politicalConstraint:0.10 } },
  { id:'SEC',  name:'삼성전자',   capa:320, node:2, cash:11000, hbmShare:0.08, kpi:'bitShare',
    behavior:{ inertia:0.30, shareObsession:0.75, overconfidence:0.55, lossAversion:0.35, politicalConstraint:0.15 } },
  { id:'MU',   name:'마이크론',   capa:200, node:1, cash:5500,  hbmShare:0.05, kpi:'roic',
    behavior:{ inertia:0.55, shareObsession:0.30, overconfidence:0.35, lossAversion:0.25, politicalConstraint:0.10 } },
  { id:'CXMT', name:'CXMT',       capa:140, node:0, cash:2800,  hbmShare:0.00, kpi:'domestic',
    behavior:{ inertia:0.40, shareObsession:0.50, overconfidence:0.30, lossAversion:0.70, politicalConstraint:0.85 } },
];

// ---- utils ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function clampInt(x, a, b) { return Math.max(a, Math.min(b, Math.round(x))); }
function triangular(rng, min, mode, max) {
  const u = rng();
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}
function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

// ---- market engine ----
function classifyPhase(suff) {
  if (suff < 0.97) return 'EXTREME_TIGHT';
  if (suff < 1.00) return 'TIGHT';
  if (suff < 1.03) return 'BALANCED';
  return 'LOOSE';
}
function priceDelta(suff) {
  const k = PHASES[classifyPhase(suff)].k;
  return k + B_COEF * (-Math.log(suff));
}

// Era tilt on top of the calibrated regime-duration/magnitude stats: shifts which direction
// (UP/DOWN) a new regime is more likely to be, and scales each regime's total swing, so a
// 10-year campaign's cumulative drift roughly tracks the era's ASP YoY table (3.4) without
// hard-coding price itself off era.
const ERA_TILT = {
  MATURE:        { down: 1.05, up: 0.80, melt: 0.05, pUp: 0.34 },
  SLOWDOWN:      { down: 1.00, up: 1.00, melt: 0.12, pUp: 0.45 },
  AI_SUPERCYCLE: { down: 0.50, up: 1.45, melt: 0.24, pUp: 0.74 },
};

// Samples one regime's TOTAL cumulative log-return directly from the calibrated per-regime
// statistics (median -53.5% down / +23.2% up, rare up to +141% tail) rather than deriving price
// bottom-up from a freely-drifting sufficiency series: with regimes lasting up to 12 quarters,
// compounding the reaction function every single quarter at near-boundary Sufficiency produced
// astronomical (10^80+) price paths. Targeting the regime's total swing directly, then spreading
// it evenly across its quarters, keeps every regime's contribution bounded to what was measured.
function sampleRegime(rng, direction, era) {
  const tilt = ERA_TILT[era];
  if (direction === 'DOWN') {
    const dur = clampInt(triangular(rng, 2, 5, 12), 2, 12);
    const totalRet = -triangular(rng, 0.20, 0.535, 0.85) * tilt.down;
    return { direction, dur, logReturn: Math.log(1 + clamp(totalRet, -0.95, -0.05)) };
  }
  const dur = clampInt(triangular(rng, 2, 3, 8), 2, 8);
  const melt = rng() < tilt.melt;
  const totalRet = (melt ? triangular(rng, 0.45, 0.80, 1.41) : triangular(rng, 0.08, 0.232, 0.45)) * tilt.up;
  return { direction, dur, logReturn: Math.log(1 + totalRet), melt };
}
function startNewRegime(market, rng, era) {
  const direction = rng() < ERA_TILT[era].pUp ? 'UP' : 'DOWN';
  const r = sampleRegime(rng, direction, era);
  market.demandGrowthRegime = direction;
  market.regimeQuartersRemaining = r.dur;
  market.regimePerQuarterLogReturn = r.logReturn / r.dur;
}
function advanceRegime(market, rng, era) {
  market.regimeQuartersRemaining -= 1;
  if (market.regimeQuartersRemaining <= 0) startNewRegime(market, rng, era);
}

// Binary search inversion of the phase reaction function: given the dlnP actually applied to
// price this quarter (regime path + decision-linked supply pressure), back out the Sufficiency
// value that formula (3.2) says would produce it, purely to drive the phase badge/AI signal —
// keeps the displayed phase consistent with 3.1's formula instead of a second, disconnected number.
function impliedSufficiency(targetDlnP) {
  let lo = 0.5, hi = 1.8;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (priceDelta(mid) > targetDlnP) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- productivity engine ----
function effectiveYield(c) { return MIN_YIELD + (MATURE_YIELD - MIN_YIELD) * c.yieldMaturity; }

function advancePhysical(c) {
  const arrived = [];
  c.pendingCapacity = c.pendingCapacity.filter(p => {
    p.quartersRemaining -= 1;
    if (p.quartersRemaining <= 0) { arrived.push(p.amount); return false; }
    return true;
  });
  for (const amt of arrived) c.capacity += amt;

  if (c.nodeTransition) {
    c.nodeTransition.quartersRemaining -= 1;
    if (c.nodeTransition.quartersRemaining <= 0) {
      c.node = c.nodeTransition.targetNode;
      c.nodeTransition = null;
      c.yieldMaturity = 0.35;
      c.rampValleyQuartersRemaining = RAMP_VALLEY_QUARTERS;
    }
  }
  if (c.rampValleyQuartersRemaining > 0) c.rampValleyQuartersRemaining -= 1;

  const recoveryRate = 0.12 + c.yieldInvestLevel * 0.06;
  c.yieldMaturity = Math.min(1, c.yieldMaturity + recoveryRate);
}

function computeProductivity(c) {
  const waferStarts = c.capacity * c.utilization;
  const nodeDef = NODES[c.node];
  const hbmWafers = waferStarts * c.hbmShareTarget;
  const convWafers = waferStarts - hbmWafers;
  const yieldEff = effectiveYield(c);
  const rampMult = c.rampValleyQuartersRemaining > 0 ? (1 - RAMP_VALLEY_PENALTY) : 1;
  const convBits = convWafers * nodeDef.grossBit * yieldEff * rampMult;
  const hbmBits = hbmWafers * (nodeDef.grossBit / HBM_TRADE_RATIO) * yieldEff * rampMult;
  return { waferStarts, convWafers, hbmWafers, convBits, hbmBits, saleableBit: convBits + hbmBits, yieldEff, nodeDef, rampMult };
}

// ---- mix engine ----
function computeMix(c, prod, leadNodeBefore) {
  const gateOk = c.node >= leadNodeBefore - 1;
  c.hbmQualQuarters = gateOk ? (c.hbmQualQuarters || 0) + 1 : 0;
  const qualPassed = c.hbmQualQuarters >= 2;

  const downbinFrac = clamp(0.06 + (1 - c.yieldMaturity) * 0.30, 0.06, 0.40);
  const tier2ConvBits = prod.convBits * (1 - downbinFrac);
  const tier3ConvBits = prod.convBits * downbinFrac;

  let tier1Bits = 0, tier3HbmBits = 0;
  if (qualPassed) tier1Bits = prod.hbmBits; else tier3HbmBits = prod.hbmBits;

  return { tier1Bits, tier2Bits: tier2ConvBits, tier3Bits: tier3ConvBits + tier3HbmBits, qualPassed, downbinFrac };
}

// ---- financial engine ----
function computeFinancials(c, prod, mix, market) {
  const p = market.priceIndex / 100;
  const rev = mix.tier1Bits * p * HBM_PREMIUM + mix.tier2Bits * p * 1.0 + mix.tier3Bits * p * (1 - TIER3_DISCOUNT);

  const cashStanceCapexMult = c.cashStance > 0 ? 0.95 : (c.cashStance < 0 ? 1.05 : 1.0);
  const waferCost = 0.60 * prod.nodeDef.waferCostMult;
  const hbmPackagingCost = prod.hbmWafers * waferCost * 0.9;
  const cogs = prod.waferStarts * waferCost + hbmPackagingCost;

  const sgaFixed = c.capacity * 0.09;
  const idleCapPenalty = c.capacity * (1 - c.utilization) * 0.03;

  const maintenanceCapex = c.capacity * 0.13 * cashStanceCapexMult;
  const expansionCapex = c.pendingCapacity.reduce((s, x) => s + x.quarterlyCost, 0);
  const nodeCapex = c.nodeTransition ? c.nodeTransition.quarterlyCost : 0;
  const yieldInvestCost = c.yieldInvestLevel * c.capacity * 0.02;
  const capex = maintenanceCapex + expansionCapex + nodeCapex + yieldInvestCost;

  const opIncome = rev - cogs - sgaFixed - idleCapPenalty;
  const interestRate = 0.025 * (c.cashStance > 0 ? 0.7 : (c.cashStance < 0 ? 1.3 : 1.0));
  const interest = c.cash < 0 ? Math.abs(c.cash) * interestRate : 0;
  const netCashFlow = opIncome - capex - interest;

  c.investedCapital = (c.investedCapital || 0) + expansionCapex + nodeCapex + maintenanceCapex;
  const capitalCharge = c.investedCapital * 0.02;
  const economicProfit = opIncome - capitalCharge;

  return { rev, cogs, sgaFixed, idleCapPenalty, capex, opIncome, interest, netCashFlow, economicProfit, capitalCharge };
}

// ---- competitor AI ----
function aiDecide(c, s, rng) {
  c.aiState = c.aiState || { reevalCounter: 0 };
  const params = c.behavior;
  const reevalInterval = 1 + Math.round(params.inertia * 5);
  c.aiState.reevalCounter++;

  const cashCritical = c.cash < c.capacity * 1.5;
  const forceReeval = cashCritical || c.aiState.reevalCounter >= reevalInterval;
  if (!forceReeval) return;
  c.aiState.reevalCounter = 0;

  const leadNode = Math.max(...s.companies.map(x => x.node));
  const phase = s.market.phase;
  const margin = c.lastFin ? c.lastFin.opIncome / Math.max(1, c.lastFin.rev) : 0.1;

  if ((phase === 'LOOSE' || phase === 'BALANCED') && margin < 0) {
    const cutWillingness = (1 - params.lossAversion) * (1 - params.politicalConstraint * 0.7) * (1 - params.shareObsession * 0.5);
    c.utilization = clamp(c.utilization - 0.05 - 0.10 * cutWillingness, 0.55, 1.0);
  } else if (phase === 'EXTREME_TIGHT' || phase === 'TIGHT') {
    c.utilization = clamp(c.utilization + 0.05, 0.6, 1.0);
  }
  if (params.politicalConstraint > 0.6) c.utilization = Math.max(c.utilization, 0.75);

  if (phase === 'EXTREME_TIGHT' && params.overconfidence * rng() > 0.45 && c.cash > c.capacity * 3 && !cashCritical) {
    const amount = c.capacity * (0.08 + 0.12 * params.overconfidence);
    c.pendingCapacity.push({ amount, quartersRemaining: CAPEX_LEAD_TIME_Q, quarterlyCost: (amount * 2.2) / CAPEX_LEAD_TIME_Q });
  }

  if (!c.nodeTransition && c.node < NODES.length - 1 && !cashCritical) {
    const behind = leadNode - c.node;
    const urge = behind * 0.25 + params.overconfidence * 0.3 + (1 - params.inertia) * 0.2;
    if (urge * rng() * 2 > 0.5 && c.cash > c.capacity * 4) {
      const totalCost = c.capacity * 3.0;
      c.nodeTransition = { targetNode: c.node + 1, quartersRemaining: NODE_LEAD_TIME_Q, quarterlyCost: totalCost / NODE_LEAD_TIME_Q };
    }
  }

  const hbmGateOk = c.node >= leadNode - 1;
  if (hbmGateOk) {
    const desire = params.overconfidence * 0.5 + (c.kpi === 'hbmShare' ? 0.3 : 0);
    c.hbmShareTarget = clamp(c.hbmShareTarget + (desire > 0.4 ? 0.03 : -0.01), 0, 0.45);
  }

  c.cashStance = cashCritical ? 1 : (c.cash > c.capacity * 6 ? -1 : 0);
}

// ---- player decisions ----
function applyPlayerDecisions(player, decisions) {
  decisions = decisions || {};
  if (decisions.utilization != null) player.utilization = clamp(decisions.utilization, 0.55, 1.0);
  if (decisions.hbmShareTarget != null) player.hbmShareTarget = clamp(decisions.hbmShareTarget, 0, 0.45);
  if (decisions.yieldInvestLevel != null) player.yieldInvestLevel = decisions.yieldInvestLevel;
  if (decisions.cashStance != null) player.cashStance = decisions.cashStance;
  if (decisions.expandAmount) {
    const amount = decisions.expandAmount;
    const totalCost = amount * 2.2;
    player.pendingCapacity.push({ amount, quartersRemaining: CAPEX_LEAD_TIME_Q, quarterlyCost: totalCost / CAPEX_LEAD_TIME_Q });
  }
  if (decisions.startNodeTransition && !player.nodeTransition && player.node < NODES.length - 1) {
    const totalCost = player.capacity * 3.0;
    player.nodeTransition = { targetNode: player.node + 1, quartersRemaining: NODE_LEAD_TIME_Q, quarterlyCost: totalCost / NODE_LEAD_TIME_Q };
  }
}

// ---- per-company settlement ----
function settleCompanyQuarter(c, market, leadNodeBefore) {
  if (c.bankrupt) { c.utilization = Math.max(0.3, c.utilization * 0.9); return 0; }
  advancePhysical(c);
  const prod = computeProductivity(c);
  const mix = computeMix(c, prod, leadNodeBefore);
  const fin = computeFinancials(c, prod, mix, market);
  c.cash += fin.netCashFlow;
  c.cumEconomicProfit = (c.cumEconomicProfit || 0) + fin.economicProfit;
  c.cumHbmRevenue = (c.cumHbmRevenue || 0) + mix.tier1Bits * (market.priceIndex / 100) * HBM_PREMIUM;
  c.cumTotalRevenue = (c.cumTotalRevenue || 0) + fin.rev;
  c.cumBits = (c.cumBits || 0) + prod.saleableBit;
  c.cumDomesticRevenue = (c.cumDomesticRevenue || 0) + mix.tier3Bits * (market.priceIndex / 100) * (1 - TIER3_DISCOUNT);
  c.lastFin = fin; c.lastProd = prod; c.lastMix = mix;
  if (c.cash < 0) c.negativeCashStreak = (c.negativeCashStreak || 0) + 1; else c.negativeCashStreak = 0;
  if (c.negativeCashStreak >= 4) c.bankrupt = true;
  return prod.saleableBit;
}

// ---- era structural break ----
function maybeEraTransition(s) {
  if (s.eraBreakDone || s.turn !== s.eraBreakTurn) return;
  s.eraBreakDone = true;
  s.era = s.era === 'AI_SUPERCYCLE' ? 'SLOWDOWN' : 'AI_SUPERCYCLE';
  s.events = s.events || [];
  s.events.push({ turn: s.turn, text: s.era === 'AI_SUPERCYCLE' ? 'AI 붐 시작 — 수요 구조 단절' : 'AI 버블 조정 — 성장 둔화 국면 진입' });
}

// ---- game init ----
function createInitialState(playerFactionId, eraKey, rng) {
  const companies = FACTIONS.map(f => ({
    id: f.id, name: f.name, isPlayer: f.id === playerFactionId, kpi: f.kpi,
    capacity: f.capa, pendingCapacity: [], node: f.node, nodeTransition: null,
    rampValleyQuartersRemaining: 0, yieldMaturity: 1.0, yieldInvestLevel: 1,
    utilization: 0.85, hbmShareTarget: f.hbmShare, hbmQualQuarters: f.hbmShare > 0 ? 4 : 0,
    cash: f.cash, investedCapital: f.capa * 3, cashStance: 0,
    cumEconomicProfit: 0, cumHbmRevenue: 0, cumTotalRevenue: 0, cumBits: 0, cumDomesticRevenue: 0,
    negativeCashStreak: 0, bankrupt: false, history: [],
    behavior: f.behavior, aiState: { reevalCounter: 0 },
  }));
  const initialGap = Math.max(...companies.map(c => c.node)) - companies.find(c => c.id === playerFactionId).node;

  let s0supply = 0;
  for (const c of companies) s0supply += computeProductivity(c).saleableBit;

  const market = {
    lastSupply: s0supply, sufficiency: 1.0, displaySufficiency: 1.0, phase: 'BALANCED', priceIndex: 100,
    demandGrowthRegime: 'UP', regimeQuartersRemaining: 0, regimePerQuarterLogReturn: 0,
    history: [],
  };
  startNewRegime(market, rng, eraKey);

  const eraBreakTurn = 14 + Math.floor(rng() * 15);
  return {
    turn: 0, year: 0, quarter: 0, era: eraKey, eraBreakTurn, eraBreakDone: false,
    playerFactionId, initialGap, companies, market, events: [], gameOver: false,
  };
}

// ---- turn resolution ----
function runQuarter(state, playerDecisions, rng) {
  const s = cloneState(state);
  s.turn += 1;
  s.quarter = ((s.turn - 1) % 4) + 1;
  s.year = Math.floor((s.turn - 1) / 4) + 1;

  maybeEraTransition(s);

  const leadNodeBefore = Math.max(...s.companies.map(c => c.node));

  for (const c of s.companies) {
    if (c.bankrupt) continue;
    if (c.isPlayer) applyPlayerDecisions(c, playerDecisions);
    else aiDecide(c, s, rng);
  }

  let totalSupply = 0;
  for (const c of s.companies) totalSupply += settleCompanyQuarter(c, s.market, leadNodeBefore);

  advanceRegime(s.market, rng, s.era);

  const trendQGrowth = Math.pow(1 + ERAS[s.era].bitYoY, 0.25) - 1;
  const prevSupply = s.market.lastSupply || totalSupply;
  const actualSupplyQGrowth = prevSupply > 0 ? (totalSupply - prevSupply) / prevSupply : 0;
  const capacityPressure = clamp(actualSupplyQGrowth - trendQGrowth, -0.15, 0.15) * 0.25;
  s.market.lastSupply = totalSupply;

  const noise = (rng() - 0.5) * 0.015;
  const dlnP = clamp(s.market.regimePerQuarterLogReturn + noise + capacityPressure, -0.28, 0.28);
  s.market.priceIndex *= Math.exp(dlnP);
  s.market.lastDlnP = dlnP;

  const trueSufficiency = impliedSufficiency(dlnP);
  s.market.sufficiency = trueSufficiency;
  s.market.displaySufficiency = trueSufficiency * (1 + (rng() - 0.5) * 0.06);
  s.market.phase = classifyPhase(trueSufficiency);
  s.market.history.push({ turn: s.turn, price: s.market.priceIndex, sufficiency: trueSufficiency, phase: s.market.phase });

  for (const c of s.companies) {
    c.history.push({ turn: s.turn, cash: c.cash, node: c.node, util: c.utilization, ep: c.cumEconomicProfit });
  }

  const player = s.companies.find(c => c.isPlayer);
  s.gameOver = s.turn >= TOTAL_TURNS || player.bankrupt;
  return s;
}

// ---- scoring ----
function strategicIndex(c, allCompanies, initialGap) {
  switch (c.kpi) {
    case 'hbmShare':
      return c.cumHbmRevenue / Math.max(1, c.cumTotalRevenue);
    case 'bitShare': {
      const totalBits = allCompanies.reduce((s, x) => s + x.cumBits, 0);
      return c.cumBits / Math.max(1, totalBits);
    }
    case 'roic':
      return clamp(c.cumEconomicProfit / Math.max(1, c.investedCapital), -1, 2);
    case 'domestic': {
      const domesticShare = c.cumDomesticRevenue / Math.max(1, c.cumTotalRevenue);
      const leadNode = Math.max(...allCompanies.map(x => x.node));
      const gapNow = leadNode - c.node;
      const gapClose = initialGap > 0 ? clamp((initialGap - gapNow) / initialGap, 0, 1) : 0;
      return domesticShare * 0.6 + gapClose * 0.4;
    }
    default: return 0;
  }
}
function finalScore(c, allCompanies, initialGap) {
  const idx = strategicIndex(c, allCompanies, initialGap);
  const penalty = c.bankrupt ? BANKRUPTCY_PENALTY : 0;
  return c.cumEconomicProfit + 1.3 * idx * STRATEGIC_SCALE - penalty;
}

const DramSimCore = {
  TOTAL_TURNS, NODE_LEAD_TIME_Q, CAPEX_LEAD_TIME_Q, HBM_TRADE_RATIO, RAMP_VALLEY_QUARTERS,
  ERAS, PHASES, NODES, FACTIONS, STRATEGIC_SCALE,
  mulberry32, classifyPhase, priceDelta,
  createInitialState, runQuarter, strategicIndex, finalScore, cloneState,
};
if (typeof module !== 'undefined' && module.exports) module.exports = DramSimCore;
if (typeof window !== 'undefined') window.DramSimCore = DramSimCore;
// ==SIM_END==
