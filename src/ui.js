// ---- UI layer (drives the pure core above; not part of the extracted sim core) ----
(function () {
  const Sim = window.DramSimCore;
  const NODE_COLORS = ['#6b7a7a', '#2ec4b6', '#3fb6ff', '#ffd23f', '#ff9f1c', '#ff6b6b'];
  const HBM_COLOR = '#c77dff';
  const PHASE_COLOR = { EXTREME_TIGHT:'#ffd23f', TIGHT:'#3ddc97', BALANCED:'#1f6f70', LOOSE:'#ff5d5d' };

  let rng = null, seed = null, state = null, staged = {}, committed = {};
  const app = document.getElementById('app');

  function fmt(n, d) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d }); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%'; }

  function startScreen() {
    app.innerHTML = `
      <div class="startscreen panel">
        <h1>DRAM 사이클 경영 시뮬레이터 v0.2</h1>
        <p class="small">40턴(분기, 10년). 진영을 골라 노드 전환·증설·수율·HBM 배분을 결정하라. 결정과 결과 사이엔 최대 3년의 시차가 있다.</p>
        <h3>진영 선택</h3>
        <div class="faction-pick" id="factionPick"></div>
        <h3>시작 시대</h3>
        <select id="eraPick">
          <option value="SLOWDOWN">성장 둔화기 (ASP -16%/yr, bit출하 +26%/yr)</option>
          <option value="MATURE">성숙기 (ASP -25~35%/yr, bit출하 +55~75%/yr)</option>
          <option value="AI_SUPERCYCLE">AI 슈퍼사이클 (ASP +10.6%/yr, bit출하 +17%/yr)</option>
        </select>
        <div class="gap"></div>
        <button class="primary" id="startBtn">게임 시작</button>
      </div>`;
    const pick = document.getElementById('factionPick');
    let selected = 'SKH';
    Sim.FACTIONS.forEach(f => {
      const card = document.createElement('div');
      card.className = 'faction-card' + (f.id === selected ? ' sel' : '');
      card.innerHTML = `<b>${f.name}</b><div class="small">Capa ${f.capa}K · Node ${Sim.NODES[f.node].name} · Cash $${f.cash}M · HBM ${pct(f.hbmShare)}</div>`;
      card.onclick = () => { selected = f.id; [...pick.children].forEach(c => c.classList.remove('sel')); card.classList.add('sel'); };
      pick.appendChild(card);
    });
    document.getElementById('startBtn').onclick = () => {
      const era = document.getElementById('eraPick').value;
      seed = Math.floor(Math.random() * 1e9);
      rng = Sim.mulberry32(seed);
      state = Sim.createInitialState(selected, era, rng);
      resetStaged();
      render();
    };
  }

  function resetStaged() {
    const p = player();
    staged = { utilization: p.utilization, hbmShareTarget: p.hbmShareTarget, yieldInvestLevel: p.yieldInvestLevel, cashStance: p.cashStance, expandAmount: 0, startNodeTransition: false };
    committed = { utilization: p.utilization, hbmShareTarget: p.hbmShareTarget, yieldInvestLevel: p.yieldInvestLevel, cashStance: p.cashStance };
  }
  function player() { return state.companies.find(c => c.isPlayer); }

  function actionCount() {
    let n = 0;
    if (Math.abs(staged.utilization - committed.utilization) >= 0.01) n++;
    if (Math.abs(staged.hbmShareTarget - committed.hbmShareTarget) >= 0.01) n++;
    if (staged.yieldInvestLevel !== committed.yieldInvestLevel) n++;
    if (staged.cashStance !== committed.cashStance) n++;
    if (staged.expandAmount > 0) n++;
    if (staged.startNodeTransition) n++;
    return n;
  }

  function drawFab(canvas, c, t) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = 220 * 2;
    ctx.save(); ctx.scale(2, 2);
    const W = w / 2, H = h / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#081010'; ctx.fillRect(0, 0, W, H);

    const nodeColor = NODE_COLORS[c.node];
    const inValley = c.rampValleyQuartersRemaining > 0;
    const flicker = inValley ? (0.55 + 0.35 * Math.sin(t / 140)) : 1.0;

    // building silhouette (fixed, faction/node-agnostic)
    ctx.strokeStyle = '#3a5a56'; ctx.lineWidth = 2;
    ctx.strokeRect(20, 40, W - 40, H - 70);
    ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(W / 2, 18); ctx.lineTo(W - 20, 40); ctx.stroke();

    // production lines (palette swap by node gen)
    const lines = 3;
    for (let i = 0; i < lines; i++) {
      const ly = 60 + i * ((H - 100) / lines);
      const lh = (H - 100) / lines - 10;
      ctx.globalAlpha = flicker * (0.55 + 0.45 * c.utilization);
      ctx.fillStyle = nodeColor;
      ctx.fillRect(32, ly, W - 64, lh);
      ctx.globalAlpha = 1;
      // moving wafer chips
      const chips = 6;
      for (let k = 0; k < chips; k++) {
        const phase = (t / 500 + k / chips + i * 0.15) % 1;
        const cx = 32 + phase * (W - 64 - 10);
        ctx.fillStyle = '#0a1414';
        ctx.fillRect(cx, ly + lh / 2 - 4, 8, 8);
      }
    }

    // HBM pod accent
    if (c.hbmShareTarget > 0.01) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.min(1, c.hbmShareTarget / 0.3);
      ctx.fillStyle = HBM_COLOR;
      ctx.fillRect(W - 26, 46, 10, H - 82);
      ctx.globalAlpha = 1;
    }

    // node transition progress bar
    if (c.nodeTransition) {
      const prog = 1 - c.nodeTransition.quartersRemaining / Sim.NODE_LEAD_TIME_Q;
      ctx.fillStyle = '#1f3d3a'; ctx.fillRect(20, H - 22, W - 40, 8);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(20, H - 22, (W - 40) * prog, 8);
    }
    ctx.restore();
  }

  let animT = 0, animHandle = null;
  function animate() {
    animT += 16;
    const canvas = document.getElementById('fabCanvas');
    if (canvas && state) drawFab(canvas, player(), animT);
    animHandle = requestAnimationFrame(animate);
  }

  function priceChart(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * 2, h = canvas.height = 90 * 2;
    ctx.save(); ctx.scale(2, 2);
    const W = w / 2, H = h / 2;
    ctx.clearRect(0, 0, W, H);
    const hist = state.market.history.slice(-40);
    if (hist.length < 2) { ctx.restore(); return; }
    const prices = hist.map(x => x.price);
    const min = Math.min(...prices) * 0.95, max = Math.max(...prices) * 1.05;
    ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 1.5; ctx.beginPath();
    hist.forEach((pt, i) => {
      const x = (i / (hist.length - 1)) * (W - 10) + 5;
      const y = H - 8 - ((pt.price - min) / (max - min || 1)) * (H - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function newsFeed() {
    const items = (state.events || []).slice(-8).reverse();
    if (!items.length) return '<div class="small">아직 특이사항 없음</div>';
    return items.map(e => `<div>T${e.turn} · ${e.text}</div>`).join('');
  }

  function render() {
    if (state.turn === 0 || !state.gameOver) renderPlay(); else renderEnd();
  }

  function renderEnd() {
    if (animHandle) cancelAnimationFrame(animHandle);
    const all = state.companies;
    const rows = all.map(c => {
      const score = Sim.finalScore(c, all, state.initialGap);
      return { c, score };
    }).sort((a, b) => b.score - a.score);
    app.innerHTML = `
      <div class="panel">
        <h1>게임 종료 — ${state.year}년차 (T${state.turn})</h1>
        <p class="small">${player().bankrupt ? '파산으로 인한 조기 종료' : '10년 캠페인 완주'}</p>
        <table>
          <tr><th>순위</th><th>진영</th><th>누적 Econ. Profit</th><th>전략지표</th><th>Score</th></tr>
          ${rows.map((r, i) => `<tr${r.c.isPlayer ? ' style="color:#ffd23f"' : ''}>
            <td>${i + 1}</td><td>${r.c.name}${r.c.isPlayer ? ' (YOU)' : ''}</td>
            <td>$${fmt(r.c.cumEconomicProfit)}M</td>
            <td>${pct(Sim.strategicIndex(r.c, all, state.initialGap))}</td>
            <td>${fmt(r.score)}</td></tr>`).join('')}
        </table>
        <div class="gap"></div>
        <button class="primary" onclick="location.reload()">새 게임</button>
      </div>`;
  }

  function renderPlay() {
    const p = player();
    const ac = actionCount();
    const others = state.companies.filter(c => !c.isPlayer);
    const phase = Sim.PHASES[state.market.phase];

    app.innerHTML = `
      <div class="header-bar">
        <h1>DRAM CEO — ${p.name}</h1>
        <div class="small">T${state.turn}/40 · ${state.year}년차 Q${state.quarter} · ${Sim.ERAS[state.era].name}</div>
      </div>
      <div class="row">
        <div class="col" style="flex:1.3">
          <div class="panel">
            <h3>${p.name} 팹 — Node: ${Sim.NODES[p.node].name}${p.nodeTransition ? ` → ${Sim.NODES[p.nodeTransition.targetNode].name} (${p.nodeTransition.quartersRemaining}Q 남음)` : ''}</h3>
            <canvas id="fabCanvas" height="220"></canvas>
            <div class="stat-grid">
              <div>Capacity: ${fmt(p.capacity)}K wafers/Q</div>
              <div>가동률: ${pct(p.utilization)}</div>
              <div>수율 성숙도: ${pct(p.yieldMaturity)}</div>
              <div>HBM 배분: ${pct(p.hbmShareTarget)}</div>
              <div>현금: $${fmt(p.cash)}M</div>
              <div>누적 Econ.Profit: $${fmt(p.cumEconomicProfit)}M</div>
            </div>
          </div>
          <div class="gap"></div>
          <div class="panel">
            <h3>시장</h3>
            <div>국면: <span class="badge" style="background:${PHASE_COLOR[state.market.phase]};color:#062018">${phase.name}</span></div>
            <div class="small">Sufficiency(관측, 노이즈 포함): ${state.market.displaySufficiency.toFixed(3)}</div>
            <div class="small">가격지수: ${fmt(state.market.priceIndex, 1)} (기준 100)</div>
            <canvas id="priceCanvas" height="90"></canvas>
            <div class="small">데모 수요 국면: ${state.market.demandGrowthRegime === 'UP' ? '수요 가속(타이트 압력)' : '수요 둔화(루즈 압력)'} · 잔여 ${state.market.regimeQuartersRemaining}Q</div>
          </div>
          <div class="gap"></div>
          <div class="panel">
            <h3>뉴스</h3>
            <div class="news">${newsFeed()}</div>
          </div>
        </div>
        <div class="col" style="flex:1">
          <div class="panel">
            <div class="actioncount" style="background:${ac > 3 ? 'rgba(255,93,93,0.2)' : 'rgba(61,220,151,0.12)'};color:${ac > 3 ? '#ff5d5d' : '#3ddc97'}">이번 턴 결정: ${ac} / 3</div>

            <div class="lever ${staged.utilization !== committed.utilization ? 'changed' : ''}">
              <div class="lever-title"><span>가동률</span><span>${pct(staged.utilization)}</span></div>
              <input type="range" min="55" max="100" value="${staged.utilization * 100}" id="utilRange">
            </div>

            <div class="lever ${staged.hbmShareTarget !== committed.hbmShareTarget ? 'changed' : ''}">
              <div class="lever-title"><span>HBM 배분</span><span>${pct(staged.hbmShareTarget)}</span></div>
              <input type="range" min="0" max="45" value="${staged.hbmShareTarget * 100}" id="hbmRange">
              <div class="small">기회비용(컨벤셔널 상실분 추정): $${fmt(estimateHbmOpportunityCost(p), 0)}M/Q</div>
            </div>

            <div class="lever ${staged.yieldInvestLevel !== committed.yieldInvestLevel ? 'changed' : ''}">
              <div class="lever-title"><span>수율 투자</span></div>
              <select id="yieldSelect">
                <option value="0" ${staged.yieldInvestLevel === 0 ? 'selected' : ''}>낮음</option>
                <option value="1" ${staged.yieldInvestLevel === 1 ? 'selected' : ''}>보통</option>
                <option value="2" ${staged.yieldInvestLevel === 2 ? 'selected' : ''}>공격적</option>
              </select>
            </div>

            <div class="lever ${staged.cashStance !== committed.cashStance ? 'changed' : ''}">
              <div class="lever-title"><span>현금 관리</span></div>
              <select id="cashSelect">
                <option value="-1" ${staged.cashStance === -1 ? 'selected' : ''}>공격적 (자본비용↑, capex↑)</option>
                <option value="0" ${staged.cashStance === 0 ? 'selected' : ''}>중립</option>
                <option value="1" ${staged.cashStance === 1 ? 'selected' : ''}>보수적 (자본비용↓, capex↓)</option>
              </select>
            </div>

            <div class="lever ${staged.expandAmount > 0 ? 'changed' : ''}">
              <div class="lever-title"><span>증설 (신규 착공, ${Sim.CAPEX_LEAD_TIME_Q}Q 후 가동)</span></div>
              <input type="number" min="0" step="10" value="${staged.expandAmount}" id="expandInput"> K wafers/Q
            </div>

            <div class="lever ${staged.startNodeTransition ? 'changed' : ''}">
              <div class="lever-title"><span>노드 전환</span></div>
              ${p.nodeTransition ? `<div class="small">이미 진행 중 (${p.nodeTransition.quartersRemaining}Q 남음)</div>` :
                (p.node >= Sim.NODES.length - 1 ? `<div class="small">최선단 노드 도달</div>` :
                `<label class="small"><input type="checkbox" id="nodeCheck" ${staged.startNodeTransition ? 'checked' : ''}> ${Sim.NODES[p.node + 1].name}(으)로 전환 승인 — ${Sim.NODE_LEAD_TIME_Q}Q 리드타임, 이후 ${Sim.RAMP_VALLEY_QUARTERS}Q Ramp Valley</label>`)}
            </div>

            <button class="primary" id="nextTurnBtn" ${ac > 3 ? 'disabled' : ''} style="width:100%">다음 턴 →</button>
          </div>
          <div class="gap"></div>
          <div class="panel">
            <h3>경쟁사</h3>
            ${others.map(c => `<div class="compact-co">
              <b>${c.name}</b>${c.bankrupt ? ' <span style="color:#ff5d5d">[파산]</span>' : ''}<br>
              Node ${Sim.NODES[c.node].name} · 가동률 ${pct(c.utilization)} · HBM ${pct(c.hbmShareTarget)} · Cash $${fmt(c.cash)}M
            </div>`).join('')}
          </div>
        </div>
      </div>`;

    document.getElementById('utilRange').oninput = e => { staged.utilization = +e.target.value / 100; render(); };
    document.getElementById('hbmRange').oninput = e => { staged.hbmShareTarget = +e.target.value / 100; render(); };
    document.getElementById('yieldSelect').onchange = e => { staged.yieldInvestLevel = +e.target.value; render(); };
    document.getElementById('cashSelect').onchange = e => { staged.cashStance = +e.target.value; render(); };
    document.getElementById('expandInput').oninput = e => { staged.expandAmount = Math.max(0, +e.target.value || 0); render(); };
    const nc = document.getElementById('nodeCheck');
    if (nc) nc.onchange = e => { staged.startNodeTransition = e.target.checked; render(); };
    document.getElementById('nextTurnBtn').onclick = () => {
      state = Sim.runQuarter(state, staged, rng);
      resetStaged();
      render();
    };

    if (!animHandle) animate();
    requestAnimationFrame(() => { const pc = document.getElementById('priceCanvas'); if (pc) priceChart(pc); });
  }

  function estimateHbmOpportunityCost(p) {
    // Revenue a marginal 1% of wafer starts would earn as conventional (tier-2) output instead
    // of HBM, per Q102 — shown next to the HBM slider so the trade-off is never hidden.
    const waferStarts = p.capacity * p.utilization;
    const marginalWafers = waferStarts * 0.01;
    const nodeDef = Sim.NODES[p.node];
    const yieldEff = 0.55 + (0.92 - 0.55) * p.yieldMaturity;
    const priceUnit = state.market.priceIndex / 100;
    const convBits = marginalWafers * nodeDef.grossBit * yieldEff;
    return convBits * priceUnit;
  }

  startScreen();
})();
