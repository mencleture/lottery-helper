// ========== 状态管理（全局） ==========
let currentLotteryType = 'ssq';
let currentView = 'forecast';
let currentTheme = 'dark';
let currentHistoryTrendRange = 60;
let currentHistoryArchiveMode = 'card';
let currentHistoryStrategyFilter = 'all';
let isLoading = false;

const lotteryMetaMap = {
  ssq: {
    name: '双色球',
    short: '红6蓝1 · 周二四日',
    heroTitle: '双色球预测中心',
    heroDesc: '聚焦双色球的最新预测、图表分析与历史回溯，所有模块分开展示，页面更简洁。'
  },
  dlt: {
    name: '大乐透',
    short: '前5后2 · 周一三六',
    heroTitle: '大乐透预测中心',
    heroDesc: '聚焦大乐透的预测、走势与历史记录，避免多模块同屏导致视觉拥挤。'
  }
};

const statePool = {
  ssq: { historyData: [], currentPeriod: null, allSets: [], activeSetIndex: 0, masterRecommendations: [], activeMasterIndex: 0, atomicStrategies: [], confirmedRecommendation: null, recommendationHistory: [], statsData: null },
  dlt: { historyData: [], currentPeriod: null, allSets: [], activeSetIndex: 0, masterRecommendations: [], activeMasterIndex: 0, atomicStrategies: [], confirmedRecommendation: null, recommendationHistory: [], statsData: null }
};

const strategyMetaMap = {
  ssq: [
    { key: 'ml', name: 'ML模型推荐', badge: '🤖 ML模型', desc: 'RF+GB集成，三区+尾数+AC值特征工程' },
    { key: 'mystical', name: '玄学规律推荐', badge: '🔮 玄学规律', desc: '龙虎斗、五行生克、尾数玄机' },
    { key: 'hot', name: '红球热力追踪', badge: '🔥 红球热力', desc: '三区热度加权，中短遗漏窗口确认' },
    { key: 'cold', name: '冷号回补猎手', badge: '❄️ 冷号猎手', desc: '遗漏≥8期优先，边区冷号补偿' },
    { key: 'balanced', name: '三区均衡锁定', badge: '🛡️ 三区均衡', desc: '奇偶3:3，三区2:2:2，和值75~130' },
    { key: 'trend', name: '短周期动量', badge: '📈 短周期动量', desc: '非中区节奏分加成' },
    { key: 'zoneSum', name: '区间和值锚定', badge: '🧭 区间和值', desc: '中区(12-22)核心，尾数稀缺' },
    { key: 'pattern', name: '形态反转捕捉', badge: '🧩 形态反转', desc: '3~8期回摆+15期超冷+冷温断层' }
  ],
  dlt: [
    { key: 'ml', name: 'ML模型推荐', badge: '🤖 ML模型', desc: 'RF+GB集成，跨度+和值+连号特征' },
    { key: 'mystical', name: '玄学规律推荐', badge: '🔮 玄学规律', desc: '龙虎斗适配前区5+后区2结构' },
    { key: 'hot', name: '前区热点追踪', badge: '🔥 前区热点', desc: '中区补权，遗漏≤2期加速确认' },
    { key: 'cold', name: '前区冷号狙击', badge: '❄️ 前区冷号', desc: '遗漏≥10期深度冷号优先' },
    { key: 'balanced', name: '跨度均衡控制', badge: '🛡️ 跨度均衡', desc: '奇偶2:3/3:2，跨度25~32' },
    { key: 'trend', name: '中段延续趋势', badge: '📈 中段延续', desc: '10~30主体区间延续' },
    { key: 'zoneSum', name: '前区区间锚定', badge: '🧭 前区区间', desc: '三区(1-12/13-24/25-35)分布' },
    { key: 'pattern', name: '遗漏形态捕捉', badge: '🧩 遗漏形态', desc: '4~9期回摆+14期超冷+冷热断层' }
  ]
};

function getStrategyMeta() {
  return strategyMetaMap[currentLotteryType] || strategyMetaMap.ssq;
}

function rebuildMasterRecommendations(state) {
  const atomicSets = Array.isArray(state.atomicStrategies) ? state.atomicStrategies.filter(Boolean) : [];

  // 保存已有的 performance 数据（按策略名映射），rebuild 后恢复
  const savedPerf = {};
  if (state.masterRecommendations) {
    state.masterRecommendations.forEach(item => {
      if (item.performance) savedPerf[item.name] = item.performance;
    });
  }

  const dedupedSets = [];
  const seenKeys = new Set();

  atomicSets.forEach(set => {
    const key = set?.atomicKey || set?.masterKey || set?.atomicName || set?.masterName;
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    dedupedSets.push({
      ...set,
      masterKey: set.masterKey || set.atomicKey,
      masterName: set.masterName || set.atomicName,
      role: set.role || set.atomicSource || 'rule'
    });
  });

  state.masterRecommendations = dedupedSets.map((set, index) => {
    const matchedMeta = getStrategyMeta().find(meta => meta.key === (set.masterKey || set.atomicKey));
    const fallbackMeta = matchedMeta || { key: `custom-${index}`, name: set.masterName || set.atomicName || `推荐${index + 1}`, badge: set.badge || `推荐 ${index + 1}`, desc: '策略推荐' };
    const name = fallbackMeta.name;
    return {
      ...fallbackMeta,
      key: set.masterKey || set.atomicKey || fallbackMeta.key,
      name,
      badge: set.badge || fallbackMeta.badge,
      desc: fallbackMeta.desc,
      role: set.role || fallbackMeta.role || 'mixed',
      // 优先用保存的 performance（来自 backfill），其次用 set 自带的
      performance: savedPerf[name] || set.performance || null,
      index,
      set
    };
  }).filter(item => !!item.set);

  sortMasterRecommendations(state);

  if (state.activeMasterIndex >= state.masterRecommendations.length) state.activeMasterIndex = 0;
  state.activeSetIndex = state.activeMasterIndex;
}

function sortMasterRecommendations(state) {
  state.masterRecommendations.sort((a, b) => {
    const aAvg = a.performance?.avgHit ?? -1;
    const bAvg = b.performance?.avgHit ?? -1;
    if (bAvg !== aAvg) return bAvg - aAvg;
    const aBest = a.performance?.bestHit ?? -1;
    const bBest = b.performance?.bestHit ?? -1;
    return bBest - aBest;
  });
}

function getActiveMasterRecommendation(state) {
  rebuildMasterRecommendations(state);
  return state.masterRecommendations[state.activeMasterIndex] || null;
}

function saveState() {
  try {
    localStorage.setItem('lottery_statePool', JSON.stringify(statePool));
    localStorage.setItem('lottery_currentType', currentLotteryType);
    localStorage.setItem('lottery_currentView', currentView);
    localStorage.setItem('lottery_theme', currentTheme);
  } catch (e) {
    console.warn('保存状态失败:', e);
  }
}

const STATE_SCHEMA_VERSION = 2;
let _pendingMigrationRegenerate = false;

function loadState() {
  try {
    const savedVersion = localStorage.getItem('lottery_stateVersion');
    const needMigration = !savedVersion || Number(savedVersion) < STATE_SCHEMA_VERSION;

    const saved = localStorage.getItem('lottery_statePool');
    const savedType = localStorage.getItem('lottery_currentType');
    const savedView = localStorage.getItem('lottery_currentView');
    const savedTheme = localStorage.getItem('lottery_theme');
    if (saved) {
      const parsed = JSON.parse(saved);
      ['ssq', 'dlt'].forEach(type => {
        if (parsed[type]) {
          Object.assign(statePool[type], parsed[type]);
          rebuildMasterRecommendations(statePool[type]);
        }
      });
    }

    if (needMigration) {
      _pendingMigrationRegenerate = true;
      localStorage.setItem('lottery_stateVersion', String(STATE_SCHEMA_VERSION));
    }

    if (savedType && ['ssq', 'dlt'].includes(savedType)) currentLotteryType = savedType;
    if (savedView && ['forecast', 'charts', 'history'].includes(savedView)) currentView = savedView;
    if (savedTheme && ['dark', 'light'].includes(savedTheme)) currentTheme = savedTheme;
  } catch (e) {
    console.warn('加载状态失败:', e);
  }
}

function getState() { return statePool[currentLotteryType]; }

function applyTheme() {
  document.body.setAttribute('data-theme', currentTheme);
  const icon = document.getElementById('themeIcon');
  const text = document.getElementById('themeText');
  if (icon) icon.textContent = currentTheme === 'dark' ? '🌙' : '🌞';
  if (text) text.textContent = currentTheme === 'dark' ? '夜间模式' : '白天模式';
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme();
  renderAll();
  saveState();
  showToast(currentTheme === 'dark' ? '已切换到夜间模式' : '已切换到白天模式');
}

function getNextPeriod(latestPeriod, type, latestDate) {
  const p = latestPeriod.toString();
  const yearShort = parseInt(p.slice(0, 2));
  const seq = parseInt(p.slice(2));
  const nextSeq = seq + 1;
  let nextPeriod = nextSeq > 999
    ? String(yearShort + 1).padStart(2, '0') + '001'
    : String(yearShort).padStart(2, '0') + String(nextSeq).padStart(3, '0');

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  if (latestDate && todayStr === latestDate) {
    const ys = parseInt(nextPeriod.slice(0, 2));
    const seq2 = parseInt(nextPeriod.slice(2)) + 1;
    return seq2 > 999 ? String(ys + 1).padStart(2, '0') + '001' : String(ys).padStart(2, '0') + String(seq2).padStart(3, '0');
  }
  return nextPeriod;
}

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  applyTheme();
  syncLotteryButtons();
  syncViewButtons();
  syncHistoryControls();
  // 对已有策略数据填充 performance（从回测结果）
  const initState = getState();
  if (initState.atomicStrategies?.length > 0 && (!initState.masterRecommendations?.[0]?.performance)) {
    rebuildMasterRecommendations(initState);
    backfillStrategyPerformance(initState);
  }
  updatePageMeta();
  renderAll();
  refreshData().then(() => {
    // 版本迁移 或 策略数据被清空（如被旧版迁移误删）→ 自动重新生成
    const state = getState();
    const needRegen = _pendingMigrationRegenerate || !state.atomicStrategies || state.atomicStrategies.length === 0;
    if (needRegen) {
      _pendingMigrationRegenerate = false;
      console.log('[AutoRegen] 策略数据为空，自动重新生成推荐...');
      generateNewRecommendation();
    }
  });
});

function syncLotteryButtons() {
  document.querySelectorAll('.lottery-switch-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === currentLotteryType));
}

function syncViewButtons() {
  document.querySelectorAll('.view-switch-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === currentView));
  document.querySelectorAll('.content-panel').forEach(panel => panel.classList.toggle('active', panel.id === `view-${currentView}`));
}

function syncHistoryControls() {
  document.querySelectorAll('.range-switch-btn').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.range) === currentHistoryTrendRange));
  document.querySelectorAll('.archive-switch-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === currentHistoryArchiveMode));
}

function setHistoryTrendRange(range) {
  currentHistoryTrendRange = 60;
  syncHistoryControls();
  renderHistoryDashboard(getState());
  showToast('历史趋势固定展示最近 60 期');
}

function toggleHistoryReplay(period) {
  const cards = Array.from(document.querySelectorAll('.history-accordion-card'));
  cards.forEach(card => {
    const isTarget = card.dataset.period === String(period);
    card.classList.toggle('expanded', isTarget ? !card.classList.contains('expanded') : false);
  });
}

function setHistoryArchiveMode(mode) {
  currentHistoryArchiveMode = mode === 'table' ? 'table' : 'card';
  syncHistoryControls();
  renderHistory(getState().historyData);
  showToast(currentHistoryArchiveMode === 'table' ? '已切换到表格视图' : '已切换到卡片视图');
}

function setHistoryStrategyFilter(strategyName) {
  currentHistoryStrategyFilter = strategyName || 'all';
  renderHistoryDashboard(getState());
  showToast(currentHistoryStrategyFilter === 'all' ? '已切换为查看全部策略走势' : `已切换为仅查看：${currentHistoryStrategyFilter}`);
}

function updatePageMeta() {
  const meta = lotteryMetaMap[currentLotteryType];
  document.getElementById('currentLotteryName').textContent = meta.name;
  document.getElementById('currentLotteryMeta').textContent = meta.short;
  document.getElementById('heroTitle').textContent = meta.heroTitle;
  document.getElementById('heroDesc').textContent = meta.heroDesc;
  const heroDateDisplay = document.getElementById('heroDateDisplay');
  const heroUpdateTime = document.getElementById('heroUpdateTime');
  const heroRecordCount = document.getElementById('heroRecordCount');
  if (heroDateDisplay) heroDateDisplay.textContent = meta.name;
  if (heroUpdateTime) heroUpdateTime.textContent = document.getElementById('updateTime')?.textContent || '--';
  if (heroRecordCount) heroRecordCount.textContent = document.getElementById('recordCount')?.textContent || '0 条';
}

function selectLottery(type) {
  if (isLoading) return;
  currentLotteryType = type;
  syncLotteryButtons();
  renderAll();
  updatePageMeta();
  // 切换彩种时，如果目标彩种没有策略数据，自动生成
  const state = getState();
  if (!state.atomicStrategies || state.atomicStrategies.length === 0) {
    refreshData().then(() => generateNewRecommendation());
  } else if (currentView === 'charts' && !state.statsData) {
    loadStatsData();
  }
  saveState();
}

function switchView(viewName) {
  currentView = viewName;
  syncViewButtons();
  if (viewName === 'charts' && !getState().statsData) loadStatsData();
  renderAll();
  saveState();
}

async function refreshData() {
  if (isLoading) return;
  isLoading = true;
  showLoading(true);
  const state = getState();
  try {
    const newData = await fetchFrom500Com(currentLotteryType, 120);
    if (newData && newData.length > 0) {
      const existing = new Set(state.historyData.map(x => x.period));
      let added = 0;
      newData.forEach(item => { if (!existing.has(item.period)) { state.historyData.push(item); added++; } });
      state.historyData.sort((a, b) => b.period.localeCompare(a.period));
      state.historyData = state.historyData.slice(0, 200);
      document.getElementById('dataSource').textContent = `🌐 500彩票网实时数据（+${added}条）`;
      state.statsData = null;
    } else {
      if (state.historyData.length === 0) state.historyData = getBuiltInData(currentLotteryType);
      document.getElementById('dataSource').textContent = '📦 内置历史数据';
    }

    document.getElementById('updateTime').textContent = new Date().toLocaleTimeString('zh-CN');
    document.getElementById('recordCount').textContent = `${state.historyData.length} 条`;
    const heroUpdateTime = document.getElementById('heroUpdateTime');
    const heroRecordCount = document.getElementById('heroRecordCount');
    if (heroUpdateTime) heroUpdateTime.textContent = document.getElementById('updateTime').textContent;
    if (heroRecordCount) heroRecordCount.textContent = document.getElementById('recordCount').textContent;

    if (!state.statsData) await loadStatsData();
    renderHistory(state.historyData);

    const latestRecord = state.historyData[0];
    if (state.currentPeriod === null) {
      await generateNewRecommendation();
    } else if (latestRecord && latestRecord.period.localeCompare(state.currentPeriod) >= 0) {
      checkResults(state);
      await adoptNewRecommendation();
    } else {
      renderRecommendationPanel(state);
    }

    renderHistoryDashboard(state);
    renderPrizeRules();
  } catch (error) {
    console.error('获取数据失败:', error);
    if (state.historyData.length === 0) state.historyData = getBuiltInData(currentLotteryType);
    checkResults(state);
    if (!state.statsData) await loadStatsData();
    renderRecommendationPanel(state);
    renderHistory(state.historyData);
    renderHistoryDashboard(state);
    renderPrizeRules();
  } finally {
    isLoading = false;
    showLoading(false);
    saveState();
  }
}

async function fetchFrom500Com(type) {
  const baseUrl = type === 'ssq' ? 'https://datachart.500.com/ssq/history/newinc/history.php' : 'https://datachart.500.com/dlt/history/newinc/history.php';
  try {
    const response = await fetch(`${baseUrl}?start=25001&end=26100`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tbody = doc.getElementById('tdata');
    if (!tbody) return null;
    const records = [];
    tbody.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return;
      const period = cells[0].textContent.trim();
      if (!/^\d{5,}$/.test(period)) return;
      if (type === 'ssq') {
        const redNumbers = Array.from({ length: 6 }, (_, i) => parseInt(cells[i + 1]?.textContent?.trim() || '0')).filter(n => n >= 1 && n <= 33);
        const blueNumber = parseInt(cells[7]?.textContent?.trim() || '0');
        const dateStr = cells[cells.length - 1]?.textContent?.trim() || '';
        if (redNumbers.length === 6 && blueNumber >= 1 && blueNumber <= 16) records.push({ period, date: dateStr, redNumbers, blueNumber });
      } else {
        const frontNumbers = Array.from({ length: 5 }, (_, i) => parseInt(cells[i + 1]?.textContent?.trim() || '0')).filter(n => n >= 1 && n <= 35);
        const backNumbers = [6, 7].map(i => parseInt(cells[i]?.textContent?.trim() || '0')).filter(n => n >= 1 && n <= 12);
        const dateStr = cells[cells.length - 1]?.textContent?.trim() || '';
        if (frontNumbers.length === 5 && backNumbers.length === 2) records.push({ period, date: dateStr, frontNumbers, backNumbers });
      }
    });
    return records;
  } catch (error) {
    console.error(`[${type}] 抓取失败:`, error);
    return null;
  }
}

async function generateNewRecommendation() {
  const state = getState();
  if (state.historyData.length === 0) return;
  try {
    const result = await window.electronAPI.getRecommendation(currentLotteryType, state.historyData);
    if (result.success && result.data) {
      const latest = state.historyData[0];
      state.currentPeriod = getNextPeriod(latest.period, currentLotteryType, latest.date);
      state.allSets = result.data;
      state.atomicStrategies = result.meta?.atomicStrategies || [];
      state.activeSetIndex = 0;
      state.activeMasterIndex = 0;
      state.confirmedRecommendation = null;
      rebuildMasterRecommendations(state);
      // 自动回测：填充 performance 数据，用于排序
      backfillStrategyPerformance(state);
      const topStrategy = state.masterRecommendations[0];
      if (state.currentPeriod && topStrategy?.set) {
        state.recommendationHistory = state.recommendationHistory.filter(item => item.period !== state.currentPeriod);
        state.recommendationHistory.unshift({
          period: state.currentPeriod,
          setIndex: topStrategy.index,
          label: topStrategy.name,
          set: topStrategy.set,
          savedAt: new Date().toLocaleString('zh-CN'),
          result: null,
          auto: true
        });
      }
      renderRecommendationPanel(state);
      renderHistoryDashboard(state);
      saveState();
    }
  } catch (error) {
    console.error('生成推荐失败:', error);
  }
}

/**
 * 用 buildStrategyBacktest 回测结果填充 masterRecommendations 的 performance 字段
 * 同时写回 state.allSets，这样 renderRecommendationPanel 内的 rebuildMasterRecommendations 也能读到
 */
function backfillStrategyPerformance(state) {
  const backtests = buildStrategyBacktest(state);
  if (backtests.length === 0) {
    console.log('[Backfill] 回测结果为空，跳过');
    return;
  }

  const strategyHits = {};
  for (const period of backtests) {
    for (const s of period.strategies) {
      if (!strategyHits[s.strategy]) strategyHits[s.strategy] = [];
      strategyHits[s.strategy].push(s.result.totalHit);
    }
  }
  console.log('[Backfill] 回测聚合:', Object.entries(strategyHits).map(([k, v]) => `${k}: avg=${(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)} best=${Math.max(...v)} n=${v.length}`).join(' | '));

  const allMeta = getStrategyMeta();

  // 填充 masterRecommendations
  state.masterRecommendations.forEach(item => {
    const hits = strategyHits[item.name] || strategyHits[item.masterName] || strategyHits[item.atomicName];
    if (hits && hits.length > 0) {
      const avg = parseFloat((hits.reduce((a, b) => a + b, 0) / hits.length).toFixed(1));
      const best = Math.max(...hits);
      const perf = { avgHit: avg, bestHit: best, totalPeriods: hits.length };
      item.performance = perf;
      console.log(`[Backfill] ${item.name} → avg=${avg} best=${best}`);
      // 同步写回 allSets：下次 rebuildMasterRecommendations 时也能读到
      if (state.allSets) {
        state.allSets.forEach(s => {
          const meta = allMeta.find(m => m.key === (s.masterKey || s.atomicKey));
          const sname = meta?.name || s.masterName || s.atomicName;
          if (sname === item.name) s.performance = perf;
        });
      }
    } else {
      console.log(`[Backfill] ${item.name} → 无匹配回测数据`);
    }
  });

  sortMasterRecommendations(state);
  console.log('[Backfill] 排序后顺序:', state.masterRecommendations.map(m => `${m.name}(avg=${m.performance?.avgHit ?? 'null'})`).join(' > '));
}

async function regenerateAllGroups() {
  const state = getState();
  if (state.historyData.length === 0) return;
  document.getElementById('recommendationContainer').innerHTML = '<div class="empty-state"><div class="empty-icon">⚙️</div><p>正在生成新推荐...</p></div>';
  try {
    const result = await window.electronAPI.getRecommendation(currentLotteryType, state.historyData);
    if (result.success && result.data.length > 0) {
      state.allSets = result.data;
      state.atomicStrategies = result.meta?.atomicStrategies || [];
      state.activeSetIndex = 0;
      state.activeMasterIndex = 0;
      state.confirmedRecommendation = null;
      rebuildMasterRecommendations(state);
      backfillStrategyPerformance(state);
      renderRecommendationPanel(state);
      renderHistoryDashboard(state);
      saveState();
      showToast(`📊 已更新 ${state.masterRecommendations.length} 个策略展示！`);
    }
  } catch (error) {
    console.error('重新生成失败:', error);
    showToast('重新生成失败');
  }
}

function jumpToSet(index) {
  const state = getState();
  rebuildMasterRecommendations(state);
  if (index >= 0 && index < state.masterRecommendations.length) {
    state.activeMasterIndex = index;
    state.activeSetIndex = index;
    renderRecommendationPanel(state);
    saveState();
  }
}

async function adoptNewRecommendation() { if (getState().historyData.length > 0) await generateNewRecommendation(); }

function checkResults(state) {
  const periodsToCheck = [...new Set(state.recommendationHistory.filter(h => !h.result).map(h => h.period))];
  for (const period of periodsToCheck) {
    const record = state.historyData.find(r => r.period === period);
    if (!record) continue;
    for (const item of state.recommendationHistory) {
      if (item.period !== period || item.result) continue;
      const set = item.set;
      if (currentLotteryType === 'ssq') {
        const redHit = set.redBalls.filter(n => record.redNumbers.includes(n)).length;
        const blueHit = set.blueBall === record.blueNumber ? 1 : 0;
        item.result = { redHit, blueHit, totalHit: redHit + blueHit };
      } else {
        const frontHit = set.frontBalls.filter(n => record.frontNumbers.includes(n)).length;
        const backHit = set.backBalls.filter(n => record.backNumbers.includes(n)).length;
        item.result = { frontHit, backHit, totalHit: frontHit + backHit };
      }
    }
  }
}

function renderAll() {
  const state = getState();
  document.getElementById('recordCount').textContent = `${state.historyData.length} 条`;
  renderPrizeRules();
  renderHistory(state.historyData);
  renderRecommendationPanel(state);
  renderHistoryDashboard(state);
  if (state.statsData) renderStatsPanel(state.statsData);
}

function getForecastMetrics(set, type) {
  const main = type === 'ssq' ? [...(set.redBalls || [])] : [...(set.frontBalls || [])];
  const back = type === 'ssq' ? [set.blueBall] : [...(set.backBalls || [])];
  const sorted = [...main].sort((a, b) => a - b);
  const odd = main.filter(n => n % 2 === 1).length;
  const even = main.length - odd;
  const sum = main.reduce((a, b) => a + b, 0);
  const span = sorted.length ? sorted[sorted.length - 1] - sorted[0] : 0;
  const consecutive = sorted.slice(1).filter((n, i) => n - sorted[i] === 1).length;
  const zone = type === 'ssq'
    ? [main.filter(n => n <= 11).length, main.filter(n => n >= 12 && n <= 22).length, main.filter(n => n >= 23).length]
    : [main.filter(n => n <= 12).length, main.filter(n => n >= 13 && n <= 24).length, main.filter(n => n >= 25).length];
  return { main, back, sorted, odd, even, sum, span, consecutive, zone };
}

function renderForecastReference(latestRecord) {
  if (!latestRecord) return '<div class="reason-grid"><div class="reason-chip">暂无最新开奖参考</div></div>';
  if (currentLotteryType === 'ssq') {
    return `<div class="review-card"><div class="review-card-head"><span>上期开奖参考</span><span class="review-status done">第 ${latestRecord.period} 期</span></div><div class="review-ball-row">${latestRecord.redNumbers.map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span><span class="ball-sm blue">${String(latestRecord.blueNumber).padStart(2, '0')}</span></div><div class="review-result">开奖日期：${latestRecord.date || '--'}</div></div>`;
  }
  return `<div class="review-card"><div class="review-card-head"><span>上期开奖参考</span><span class="review-status done">第 ${latestRecord.period} 期</span></div><div class="review-ball-row">${latestRecord.frontNumbers.map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span>${latestRecord.backNumbers.map(n => `<span class="ball-sm blue">${String(n).padStart(2, '0')}</span>`).join('')}</div><div class="review-result">开奖日期：${latestRecord.date || '--'}</div></div>`;
}

function renderRecommendationPanel(state) {
  const container = document.getElementById('recommendationContainer');
  rebuildMasterRecommendations(state);
  if (!state.currentPeriod || state.masterRecommendations.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💡</div><p>点击“刷新数据并生成推荐”查看当前彩种的最新预测</p></div>';
    return;
  }

  const latestRecord = state.historyData[0];
  const activeMaster = getActiveMasterRecommendation(state);
  if (!activeMaster?.set) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🧩</div><p>推荐结构正在初始化，请重新生成一次推荐</p></div>';
    return;
  }

  const strategyCards = state.masterRecommendations.map((item, index) => {
    const set = item.set;
    const metrics = getForecastMetrics(set, currentLotteryType);
    const mainBallsHtml = currentLotteryType === 'ssq'
      ? `<div class="balls-block"><div class="balls-label">红球</div><div class="balls">${set.redBalls.map(n => `<span class="ball red">${String(n).padStart(2, '0')}</span>`).join('')}</div></div><div class="balls-block"><div class="balls-label">蓝球</div><div class="balls"><span class="ball blue">${String(set.blueBall).padStart(2, '0')}</span></div></div>`
      : `<div class="balls-block"><div class="balls-label">前区</div><div class="balls">${set.frontBalls.map(n => `<span class="ball red">${String(n).padStart(2, '0')}</span>`).join('')}</div></div><div class="balls-block"><div class="balls-label">后区</div><div class="balls">${set.backBalls.map(n => `<span class="ball blue">${String(n).padStart(2, '0')}</span>`).join('')}</div></div>`;
    const perfText = item.performance ? `平均命中 ${item.performance.avgHit} · 最佳 ${item.performance.bestHit}` : '历史表现待统计';
    const reasonText = Array.isArray(item.reason) && item.reason.length ? item.reason.slice(0, 3).map(r => `<div class="reason-chip">${r}</div>`).join('') : '<div class="reason-chip">暂无策略说明</div>';
    const statsHtml = [
      ['主区和值', metrics.sum],
      ['奇偶比例', `${metrics.odd}:${metrics.even}`],
      ['跨度', metrics.span],
      ['连号数', metrics.consecutive]
    ].map(([label, value]) => `<div class="pill-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
    return `
      <div class="strategy-rank-card">
        <div class="strategy-rank-head">
          <div class="strategy-rank-no">${index + 1}</div>
          <div class="strategy-rank-meta">
            <div class="forecast-label">历史成绩排名 #${index + 1}</div>
            <h4>${item.name}</h4>
            <div class="forecast-meta">${item.badge} · ${perfText}</div>
          </div>
        </div>
        <div class="forecast-balls strategy-rank-balls">${mainBallsHtml}</div>
        <div class="pill-stat-grid compact">${statsHtml}</div>
        <div class="reason-grid compact">${reasonText}</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="result-bar pending"><div><div class="result-title">第 ${state.currentPeriod} 期</div><div class="result-subtitle">固定策略按历史成绩降序排列展示</div></div><span class="strategy-badge normal">📊 排名策略榜</span></div>
    <div class="strategy-rank-grid">${strategyCards}</div>`;
}

async function loadStatsData() {
  const state = getState();
  const fallback = buildSimpleStatsFromHistory(state.historyData, currentLotteryType);
  state.statsData = fallback;
  renderStatsPanel(fallback);
}

function buildSimpleStatsFromHistory(historyData, type) {
  const recent = historyData.slice(0, 30);
  const mainMax = type === 'ssq' ? 33 : 35;
  const backMax = type === 'ssq' ? 16 : 12;
  const freq = {}, backFreq = {}, omission = {}, zoneStats = [0, 0, 0], oddEvenMap = {};
  for (let i = 1; i <= mainMax; i++) { freq[i] = 0; omission[i] = recent.length; }
  for (let i = 1; i <= backMax; i++) backFreq[i] = 0;

  recent.forEach((item, idx) => {
    const main = type === 'ssq' ? item.redNumbers : item.frontNumbers;
    const back = type === 'ssq' ? [item.blueNumber] : item.backNumbers;
    let odd = 0;
    main.forEach(n => {
      freq[n] = (freq[n] || 0) + 1;
      if (omission[n] === recent.length) omission[n] = idx;
      if (n % 2 === 1) odd++;
      if (type === 'ssq') {
        if (n <= 11) zoneStats[0]++; else if (n <= 22) zoneStats[1]++; else zoneStats[2]++;
      } else {
        if (n <= 12) zoneStats[0]++; else if (n <= 24) zoneStats[1]++; else zoneStats[2]++;
      }
    });
    const key = `${odd}:${main.length - odd}`;
    oddEvenMap[key] = (oddEvenMap[key] || 0) + 1;
    back.forEach(n => backFreq[n] = (backFreq[n] || 0) + 1);
  });

  const hot = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const cold = Object.entries(omission).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const backHot = Object.entries(backFreq).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const oddEven = Object.entries(oddEvenMap).sort((a, b) => b[1] - a[1]);
  const sumSeries = recent.map(item => {
    const nums = type === 'ssq' ? item.redNumbers : item.frontNumbers;
    return { period: item.period, sum: nums.reduce((a, b) => a + b, 0) };
  }).reverse();
  const avgSum = sumSeries.length ? (sumSeries.reduce((a, b) => a + b.sum, 0) / sumSeries.length).toFixed(1) : '--';
  return { hot, cold, backHot, oddEven, sumSeries, zoneStats, total: historyData.length, avgSum, sample: recent.length };
}

function renderStatsPanel(stats) {
  const container = document.getElementById('statsContainer');
  const maxHot = Math.max(...(stats.hot || []).map(x => Number(x[1] || 0)), 1);
  const maxBack = Math.max(...(stats.backHot || []).map(x => Number(x[1] || 0)), 1);
  const maxCold = Math.max(...(stats.cold || []).map(x => Number(x[1] || 0)), 1);
  const maxSum = Math.max(...(stats.sumSeries || []).map(x => Number(x.sum || 0)), 1);
  const maxZone = Math.max(...(stats.zoneStats || [1]));

  updateStatsOverview(stats);
  container.innerHTML = `
    <div class="analysis-chart-grid">
      <div class="insight-card feature-red">
        <div class="insight-card-head"><div><div class="insight-eyebrow">热度</div><h4>主区热号分布</h4></div><div class="insight-badge">Top 10</div></div>
        <div class="metric-list">${(stats.hot || []).map(([num, count]) => `<div class="metric-row"><span class="metric-name">${String(num).padStart(2, '0')}号</span><div class="metric-track"><div class="metric-fill red" style="width:${Math.round((count / maxHot) * 100)}%"></div></div><span class="metric-value">${count}</span></div>`).join('')}</div>
      </div>

      <div class="insight-card feature-blue">
        <div class="insight-card-head"><div><div class="insight-eyebrow">蓝球/后区</div><h4>蓝球 / 后区热度</h4></div><div class="insight-badge">近期热点</div></div>
        <div class="metric-list">${(stats.backHot || []).map(([num, count]) => `<div class="metric-row"><span class="metric-name">${String(num).padStart(2, '0')}号</span><div class="metric-track"><div class="metric-fill blue" style="width:${Math.round((count / maxBack) * 100)}%"></div></div><span class="metric-value">${count}</span></div>`).join('')}</div>
      </div>

      <div class="insight-card feature-gold">
        <div class="insight-card-head"><div><div class="insight-eyebrow">遗漏</div><h4>近期冷号观察</h4></div><div class="insight-badge">Top 10</div></div>
        <div class="metric-list">${(stats.cold || []).map(([num, count]) => `<div class="metric-row"><span class="metric-name">${String(num).padStart(2, '0')}号</span><div class="metric-track"><div class="metric-fill gold" style="width:${Math.round((count / maxCold) * 100)}%"></div></div><span class="metric-value">${count}期</span></div>`).join('')}</div>
      </div>

      <div class="insight-card feature-purple">
        <div class="insight-card-head"><div><div class="insight-eyebrow">结构</div><h4>奇偶比例分布</h4></div><div class="insight-badge">最近${stats.sample}期</div></div>
        <div class="pill-stat-grid">${(stats.oddEven || []).slice(0, 6).map(([ratio, count]) => `<div class="pill-stat"><span>${ratio}</span><strong>${count}次</strong></div>`).join('')}</div>
      </div>

      <div class="insight-card full-span feature-neutral">
        <div class="insight-card-head"><div><div class="insight-eyebrow">走势</div><h4>和值走势</h4></div><div class="insight-badge">最近${stats.sample}期</div></div>
        <div class="sum-trend-list">${(stats.sumSeries || []).map(item => `<div class="sum-trend-row"><span class="sum-period">${item.period}</span><div class="sum-track"><div class="sum-fill" style="width:${Math.round((item.sum / maxSum) * 100)}%"></div></div><span class="sum-value">${item.sum}</span></div>`).join('')}</div>
      </div>

      <div class="insight-card full-span feature-neutral">
        <div class="insight-card-head"><div><div class="insight-eyebrow">分区</div><h4>区间分布统计</h4></div><div class="insight-badge">三区结构</div></div>
        <div class="zone-grid">${(stats.zoneStats || []).map((count, idx) => `<div class="zone-card"><div class="zone-label">${getZoneLabel(idx)}</div><div class="zone-bar"><div class="zone-fill" style="width:${Math.round((count / maxZone) * 100)}%"></div></div><div class="zone-value">${count}</div></div>`).join('')}</div>
      </div>
    </div>`;
}

function updateStatsOverview(stats) {
  const grid = document.getElementById('statsOverviewGrid');
  if (!grid) return;
  const hotMain = stats.hot?.[0] ? `${String(stats.hot[0][0]).padStart(2, '0')}号` : '--';
  const hotBack = stats.backHot?.[0] ? `${String(stats.backHot[0][0]).padStart(2, '0')}号` : '--';
  const coldMain = stats.cold?.[0] ? `${String(stats.cold[0][0]).padStart(2, '0')}号` : '--';
  const hotRatio = stats.oddEven?.[0]?.[0] || '--';
  grid.innerHTML = `
    <div class="stat-overview-card glass-panel"><div class="stat-overview-label">数据样本</div><div class="stat-overview-value">${stats.total || 0}</div></div>
    <div class="stat-overview-card glass-panel"><div class="stat-overview-label">主区热号</div><div class="stat-overview-value">${hotMain}</div></div>
    <div class="stat-overview-card glass-panel"><div class="stat-overview-label">蓝球/后区热号</div><div class="stat-overview-value">${hotBack}</div></div>
    <div class="stat-overview-card glass-panel"><div class="stat-overview-label">平均和值</div><div class="stat-overview-value">${stats.avgSum}</div></div>`;
  const box = document.getElementById('analysisSummaryBox');
  if (box) box.innerHTML = `
    <div class="analysis-summary-tags">
      <span class="analysis-summary-chip"><em>主区热号</em><strong>${hotMain}</strong></span>
      <span class="analysis-summary-chip"><em>冷号观察</em><strong>${coldMain}</strong></span>
      <span class="analysis-summary-chip"><em>蓝球/后区热号</em><strong>${hotBack}</strong></span>
      <span class="analysis-summary-chip"><em>奇偶热点</em><strong>${hotRatio}</strong></span>
      <span class="analysis-summary-chip"><em>平均和值</em><strong>${stats.avgSum}</strong></span>
    </div>
    <div class="analysis-summary-note">刷新数据后会基于最新样本自动更新这里的分析摘要。</div>`;
}

function renderPrizeRules() {
  const el = document.getElementById('prizeRulesCard');
  if (!el) return;
  if (currentLotteryType === 'ssq') {
    el.innerHTML = `
      <div class="prize-rules-header"><div><div class="analysis-badge">Prize Rules</div><h3>双色球中奖规则说明</h3></div><p>红球 01-33 选 6 个，蓝球 01-16 选 1 个</p></div>
      <div class="prize-rules-grid">
        ${[['一等奖','6+1','6个红球 + 1个蓝球'],['二等奖','6+0','6个红球'],['三等奖','5+1','5红 + 1蓝'],['四等奖','5+0 / 4+1','5红或4红1蓝'],['五等奖','4+0 / 3+1','4红或3红1蓝'],['六等奖','2+1 / 1+1 / 0+1','命中蓝球即可']].map(([a,b,c])=>`<div class="prize-rule-item"><div class="prize-level">${a}</div><div class="prize-condition">${b}</div><div class="prize-desc">${c}</div></div>`).join('')}
      </div>`;
  } else {
    el.innerHTML = `
      <div class="prize-rules-header"><div><div class="analysis-badge">Prize Rules</div><h3>大乐透中奖规则说明</h3></div><p>前区 01-35 选 5 个，后区 01-12 选 2 个</p></div>
      <div class="prize-rules-grid">
        ${[['一等奖','5+2','前5 + 后2'],['二等奖','5+1','前5 + 后1'],['三等奖','5+0 / 4+2','前5或前4后2'],['四等奖','4+1 / 3+2','前4后1或前3后2'],['五等奖','4+0 / 3+1 / 2+2','组合命中'],['六等奖','3+0 / 2+1 / 1+2 / 0+2','基础命中']].map(([a,b,c])=>`<div class="prize-rule-item"><div class="prize-level">${a}</div><div class="prize-condition">${b}</div><div class="prize-desc">${c}</div></div>`).join('')}
      </div>`;
  }
}

function formatBacktestSet(set) {
  return currentLotteryType === 'ssq'
    ? `${set.redBalls.map(n => String(n).padStart(2, '0')).join(' ')} + ${String(set.blueBall).padStart(2, '0')}`
    : `${set.frontBalls.map(n => String(n).padStart(2, '0')).join(' ')} + ${set.backBalls.map(n => String(n).padStart(2, '0')).join(' ')}`;
}

function renderBacktestBalls(set) {
  return currentLotteryType === 'ssq'
    ? `${set.redBalls.map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span><span class="ball-sm blue">${String(set.blueBall).padStart(2, '0')}</span>`
    : `${set.frontBalls.map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span>${set.backBalls.map(n => `<span class="ball-sm blue">${String(n).padStart(2, '0')}</span>`).join('')}`;
}

function buildStrategyBacktest(state) {
  const history = state.historyData || [];
  if (history.length < 12) return [];

  const strategyMetaList = getStrategyMeta();
  const strategyNames = strategyMetaList.map(m => m.name);
  const maxMain = currentLotteryType === 'ssq' ? 33 : 35;
  const maxBack = currentLotteryType === 'ssq' ? 16 : 12;
  const mainPickCount = currentLotteryType === 'ssq' ? 6 : 5;
  const lookbackWindow = Math.min(60, Math.max(12, history.length - 1));
  const maxPeriods = Math.min(60, history.length - 12);
  const results = [];

  function pickFromPool(pool, count, fallbackMax) {
    const picked = [];
    for (const num of pool) {
      if (!picked.includes(num)) picked.push(num);
      if (picked.length === count) break;
    }
    for (let n = 1; picked.length < count && n <= fallbackMax; n++) {
      if (!picked.includes(n)) picked.push(n);
    }
    return picked.sort((a, b) => a - b);
  }

  for (let idx = maxPeriods; idx >= 1; idx--) {
    const target = history[idx - 1];
    const sample = history.slice(idx, idx + lookbackWindow);
    if (!target || sample.length < 12) continue;

    const mainFreq = Object.fromEntries(Array.from({ length: maxMain }, (_, i) => [i + 1, 0]));
    const backFreq = Object.fromEntries(Array.from({ length: maxBack }, (_, i) => [i + 1, 0]));
    const mainMiss = Object.fromEntries(Array.from({ length: maxMain }, (_, i) => [i + 1, sample.length]));

    sample.forEach((record, sIdx) => {
      const main = currentLotteryType === 'ssq' ? record.redNumbers : record.frontNumbers;
      const back = currentLotteryType === 'ssq' ? [record.blueNumber] : record.backNumbers;
      main.forEach(n => {
        mainFreq[n] += 1;
        if (mainMiss[n] === sample.length) mainMiss[n] = sIdx;
      });
      back.forEach(n => { backFreq[n] += 1; });
    });

    const hotMain = Object.entries(mainFreq).sort((a, b) => b[1] - a[1]).map(([n]) => Number(n));
    const coldMain = Object.entries(mainMiss).sort((a, b) => b[1] - a[1]).map(([n]) => Number(n));
    const balancedMain = [...hotMain.slice(0, Math.ceil(mainPickCount / 2)), ...coldMain.slice(0, Math.floor(mainPickCount / 2))];
    const oddMain = Array.from({ length: maxMain }, (_, i) => i + 1).filter(n => n % 2 === 1);
    const evenMain = Array.from({ length: maxMain }, (_, i) => i + 1).filter(n => n % 2 === 0);
    const zoneLow = Array.from({ length: Math.ceil(maxMain / 3) }, (_, i) => i + 1);
    const zoneMid = Array.from({ length: Math.ceil(maxMain / 3) }, (_, i) => i + 1 + Math.ceil(maxMain / 3)).filter(n => n <= maxMain);
    const zoneHigh = Array.from({ length: maxMain }, (_, i) => i + 1).filter(n => n > Math.ceil(maxMain / 3) * 2);
    const mysticalMain = [...oddMain.slice(0, Math.ceil(mainPickCount / 2)), ...evenMain.slice(-Math.floor(mainPickCount / 2))];
    const trendMain = Array.from(new Set([...hotMain.slice(0, Math.max(2, Math.ceil(mainPickCount / 2))), ...hotMain.slice(6, 12), ...coldMain.slice(0, 2)]));
    const zoneMain = Array.from(new Set([
      ...zoneLow.filter(n => hotMain.includes(n)).slice(0, Math.max(1, Math.floor(mainPickCount / 3))),
      ...zoneMid.filter(n => hotMain.includes(n)).slice(0, Math.max(1, Math.floor(mainPickCount / 3))),
      ...zoneHigh.filter(n => hotMain.includes(n)).slice(0, Math.max(1, mainPickCount - Math.floor(mainPickCount / 3) * 2)),
      ...coldMain.slice(0, 2)
    ]));
    const patternMain = Array.from(new Set([
      ...coldMain.slice(0, Math.max(2, Math.ceil(mainPickCount / 2))),
      ...hotMain.slice(2, 6),
      ...zoneMid.slice(0, 2)
    ]));
    const hotBack = Object.entries(backFreq).sort((a, b) => b[1] - a[1]).map(([n]) => Number(n));
    const coldBack = Object.entries(backFreq).sort((a, b) => a[1] - b[1]).map(([n]) => Number(n));
    const balancedBack = Array.from(new Set([...hotBack.slice(0, 1), ...coldBack.slice(0, Math.max(1, currentLotteryType === 'ssq' ? 1 : 2))]));

    const candidates = [
      {
        strategy: strategyNames[0],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool([...balancedMain, ...hotMain], 6, maxMain), blueBall: pickFromPool(hotBack, 1, maxBack)[0] }
          : { frontBalls: pickFromPool([...balancedMain, ...hotMain], 5, maxMain), backBalls: pickFromPool(hotBack, 2, maxBack) },
        reason: '融合热号、冷号与均衡结构，模拟 ML 综合推荐口径'
      },
      {
        strategy: strategyNames[1],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(mysticalMain, 6, maxMain), blueBall: pickFromPool(coldBack.slice().reverse(), 1, maxBack)[0] }
          : { frontBalls: pickFromPool(mysticalMain, 5, maxMain), backBalls: pickFromPool(coldBack.slice().reverse(), 2, maxBack) },
        reason: '模拟玄学规律与尾数/奇偶偏好的风格样本'
      },
      {
        strategy: strategyNames[2],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(hotMain, 6, maxMain), blueBall: pickFromPool(hotBack, 1, maxBack)[0] }
          : { frontBalls: pickFromPool(hotMain, 5, maxMain), backBalls: pickFromPool(hotBack, 2, maxBack) },
        reason: '近期高频号码优先，体现热号追踪'
      },
      {
        strategy: strategyNames[3],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(coldMain, 6, maxMain), blueBall: pickFromPool(coldBack, 1, maxBack)[0] }
          : { frontBalls: pickFromPool(coldMain, 5, maxMain), backBalls: pickFromPool(coldBack, 2, maxBack) },
        reason: '遗漏较长号码优先，体现冷号回补'
      },
      {
        strategy: strategyNames[4],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(balancedMain, 6, maxMain), blueBall: pickFromPool(balancedBack, 1, maxBack)[0] }
          : { frontBalls: pickFromPool(balancedMain, 5, maxMain), backBalls: pickFromPool(balancedBack, 2, maxBack) },
        reason: '控制冷热、奇偶和分区，体现均衡策略'
      },
      {
        strategy: strategyNames[5],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(trendMain, 6, maxMain), blueBall: pickFromPool([...hotBack.slice(0, 1), ...coldBack.slice(0, 1)], 1, maxBack)[0] }
          : { frontBalls: pickFromPool(trendMain, 5, maxMain), backBalls: pickFromPool([...hotBack.slice(0, 1), ...coldBack.slice(0, 2)], 2, maxBack) },
        reason: '短中期频率混合，体现趋势动量'
      },
      {
        strategy: strategyNames[6],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(zoneMain, 6, maxMain), blueBall: pickFromPool(balancedBack, 1, maxBack)[0] }
          : { frontBalls: pickFromPool(zoneMain, 5, maxMain), backBalls: pickFromPool(balancedBack, 2, maxBack) },
        reason: '按区间覆盖组织号码，体现区间分布策略'
      },
      {
        strategy: strategyNames[7],
        set: currentLotteryType === 'ssq'
          ? { redBalls: pickFromPool(patternMain, 6, maxMain), blueBall: pickFromPool([...coldBack, ...hotBack], 1, maxBack)[0] }
          : { frontBalls: pickFromPool(patternMain, 5, maxMain), backBalls: pickFromPool([...coldBack, ...hotBack], 2, maxBack) },
        reason: '融合冷号回补、中段承接与节奏反转，体现形态反转策略'
      }
    ];

    const evaluated = candidates.map(item => {
      if (currentLotteryType === 'ssq') {
        const redHit = item.set.redBalls.filter(n => target.redNumbers.includes(n)).length;
        const blueHit = item.set.blueBall === target.blueNumber ? 1 : 0;
        return { ...item, period: target.period, date: target.date, result: { redHit, blueHit, totalHit: redHit + blueHit } };
      }
      const frontHit = item.set.frontBalls.filter(n => target.frontNumbers.includes(n)).length;
      const backHit = item.set.backBalls.filter(n => target.backNumbers.includes(n)).length;
      return { ...item, period: target.period, date: target.date, result: { frontHit, backHit, totalHit: frontHit + backHit } };
    }).sort((a, b) => (b.result.totalHit || 0) - (a.result.totalHit || 0));

    results.push({ period: target.period, date: target.date, target, strategies: evaluated, best: evaluated[0] });
  }

  return results.sort((a, b) => b.period.localeCompare(a.period));
}

function getThemeColors() {
  const styles = getComputedStyle(document.body);
  return {
    text: styles.getPropertyValue('--text').trim() || '#0f172a',
    textSoft: styles.getPropertyValue('--text-soft').trim() || '#475569',
    textMuted: styles.getPropertyValue('--text-muted').trim() || '#94a3b8',
    border: styles.getPropertyValue('--border').trim() || '#e2e8f0',
    red: '#ef4444',
    blue: '#3b82f6',
    gold: '#f59e0b',
    emerald: '#10b981',
    violet: '#8b5cf6'
  };
}

function drawLineChart(canvasId, labels, values, activeIndex = -1) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 720;
  const height = 280;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const colors = getThemeColors();
  const padding = { top: 22, right: 20, bottom: 42, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...values, 1);

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (innerH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = colors.textMuted;
  ctx.font = '12px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round(max - (max / 4) * i);
    const y = padding.top + (innerH / 4) * i + 4;
    ctx.fillText(String(value), padding.left - 8, y);
  }

  if (!values.length) return null;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : innerW / 2;
  const points = values.map((value, index) => ({
    x: padding.left + (values.length > 1 ? stepX * index : innerW / 2),
    y: padding.top + innerH - (value / max) * innerH,
    value,
    label: labels[index]
  }));

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + innerH);
  gradient.addColorStop(0, 'rgba(59,130,246,.28)');
  gradient.addColorStop(1, 'rgba(59,130,246,.02)');

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points[points.length - 1].x, padding.top + innerH);
  ctx.lineTo(points[0].x, padding.top + innerH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = colors.blue;
  ctx.lineWidth = 3;
  ctx.stroke();

  points.forEach((point, index) => {
    const isActive = index === activeIndex;
    ctx.beginPath();
    ctx.arc(point.x, point.y, isActive ? 7 : 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, isActive ? 4.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = colors.blue;
    ctx.fill();
  });

  if (activeIndex >= 0 && points[activeIndex]) {
    const point = points[activeIndex];
    ctx.strokeStyle = 'rgba(59,130,246,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, padding.top);
    ctx.lineTo(point.x, padding.top + innerH);
    ctx.stroke();

    const tooltipW = 112;
    const tooltipH = 48;
    const tooltipX = Math.min(Math.max(point.x - tooltipW / 2, 8), width - tooltipW - 8);
    const tooltipY = Math.max(point.y - tooltipH - 12, 8);
    ctx.fillStyle = currentTheme === 'dark' ? 'rgba(15,23,42,.92)' : 'rgba(255,255,255,.96)';
    ctx.strokeStyle = colors.border;
    ctx.beginPath();
    ctx.roundRect(tooltipX, tooltipY, tooltipW, tooltipH, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    ctx.font = '700 12px Microsoft YaHei, sans-serif';
    ctx.fillText(`第 ${point.label} 期`, tooltipX + 10, tooltipY + 18);
    ctx.fillStyle = colors.textSoft;
    ctx.font = '12px Microsoft YaHei, sans-serif';
    ctx.fillText(`总命中 ${point.value}`, tooltipX + 10, tooltipY + 35);
  }

  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    const point = points[index];
    ctx.fillText(String(label).slice(-4), point.x, height - 14);
  });

  return { points, width, height };
}

function drawMultiLineChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 720;
  const height = 320;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const colors = getThemeColors();
  const palette = ['#ef4444', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#14b8a6', '#f97316'];
  const padding = { top: 24, right: 18, bottom: 44, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...datasets.flatMap(item => item.values));

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (innerH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = colors.textMuted;
  ctx.font = '12px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round(max - (max / 4) * i);
    const y = padding.top + (innerH / 4) * i + 4;
    ctx.fillText(String(value), padding.left - 8, y);
  }

  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : innerW / 2;
  datasets.forEach((dataset, datasetIndex) => {
    const stroke = palette[datasetIndex % palette.length];
    const points = dataset.values.map((value, index) => ({
      x: padding.left + (labels.length > 1 ? stepX * index : innerW / 2),
      y: padding.top + innerH - (value / max) * innerH
    }));
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.fill();
    });
  });

  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    const x = padding.left + (labels.length > 1 ? stepX * index : innerW / 2);
    ctx.fillText(String(label).slice(-4), x, height - 14);
  });
}

function drawBarChart(canvasId, labels, values, palette = ['#ef4444', '#3b82f6', '#8b5cf6']) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 720;
  const height = 260;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const colors = getThemeColors();
  const padding = { top: 20, right: 16, bottom: 42, left: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(...values, 1);
  const barWidth = innerW / Math.max(values.length * 1.5, 1);
  const gap = barWidth * 0.5;

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + innerH);
  ctx.lineTo(width - padding.right, padding.top + innerH);
  ctx.stroke();

  ctx.fillStyle = colors.textMuted;
  ctx.font = '12px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';

  values.forEach((value, index) => {
    const x = padding.left + index * (barWidth + gap) + gap / 2;
    const barH = (value / max) * innerH;
    const y = padding.top + innerH - barH;
    ctx.fillStyle = palette[index % palette.length];
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, Math.max(barH, 4), 10);
    ctx.fill();
    ctx.fillStyle = colors.textSoft;
    ctx.fillText(String(value), x + barWidth / 2, y - 8);
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(String(labels[index]), x + barWidth / 2, height - 14);
  });
}

function queueHistoryCharts(backtests) {
  requestAnimationFrame(() => {
    const recent = backtests.slice(0, currentHistoryTrendRange).reverse();
    const strategyNames = recent[0]?.strategies?.map(item => item.strategy) || [];
    const leaderCounts = {};
    const strategyAverages = {};
    strategyNames.forEach(name => {
      leaderCounts[name] = 0;
      strategyAverages[name] = [];
    });

    recent.forEach(periodItem => {
      const sorted = [...periodItem.strategies].sort((a, b) => (b.result.totalHit || 0) - (a.result.totalHit || 0));
      if (sorted[0]) leaderCounts[sorted[0].strategy] = (leaderCounts[sorted[0].strategy] || 0) + 1;
      sorted.forEach(item => {
        if (!strategyAverages[item.strategy]) strategyAverages[item.strategy] = [];
        strategyAverages[item.strategy].push(item.result.totalHit || 0);
      });
    });

    const leaderList = Object.entries(leaderCounts).sort((a, b) => b[1] - a[1]).slice(0, 7);
    drawBarChart('historyLeaderCanvas', leaderList.map(([name]) => name.replace(/策略|推荐/g, '').slice(0, 4) || '策略'), leaderList.map(([, count]) => count), ['#ef4444', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#14b8a6', '#f97316']);

    const avgList = Object.entries(strategyAverages)
      .map(([name, values]) => ({ name, avg: values.length ? Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)) : 0 }))
      .sort((a, b) => b.avg - a.avg);
    drawBarChart('historyStructureCanvas', avgList.map(item => item.name.replace(/策略|推荐/g, '').slice(0, 4) || '策略'), avgList.map(item => item.avg), ['#ef4444', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#14b8a6', '#f97316']);
  });
}

function renderHistoryDashboard(state) {
  const trendContainer = document.getElementById('historyTrendContainer');
  const performanceContainer = document.getElementById('historyPerformanceContainer');
  const reviewContainer = document.getElementById('historyReviewContainer');
  if (!trendContainer || !reviewContainer || !performanceContainer) return;

  const backtests = buildStrategyBacktest(state);
  const strategyPool = backtests.flatMap(item => item.strategies || []);
  const best = strategyPool.length ? Math.max(...strategyPool.map(x => x.result.totalHit || 0)) : null;
  const avg = strategyPool.length ? (strategyPool.reduce((a, b) => a + (b.result.totalHit || 0), 0) / strategyPool.length).toFixed(1) : '--';
  const lastPeriod = state.historyData?.[0]?.period || '--';
  const strategySummaryMap = {};
  strategyPool.forEach(item => {
    const key = item.strategy || '未知策略';
    if (!strategySummaryMap[key]) strategySummaryMap[key] = { count: 0, total: 0, best: 0 };
    strategySummaryMap[key].count += 1;
    strategySummaryMap[key].total += item.result.totalHit || 0;
    strategySummaryMap[key].best = Math.max(strategySummaryMap[key].best, item.result.totalHit || 0);
  });
  const strategyLeaders = Object.entries(strategySummaryMap)
    .map(([name, info]) => ({ name, ...info, avg: (info.total / info.count).toFixed(1) }))
    .sort((a, b) => b.best - a.best || b.avg - a.avg);
  const topLeader = strategyLeaders[0];
  const stableLeader = [...strategyLeaders].sort((a, b) => b.avg - a.avg || b.best - a.best)[0];

  if (backtests.length === 0) {
    performanceContainer.style.display = '';
    trendContainer.innerHTML = `<div class="history-block-head"><div><div class="analysis-badge">Strategy Trend</div><h4>预测策略命中趋势</h4></div><div class="trend-summary">最近开奖期：${lastPeriod}</div></div><div class="reason-grid"><div class="reason-chip">当前已有 ${state.historyData.length} 条历史开奖数据</div><div class="reason-chip">需要至少 12 期样本生成多策略回测</div><div class="reason-chip">样本足够后将自动绘制 6~7 条策略走势</div></div>`;
    performanceContainer.innerHTML = `<div class="history-block-head"><div><div class="analysis-badge">Backtest Summary</div><h4>历史回溯摘要</h4></div><div class="trend-summary">等待回测</div></div><div class="history-performance-stack"><div class="performance-stat-card"><div class="performance-stat-label">当前状态</div><div class="performance-stat-value">待生成</div><div class="performance-stat-note">历史页将按最新预测中的 6~7 个固定策略分别回测，而不是只展示单一综合结果。</div></div></div>`;
    reviewContainer.innerHTML = '<div class="empty-state"><div class="empty-icon">🧾</div><p>暂无多策略回测记录</p></div>';
    return;
  }

  performanceContainer.style.display = '';
  const recent = backtests.slice(0, backtests.length).reverse();
  const allTrendDatasets = (recent[0]?.strategies || []).map(strategy => ({
    name: strategy.strategy,
    values: recent.map(periodItem => (periodItem.strategies.find(item => item.strategy === strategy.strategy)?.result.totalHit || 0))
  }));
  let trendDatasets = currentHistoryStrategyFilter === 'all'
    ? allTrendDatasets
    : allTrendDatasets.filter(item => item.name === currentHistoryStrategyFilter);
  if (!trendDatasets.length) {
    currentHistoryStrategyFilter = 'all';
    trendDatasets = allTrendDatasets;
  }
  const filterOptions = ['all', ...allTrendDatasets.map(item => item.name)];
  const activePeak = trendDatasets.length
    ? Math.max(...trendDatasets.flatMap(item => item.values))
    : (best ?? '--');

  trendContainer.innerHTML = `
    <div class="history-block-head"><div><div class="analysis-badge">Strategy Trend</div><h4>预测策略长样本走势</h4></div><div class="trend-summary">${backtests.length} 期</div></div>
    <div class="chart-shell chart-shell-mainwide">
      <div class="chart-shell-head chart-shell-head-stack">
        <div><div class="chart-shell-title">历史命中走势主图</div></div>
        <div class="chart-shell-tools">
          <div class="chart-filter-row">${filterOptions.map((name, index) => {
            const label = name === 'all' ? '全部策略' : name;
            const active = name === currentHistoryStrategyFilter;
            return `<button type="button" class="chart-filter-chip ${active ? 'active' : ''}" onclick="setHistoryStrategyFilter(${index === 0 ? `'all'` : `'${name}'`})">${label}</button>`;
          }).join('')}</div>
          <div class="chart-shell-badge">${activePeak} 命中峰值</div>
        </div>
      </div>
      <canvas id="historyTrendCanvas"></canvas>
      <div class="chart-legend-row">${trendDatasets.map((item, index) => `<span class="chart-legend-pill"><span class="chart-dot chart-dot-${index + 1}"></span>${item.name}</span>`).join('')}</div>
    </div>`;

  performanceContainer.innerHTML = `
    <div class="history-block-head"><div><div class="analysis-badge">Backtest Summary</div><h4>历史回溯摘要</h4></div><div class="trend-summary">${backtests.length} 期</div></div>
    <div class="history-performance-strip history-performance-strip-summary">
      <div class="performance-stat-card compact metric"><div class="performance-stat-label">回测期数</div><div class="performance-stat-value">${backtests.length}</div><div class="performance-stat-note">拉长样本</div></div>
      <div class="performance-stat-card compact metric"><div class="performance-stat-label">策略数量</div><div class="performance-stat-value">${backtests[0]?.strategies?.length || 0}</div><div class="performance-stat-note">固定并列</div></div>
      <div class="performance-stat-card compact metric"><div class="performance-stat-label">最佳命中</div><div class="performance-stat-value">${best ?? '--'}</div><div class="performance-stat-note">${topLeader?.name || '--'}</div></div>
      <div class="performance-stat-card compact metric"><div class="performance-stat-label">平均命中</div><div class="performance-stat-value">${avg}</div><div class="performance-stat-note">${stableLeader?.name || '--'}</div></div>
      <div class="performance-stat-card compact wide"><div class="performance-stat-label">领先策略</div><div class="performance-stat-value">${topLeader?.name || '暂无'}</div><div class="performance-stat-note">${strategyLeaders.length ? strategyLeaders.slice(0, 3).map(item => `${item.name}：最佳 ${item.best} / 平均 ${item.avg}`).join(' · ') : '暂无策略排名数据'}</div></div>
      <div class="performance-stat-card compact wide"><div class="performance-stat-label">最稳策略</div><div class="performance-stat-value">${stableLeader?.name || '暂无'}</div><div class="performance-stat-note">按平均命中优先排序</div></div>
    </div>`;

  reviewContainer.innerHTML = `
    <div class="history-block-head"><div><div class="analysis-badge">Strategy Replay</div><h4>各期策略回放</h4></div><div class="trend-summary">${Math.min(60, backtests.length)} 期</div></div>
    <div class="history-accordion-list history-accordion-list-wide">${backtests.slice(0, 60).map((periodItem, index) => {
      const bestItem = periodItem.best;
      const officialBalls = currentLotteryType === 'ssq'
        ? `${(periodItem.target?.redNumbers || []).map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span><span class="ball-sm blue">${String(periodItem.target?.blueNumber || 0).padStart(2, '0')}</span>`
        : `${(periodItem.target?.frontNumbers || []).map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span>${(periodItem.target?.backNumbers || []).map(n => `<span class="ball-sm blue">${String(n).padStart(2, '0')}</span>`).join('')}`;
      return `<div class="history-accordion-card ${index === 0 ? 'expanded' : ''} ${bestItem?.result?.totalHit >= (currentLotteryType === 'ssq' ? 4 : 3) ? 'hit-tier-high' : bestItem?.result?.totalHit >= 2 ? 'hit-tier-mid' : ''}" data-period="${periodItem.period}"><button class="history-accordion-trigger compact" type="button" onclick="toggleHistoryReplay('${periodItem.period}')"><div class="history-accordion-summary"><div class="history-accordion-main"><div class="history-accordion-period">第 ${periodItem.period} 期</div><div class="history-accordion-date">${periodItem.date || '--'}</div></div><div class="history-accordion-balls">${officialBalls}</div></div><div class="history-accordion-meta"><span class="review-status done compact">最佳：${bestItem?.strategy || '--'}</span><span class="history-accordion-arrow">⌄</span></div></button><div class="history-accordion-panel"><div class="period-strategy-list period-strategy-table">${periodItem.strategies.map(item => {
        const totalHit = item.result.totalHit || 0;
        const resultText = currentLotteryType === 'ssq'
          ? `红${item.result.redHit}/6 · 蓝${item.result.blueHit ? '中' : '未中'} · 总命中 ${totalHit}`
          : `前${item.result.frontHit}/5 · 后${item.result.backHit}/2 · 总命中 ${totalHit}`;
        return `<div class="period-strategy-item compact"><div class="period-strategy-left"><div class="history-set-label">${item.strategy}</div><div class="review-ball-row strategy-inline-balls">${renderBacktestBalls(item.set)}</div></div><div class="period-strategy-right"><div class="history-set-result ${totalHit >= (currentLotteryType === 'ssq' ? 4 : 3) ? 'strong' : ''}">${totalHit} 命中</div><div class="history-set-balls">${resultText}</div></div></div>`;
      }).join('')}</div></div></div>`;
    }).join('')}</div>`;

  requestAnimationFrame(() => drawMultiLineChart('historyTrendCanvas', recent.map(item => item.period), trendDatasets));
}

function renderHistory(data) {
  const container = document.getElementById('historyList');
  const displayData = data;
  if (displayData.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无历史记录</p></div>';
    return;
  }
  const latest = displayData[0];
  const oldest = displayData[displayData.length - 1];
  const bodyHtml = `<div class="history-list-grid">${displayData.map(record => {
    const ballsHtml = currentLotteryType === 'ssq'
      ? `${record.redNumbers.map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span><span class="ball-sm blue">${String(record.blueNumber).padStart(2, '0')}</span>`
      : `${record.frontNumbers.map(n => `<span class="ball-sm red">${String(n).padStart(2, '0')}</span>`).join('')}<span class="sep">+</span>${record.backNumbers.map(n => `<span class="ball-sm blue">${String(n).padStart(2, '0')}</span>`).join('')}`;
    return `<div class="history-card pro"><div class="history-card-head"><span class="history-period">第 ${record.period} 期</span><span class="history-date">${record.date}</span></div><div class="history-card-balls">${ballsHtml}</div></div>`;
  }).join('')}</div>`;
  container.innerHTML = `<div class="history-table-head"><div><div class="analysis-badge">Draw Archive</div><h4>历史开奖号码一览</h4></div><div class="trend-summary">共 ${displayData.length} 条</div></div><div class="reason-grid"><div class="reason-chip">最新期号：${latest?.period || '--'}</div><div class="reason-chip">最早展示：${oldest?.period || '--'}</div><div class="reason-chip">日期范围：${oldest?.date || '--'} ~ ${latest?.date || '--'}</div></div>${bodyHtml}`;
}

function filterHistory() { renderHistory(getState().historyData); }
function showLoading(show) { const overlay = document.getElementById('loadingOverlay'); const btn = document.getElementById('refreshBtn'); overlay.classList.toggle('active', !!show); if (btn) btn.disabled = !!show; }
function showToast(message) { const old = document.querySelector('.toast'); if (old) old.remove(); const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; document.body.appendChild(toast); requestAnimationFrame(() => toast.classList.add('show')); setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500); }
function getZoneLabel(i) { return currentLotteryType === 'ssq' ? ['一区 01-11', '二区 12-22', '三区 23-33'][i] : ['一区 01-12', '二区 13-24', '三区 25-35'][i]; }

function getBuiltInData(type) {
  if (type === 'ssq') return [
    { period: '26039', date: '2026-04-09', redNumbers: [1, 15, 23, 25, 28, 30], blueNumber: 5 },
    { period: '26038', date: '2026-04-07', redNumbers: [13, 14, 18, 21, 25, 33], blueNumber: 4 },
    { period: '26037', date: '2026-04-05', redNumbers: [2, 12, 27, 29, 31, 3], blueNumber: 13 },
    { period: '26036', date: '2026-04-02', redNumbers: [6, 10, 12, 15, 22, 28], blueNumber: 8 },
    { period: '26035', date: '2026-03-31', redNumbers: [2, 6, 12, 24, 25, 32], blueNumber: 2 },
    { period: '26034', date: '2026-03-29', redNumbers: [1, 3, 7, 13, 22, 32], blueNumber: 7 },
    { period: '26033', date: '2026-03-26', redNumbers: [3, 6, 13, 21, 28, 29], blueNumber: 6 },
    { period: '26032', date: '2026-03-24', redNumbers: [1, 3, 11, 18, 31, 33], blueNumber: 2 },
    { period: '26031', date: '2026-03-22', redNumbers: [3, 10, 12, 18, 33, 8], blueNumber: 8 },
    { period: '26030', date: '2026-03-19', redNumbers: [10, 11, 14, 19, 22, 24], blueNumber: 4 }
  ];
  return [
    { period: '26037', date: '2026-04-08', frontNumbers: [7, 12, 13, 28, 32], backNumbers: [6, 8] },
    { period: '26036', date: '2026-04-06', frontNumbers: [4, 7, 16, 26, 32], backNumbers: [5, 8] },
    { period: '26035', date: '2026-04-04', frontNumbers: [2, 22, 30, 33, 34], backNumbers: [8, 12] },
    { period: '26034', date: '2026-04-01', frontNumbers: [11, 12, 25, 26, 27], backNumbers: [8, 11] },
    { period: '26033', date: '2026-03-30', frontNumbers: [3, 5, 7, 9, 18], backNumbers: [2, 10] },
    { period: '26032', date: '2026-03-28', frontNumbers: [3, 4, 19, 26, 32], backNumbers: [1, 12] },
    { period: '26031', date: '2026-03-25', frontNumbers: [6, 8, 22, 29, 34], backNumbers: [5, 7] },
    { period: '26030', date: '2026-03-23', frontNumbers: [2, 13, 22, 28, 34], backNumbers: [5, 12] },
    { period: '26029', date: '2026-03-21', frontNumbers: [3, 5, 17, 33, 35], backNumbers: [5, 7] },
    { period: '26028', date: '2026-03-18', frontNumbers: [15, 27, 29, 30, 34], backNumbers: [1, 10] }
  ];
}
