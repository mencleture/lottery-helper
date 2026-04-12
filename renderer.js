// ========== 状态管理（全局） ==========
// 注意：所有状态按彩种分开存储
let currentLotteryType = 'ssq';
let isLoading = false;

// 状态池：每种彩种独立的状态
const statePool = {
  ssq: {
    historyData: [],
    currentPeriod: null,          // 当前推荐的期号
    allSets: [],                  // 5组备选推荐
    activeSetIndex: 0,            // 当前选中哪一组
    confirmedRecommendation: null,// 已确认的推荐 { period, setIndex, set }
    recommendationHistory: [],    // 往期推荐历史
  },
  dlt: {
    historyData: [],
    currentPeriod: null,
    allSets: [],
    activeSetIndex: 0,
    confirmedRecommendation: null,
    recommendationHistory: [],
  }
};

// ========== 持久化（localStorage） ==========
function saveState() {
  try {
    localStorage.setItem('lottery_statePool', JSON.stringify(statePool));
    localStorage.setItem('lottery_currentType', currentLotteryType);
  } catch (e) {
    console.warn('保存状态失败:', e);
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem('lottery_statePool');
    const savedType = localStorage.getItem('lottery_currentType');
    if (saved) {
      const parsed = JSON.parse(saved);
      // 恢复各彩种状态（保留默认结构，只覆盖有数据的字段）
      ['ssq', 'dlt'].forEach(type => {
        if (parsed[type]) {
          Object.assign(statePool[type], parsed[type]);
        }
      });
    }
    if (savedType && ['ssq', 'dlt'].includes(savedType)) {
      currentLotteryType = savedType;
    }
  } catch (e) {
    console.warn('加载状态失败:', e);
  }
}

// ========== 状态读写辅助 ==========
function getState() {
  return statePool[currentLotteryType];
}

// ========== 计算下一期（还没开奖的那个） ==========
// 期号格式：5位，如 26039 = 2026年第039期
// 双色球开奖日：周二、周四、周日
// 大乐透开奖日：周一、周三、周六
function getNextPeriod(latestPeriod, type, latestDate) {
  const p = latestPeriod.toString();
  // 前2位是年份后2位，后3位是序号
  const yearShort = parseInt(p.slice(0, 2));   // 26 → 2026
  const seq = parseInt(p.slice(2));             // 039
  const fullYear = 2000 + yearShort;

  // 计算下一期的序号（跨年处理）
  const nextSeq = seq + 1;
  let nextPeriod;
  if (nextSeq > 999) {
    nextPeriod = String(yearShort + 1).padStart(2, '0') + '001';
  } else {
    nextPeriod = String(yearShort).padStart(2, '0') + String(nextSeq).padStart(3, '0');
  }

  // 判断今天是否已经是下一期的开奖日（或已过），如果是则再+1
  const now = new Date();
  const todayDow = now.getDay(); // 0=周日,1=周一,...,6=周六

  // 双色球：周二(2)、周四(4)、周日(0)
  // 大乐透：周一(1)、周三(3)、周六(6)
  const drawDays = type === 'ssq' ? [0, 2, 4] : [1, 3, 6];

  // 最新已开奖期的开奖日（从日期字符串解析）
  let latestDrawDow = -1;
  if (latestDate) {
    const d = new Date(latestDate);
    if (!isNaN(d)) latestDrawDow = d.getDay();
  }

  // 找到下一个开奖日（从今天往后数，包含今天）
  // 如果今天就是开奖日，且今天 > 最新已开奖日期，说明今天这期还没出结果
  // 如果今天已过了下一个开奖日，说明下一期也已开奖，需要再+1
  const todayStr = now.toISOString().slice(0, 10);
  const latestDateStr = latestDate || '';

  // 简单判断：如果今天是开奖日 且 今天 > 最新开奖日期 → 今天这期还没开，推荐就是 nextPeriod
  // 如果今天不是开奖日，或今天 <= 最新开奖日期 → 推荐就是 nextPeriod（下一个未开的）
  // 如果今天是开奖日 且 今天 == 最新开奖日期 → 今天已开，推荐是 nextPeriod+1
  if (latestDateStr && todayStr === latestDateStr) {
    // 今天已经开奖了，推荐下下期
    const seq2 = parseInt(nextPeriod.slice(2)) + 1;
    const ys2 = parseInt(nextPeriod.slice(0, 2));
    if (seq2 > 999) {
      return String(ys2 + 1).padStart(2, '0') + '001';
    }
    return String(ys2).padStart(2, '0') + String(seq2).padStart(3, '0');
  }

  return nextPeriod;
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  // 从 localStorage 恢复状态
  loadState();
  // 恢复彩种按钮高亮
  document.querySelectorAll('.lottery-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === currentLotteryType);
  });
  // 初始显示当前彩种已有数据（如果有）
  renderAll();
  // 自动获取一次最新记录
  refreshData();
});

// ========== 切换彩种 ==========
function selectLottery(type) {
  if (isLoading) return;
  
  currentLotteryType = type;
  
  document.querySelectorAll('.lottery-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  
  // 不清空！只重新渲染现有状态
  renderAll();
}

// ========== 主刷新流程 ==========
async function refreshData() {
  if (isLoading) return;
  isLoading = true;
  showLoading(true);
  
  const state = getState();
  
  try {
    // 抓取更多历史：从500.com抓120期
    const newData = await fetchFrom500Com(currentLotteryType, 120);
    
    if (newData && newData.length > 0) {
      // 增量合并：只追加不重复的新期号
      const existingPeriods = new Set(state.historyData.map(item => item.period));
      let added = 0;
      newData.forEach(item => {
        if (!existingPeriods.has(item.period)) {
          state.historyData.push(item);
          added++;
        }
      });
      state.historyData.sort((a, b) => b.period.localeCompare(a.period));
      state.historyData = state.historyData.slice(0, 200); // 最多保留200期
      document.getElementById('dataSource').textContent = `🌐 500彩票网实时数据（+${added}条）`;
    } else {
      if (state.historyData.length === 0) {
        state.historyData = getBuiltInData(currentLotteryType);
      }
      document.getElementById('dataSource').textContent = '📦 内置历史数据';
    }
    
    document.getElementById('updateTime').textContent = new Date().toLocaleTimeString('zh-CN');
    document.getElementById('recordCount').textContent = `${state.historyData.length} 条`;
    
    renderHistory(state.historyData);
    
    // ===== 处理推荐状态 =====
    const latestRecord = state.historyData[0];
    
    if (state.currentPeriod === null) {
      // 首次生成推荐（绑定下一期）
      await generateNewRecommendation();
    } else {
      // 已有推荐，检查最新一期是否已超过推荐期
      if (latestRecord && latestRecord.period.localeCompare(state.currentPeriod) > 0) {
        // 推荐期已被开奖超越：先显示结果，再提示生成新一期
        checkResults(state);
        renderExpiredPrompt(state, latestRecord);
      } else {
        // 推荐期 == 最新期（还没开），正常显示
        renderRecommendationPanel(state);
      }
    }
    
    renderHistoryRecPanel(state);
    
  } catch (error) {
    console.error('获取数据失败:', error);
    if (state.historyData.length === 0) {
      state.historyData = getBuiltInData(currentLotteryType);
      renderHistory(state.historyData);
    }
    checkResults(state);
    renderRecommendationPanel(state);
  } finally {
    isLoading = false;
    showLoading(false);
    saveState();
  }
}

// ========== 抓取500彩票网数据 ==========
async function fetchFrom500Com(type, count = 120) {
  const baseUrl = type === 'ssq'
    ? 'https://datachart.500.com/ssq/history/newinc/history.php'
    : 'https://datachart.500.com/dlt/history/newinc/history.php';
  
  try {
    // 请求更多期数（用end参数控制）
    const response = await fetch(`${baseUrl}?start=25001&end=26100`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const tbody = doc.getElementById('tdata');
    if (!tbody) return null;
    
    const rows = tbody.querySelectorAll('tr');
    const records = [];
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return;
      
      const period = cells[0].textContent.trim();
      if (!period || !/^\d{5,}$/.test(period)) return;
      
      if (type === 'ssq') {
        const redNumbers = [];
        for (let i = 1; i <= 6; i++) {
          const num = parseInt(cells[i]?.textContent?.trim() || '0');
          if (num >= 1 && num <= 33) redNumbers.push(num);
        }
        const blueNumber = parseInt(cells[7]?.textContent?.trim() || '0');
        const dateStr = cells[cells.length - 1]?.textContent?.trim() || '';
        
        if (redNumbers.length === 6 && blueNumber >= 1 && blueNumber <= 16) {
          records.push({ period, date: dateStr, redNumbers, blueNumber });
        }
      } else {
        const frontNumbers = [];
        for (let i = 1; i <= 5; i++) {
          const num = parseInt(cells[i]?.textContent?.trim() || '0');
          if (num >= 1 && num <= 35) frontNumbers.push(num);
        }
        const backNumbers = [];
        for (let i = 6; i <= 7; i++) {
          const num = parseInt(cells[i]?.textContent?.trim() || '0');
          if (num >= 1 && num <= 12) backNumbers.push(num);
        }
        const dateStr = cells[cells.length - 1]?.textContent?.trim() || '';
        
        if (frontNumbers.length === 5 && backNumbers.length === 2) {
          records.push({ period, date: dateStr, frontNumbers, backNumbers });
        }
      }
    });
    
    console.log(`[${type}] 抓取到 ${records.length} 条记录`);
    return records;
    
  } catch (error) {
    console.error(`[${type}] 抓取失败:`, error);
    return null;
  }
}

// ========== 生成新推荐（绑定下一期，未开奖的那个） ==========
async function generateNewRecommendation() {
  const state = getState();
  if (state.historyData.length === 0) return;
  
  try {
    const result = await window.electronAPI.getRecommendation(currentLotteryType, state.historyData);
    
    if (result.success && result.data) {
      // 推荐绑定"下一期"，即已开奖最新期的下一个（传入最新期日期用于判断今天是否已开）
      const latest = state.historyData[0];
      state.currentPeriod = getNextPeriod(latest.period, currentLotteryType, latest.date);
      state.allSets = result.data;
      state.activeSetIndex = 0;
      state.confirmedRecommendation = null; // 生成新推荐时清空确认
      renderRecommendationPanel(state);
      renderHistoryRecPanel(state);
      saveState();
    }
  } catch (error) {
    console.error('生成推荐失败:', error);
  }
}

// ========== 换一组：轮换5组备选（不换期号，不清空） ==========
function nextSet() {
  const state = getState();
  if (state.allSets.length === 0) return;
  
  state.activeSetIndex = (state.activeSetIndex + 1) % state.allSets.length;
  renderRecommendationPanel(state);
}

// ========== 确认使用 ==========
function confirmSet() {
  const state = getState();
  if (!state.currentPeriod || state.allSets.length === 0) return;
  
  const set = state.allSets[state.activeSetIndex];
  
  // 存入往期历史（避免重复）
  const exists = state.recommendationHistory.some(h => 
    h.period === state.currentPeriod && h.setIndex === state.activeSetIndex
  );
  if (!exists) {
    state.recommendationHistory.unshift({
      period: state.currentPeriod,
      setIndex: state.activeSetIndex,
      set: set,
      confirmed: true,
      result: null
    });
  }
  
  state.confirmedRecommendation = {
    period: state.currentPeriod,
    setIndex: state.activeSetIndex,
    set: set
  };
  
  renderRecommendationPanel(state);
  renderHistoryRecPanel(state);
  showToast(`✅ 已确认第 ${state.currentPeriod} 期第 ${state.activeSetIndex + 1} 组推荐！`);
  saveState();
}

// ========== 生成新一期推荐（主动升级） ==========
async function adoptNewRecommendation() {
  const state = getState();
  if (state.historyData.length === 0) return;
  
  // 当前推荐（即使未确认）存入往期
  if (state.currentPeriod && state.allSets.length > 0) {
    const exists = state.recommendationHistory.some(h => 
      h.period === state.currentPeriod && h.setIndex === state.activeSetIndex
    );
    if (!exists) {
      state.recommendationHistory.unshift({
        period: state.currentPeriod,
        setIndex: state.activeSetIndex,
        set: state.allSets[state.activeSetIndex],
        confirmed: false,
        result: null
      });
    }
  }
  
  await generateNewRecommendation();
}

// ========== 检查并填入中奖结果 ==========
function checkResults(state) {
  if (!state.confirmedRecommendation) return;
  
  const latestRecord = state.historyData.find(r => r.period === state.confirmedRecommendation.period);
  if (!latestRecord) return;
  
  const set = state.confirmedRecommendation.set;
  let result;
  
  if (currentLotteryType === 'ssq') {
    const redHit = set.redBalls.filter(n => latestRecord.redNumbers.includes(n)).length;
    const blueHit = set.blueBall === latestRecord.blueNumber ? 1 : 0;
    result = { redHit, blueHit };
  } else {
    const frontHit = set.frontBalls.filter(n => latestRecord.frontNumbers.includes(n)).length;
    const backHit = set.backBalls.filter(n => latestRecord.backNumbers.includes(n)).length;
    result = { frontHit, backHit };
  }
  
  state.confirmedRecommendation.result = result;
  
  // 更新历史记录中的结果
  const histItem = state.recommendationHistory.find(h =>
    h.period === state.confirmedRecommendation.period && h.confirmed
  );
  if (histItem) histItem.result = result;
  
  renderHistoryRecPanel(state);
}

// ========== 渲染全部（当前彩种） ==========
function renderAll() {
  const state = getState();
  
  document.getElementById('updateTime').textContent = state.historyData.length > 0
    ? (document.getElementById('updateTime').textContent || '--')
    : '--';
  document.getElementById('recordCount').textContent = `${state.historyData.length} 条`;
  
  renderHistory(state.historyData);
  renderRecommendationPanel(state);
  renderHistoryRecPanel(state);
}

// ========== 渲染推荐面板 ==========
function renderRecommendationPanel(state) {
  const container = document.getElementById('recommendationContainer');
  
  if (!state.currentPeriod || state.allSets.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">💡</span>
        <p>点击"获取最新记录"按钮<br>获取分析数据后显示推荐号码</p>
      </div>
    `;
    return;
  }
  
  const set = state.allSets[state.activeSetIndex];
  const isConfirmed = state.confirmedRecommendation &&
                      state.confirmedRecommendation.period === state.currentPeriod &&
                      state.confirmedRecommendation.setIndex === state.activeSetIndex;
  const latestRecord = state.historyData[0];
  // 推荐期已开奖 → 有result数据；推荐期还未开 → 无result
  const hasResult = !!(state.confirmedRecommendation?.result);
  const isLatestPeriod = latestRecord && state.currentPeriod === latestRecord.period;
  const resultInfo = state.confirmedRecommendation?.result;
  
  // 渲染球
  const renderBalls = (rec, showHit = false, record = null) => {
    if (currentLotteryType === 'ssq') {
      const redClass = (n) => {
        if (!showHit || !record) return 'ball red';
        return record.redNumbers.includes(n) ? 'ball red hit-ball' : 'ball red';
      };
      const blueClass = () => {
        if (!showHit || !record) return 'ball blue';
        return record.blueNumber === rec.blueBall ? 'ball blue hit-ball' : 'ball blue';
      };
      return `
        <div class="rec-balls-row">
          <span class="zone-label">红球</span>
          <div class="balls">${rec.redBalls.map(n => `<span class="${redClass(n)}">${String(n).padStart(2,'0')}</span>`).join('')}</div>
        </div>
        <div class="rec-balls-row">
          <span class="zone-label">蓝球</span>
          <div class="balls">${record ? `<span class="${blueClass()}">${String(rec.blueBall).padStart(2,'0')}</span>` : `<span class="ball blue">${String(rec.blueBall).padStart(2,'0')}</span>`}</div>
        </div>
      `;
    } else {
      const frontClass = (n) => {
        if (!showHit || !record) return 'ball red';
        return record.frontNumbers.includes(n) ? 'ball red hit-ball' : 'ball red';
      };
      const backClass = (n) => {
        if (!showHit || !record) return 'ball blue';
        return record.backNumbers.includes(n) ? 'ball blue hit-ball' : 'ball blue';
      };
      return `
        <div class="rec-balls-row">
          <span class="zone-label">前区</span>
          <div class="balls">${rec.frontBalls.map(n => `<span class="${frontClass(n)}">${String(n).padStart(2,'0')}</span>`).join('')}</div>
        </div>
        <div class="rec-balls-row">
          <span class="zone-label">后区</span>
          <div class="balls">${rec.backBalls.map(n => `<span class="${backClass(n)}">${String(n).padStart(2,'0')}</span>`).join('')}</div>
        </div>
      `;
    }
  };
  
  // 结果信息
  let resultHTML = '';
  if (resultInfo) {
    // 推荐期已开奖，显示结果
    if (currentLotteryType === 'ssq') {
      resultHTML = `
        <div class="result-bar result-hit">
          <div class="result-info">
            <span class="result-label">第 ${state.currentPeriod} 期已开奖</span>
            <span class="result-hits">红球命中 <b>${resultInfo.redHit}/6</b>${resultInfo.blueHit ? '，蓝球 <b class="c-green">✅</b>' : '，蓝球 <b class="c-red">❌</b>'}</span>
          </div>
        </div>
      `;
    } else {
      resultHTML = `
        <div class="result-bar result-hit">
          <div class="result-info">
            <span class="result-label">第 ${state.currentPeriod} 期已开奖</span>
            <span class="result-hits">前区 <b>${resultInfo.frontHit}/5</b>，后区 <b>${resultInfo.backHit}/2</b></span>
          </div>
        </div>
      `;
    }
  } else {
    // 推荐期还未开，显示待开奖
    resultHTML = `
      <div class="result-bar result-pending">
        <div class="result-info">
          <span class="result-label">⏳ 第 ${state.currentPeriod} 期待开奖</span>
          <span class="result-hint">开奖后自动显示结果</span>
        </div>
      </div>
    `;
  }
  
  // 原因列表
  const reasons = set.reason || [];
  const reasonHTML = reasons.length > 0 ? `
    <div class="rec-reasons">
      ${reasons.map(r => `<span class="reason-tag">${r}</span>`).join('')}
    </div>
  ` : '';
  
  // 组别选择器（5组卡片）
  const setsHTML = state.allSets.map((s, i) => {
    const isActive = i === state.activeSetIndex;
    const isConf = isConfirmed && i === state.activeSetIndex;
    
    if (currentLotteryType === 'ssq') {
      return `
        <div class="set-card ${isActive ? 'active' : ''}" onclick="jumpToSet(${i})">
          <div class="set-card-num">${i + 1}</div>
          <div class="set-card-balls">
            ${s.redBalls.map(n => `<span class="ball-sm red">${String(n).padStart(2,'0')}</span>`).join('')}
            <span class="ball-sm sep">+</span>
            <span class="ball-sm blue">${String(s.blueBall).padStart(2,'0')}</span>
          </div>
          ${isConf ? '<div class="set-confirmed">✅已确认</div>' : ''}
        </div>
      `;
    } else {
      return `
        <div class="set-card ${isActive ? 'active' : ''}" onclick="jumpToSet(${i})">
          <div class="set-card-num">${i + 1}</div>
          <div class="set-card-balls">
            ${s.frontBalls.map(n => `<span class="ball-sm red">${String(n).padStart(2,'0')}</span>`).join('')}
            <span class="ball-sm sep">+</span>
            ${s.backBalls.map(n => `<span class="ball-sm blue">${String(n).padStart(2,'0')}</span>`).join('')}
          </div>
          ${isConf ? '<div class="set-confirmed">✅已确认</div>' : ''}
        </div>
      `;
    }
  }).join('');
  
  // 选中组的详细理由
  const activeReasons = state.allSets[state.activeSetIndex]?.reason || [];
  const activeReasonHTML = activeReasons.length > 0 ? `
    <div class="rec-reasons-detail">
      ${activeReasons.map(r => `<div class="reason-item">💡 ${r}</div>`).join('')}
    </div>
  ` : '';
  
  // 底部按钮
  let confirmBtnHTML = '';
  if (isConfirmed) {
    confirmBtnHTML = `<div class="confirmed-badge">✅ 已确认为第 ${state.currentPeriod} 期推荐</div>`;
  } else {
    confirmBtnHTML = `
      <button class="btn-confirm" onclick="confirmSet()">
        ✅ 确认使用此推荐
      </button>
    `;
  }
  
  container.innerHTML = `
    <div class="rec-top">
      <div class="rec-period-badge">📌 第 ${state.currentPeriod} 期</div>
      <div class="rec-set-pager">
        <button class="btn-nav ${state.activeSetIndex === 0 ? 'disabled' : ''}" onclick="prevSet()">◀</button>
        <span class="pager-label">第 <b>${state.activeSetIndex + 1}</b> / ${state.allSets.length} 组</span>
        <button class="btn-nav ${state.activeSetIndex === state.allSets.length - 1 ? 'disabled' : ''}" onclick="nextSet()">▶</button>
      </div>
    </div>
    
    ${resultHTML}
    
    <div class="rec-ball-display">
      ${renderBalls(state.allSets[state.activeSetIndex], !!resultInfo, resultInfo ? latestRecord : null)}
    </div>
    
    ${activeReasonHTML}
    
    <div class="rec-set-selector">
      ${setsHTML}
    </div>
    
    <div class="rec-actions">
      <button class="btn-cycle" onclick="nextSet()">
        🔄 换一组
      </button>
      ${confirmBtnHTML}
    </div>
  `;
}

// ========== 跳转到指定组 ==========
function jumpToSet(index) {
  const state = getState();
  if (index >= 0 && index < state.allSets.length) {
    state.activeSetIndex = index;
    renderRecommendationPanel(state);
  }
}

// ========== 上一页组 ==========
function prevSet() {
  const state = getState();
  if (state.activeSetIndex > 0) {
    state.activeSetIndex--;
    renderRecommendationPanel(state);
  }
}

// ========== 渲染过期提示 ==========
function renderExpiredPrompt(state, latestRecord) {
  const container = document.getElementById('recommendationContainer');
  container.innerHTML = `
    <div class="expired-panel">
      <div class="expired-icon">⏰</div>
      <div class="expired-title">第 ${state.currentPeriod} 期已开奖</div>
      <div class="expired-desc">最新数据已更新至第 ${latestRecord.period} 期</div>
      <div class="expired-btns">
        <button class="btn-expired-secondary" onclick="renderRecommendationPanel(statePool['${currentLotteryType}'])">
          📊 查看第 ${state.currentPeriod} 期结果
        </button>
        <button class="btn-expired-primary" onclick="adoptNewRecommendation()">
          ➕ 生成第 ${latestRecord.period} 期推荐
        </button>
      </div>
    </div>
  `;
}

// ========== 渲染往期推荐（带原因） ==========
function renderHistoryRecPanel(state) {
  const container = document.getElementById('historyRecContent');
  
  if (state.recommendationHistory.length === 0) {
    container.innerHTML = `<div class="history-rec-empty">暂无往期推荐记录<br><span>确认推荐后将自动记录</span></div>`;
    return;
  }
  
  if (currentLotteryType === 'ssq') {
    container.innerHTML = state.recommendationHistory.map(item => {
      const result = item.result;
      let resultStr = '', resultCls = '';
      if (result) {
        const total = result.redHit + (result.blueHit ? 0.5 : 0);
        resultStr = `红${result.redHit}/6 ${result.blueHit ? '✅蓝' : '❌蓝'}`;
        resultCls = result.redHit >= 4 ? 'hit-great' : result.redHit >= 2 ? 'hit-ok' : 'hit-poor';
      } else {
        resultStr = '⏳ 待开奖';
        resultCls = 'hit-pending';
      }
      
      const reasons = item.set?.reason || [];
      const reasonText = reasons.length > 0 ? reasons.slice(0, 2).join('；') : '无策略说明';
      
      return `
        <div class="hri-item ${resultCls}">
          <div class="hri-top">
            <span class="hri-period">第 ${item.period} 期 · 第 ${item.setIndex + 1} 组</span>
            <span class="hri-conf-tag ${item.confirmed ? 'confirmed' : 'unconfirmed'}">${item.confirmed ? '✅已确认' : '❌未确认'}</span>
          </div>
          <div class="hri-balls">
            ${item.set.redBalls.map(n => `<span class="ball-sm red">${String(n).padStart(2,'0')}</span>`).join('')}
            <span class="ball-sm sep">+</span>
            <span class="ball-sm blue">${String(item.set.blueBall).padStart(2,'0')}</span>
          </div>
          <div class="hri-result">${resultStr}</div>
          <div class="hri-reason">策略：${reasonText}</div>
        </div>
      `;
    }).join('');
  } else {
    container.innerHTML = state.recommendationHistory.map(item => {
      const result = item.result;
      let resultStr = '', resultCls = '';
      if (result) {
        resultStr = `前区${result.frontHit}/5，后区${result.backHit}/2`;
        resultCls = result.frontHit >= 3 ? 'hit-great' : result.frontHit >= 1 ? 'hit-ok' : 'hit-poor';
      } else {
        resultStr = '⏳ 待开奖';
        resultCls = 'hit-pending';
      }
      
      const reasons = item.set?.reason || [];
      const reasonText = reasons.length > 0 ? reasons.slice(0, 2).join('；') : '无策略说明';
      
      return `
        <div class="hri-item ${resultCls}">
          <div class="hri-top">
            <span class="hri-period">第 ${item.period} 期 · 第 ${item.setIndex + 1} 组</span>
            <span class="hri-conf-tag ${item.confirmed ? 'confirmed' : 'unconfirmed'}">${item.confirmed ? '✅已确认' : '❌未确认'}</span>
          </div>
          <div class="hri-balls">
            ${item.set.frontBalls.map(n => `<span class="ball-sm red">${String(n).padStart(2,'0')}</span>`).join('')}
            <span class="ball-sm sep">+</span>
            ${item.set.backBalls.map(n => `<span class="ball-sm blue">${String(n).padStart(2,'0')}</span>`).join('')}
          </div>
          <div class="hri-result">${resultStr}</div>
          <div class="hri-reason">策略：${reasonText}</div>
        </div>
      `;
    }).join('');
  }
}

// ========== 渲染历史开奖记录 ==========
function renderHistory(data) {
  const container = document.getElementById('historyList');
  const filter = parseInt(document.getElementById('historyFilter').value);
  const displayData = data.slice(0, filter);
  
  if (displayData.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span><p>暂无历史记录</p></div>`;
    return;
  }
  
  container.innerHTML = displayData.map(record => {
    if (currentLotteryType === 'ssq') {
      return `
        <div class="history-item">
          <div class="history-header">
            <span class="history-period">第 ${record.period} 期</span>
            <span class="history-date">${record.date}</span>
          </div>
          <div class="history-balls">
            <div class="balls">
              ${record.redNumbers.map(n => `<span class="ball-sm red">${String(n).padStart(2,'0')}</span>`).join('')}
              <span class="ball-sm sep">+</span>
              <span class="ball-sm blue">${String(record.blueNumber).padStart(2,'0')}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="history-item">
          <div class="history-header">
            <span class="history-period">第 ${record.period} 期</span>
            <span class="history-date">${record.date}</span>
          </div>
          <div class="history-balls">
            <div class="balls">
              ${record.frontNumbers.map(n => `<span class="ball-sm red">${String(n).padStart(2,'0')}</span>`).join('')}
              <span class="ball-sm sep">+</span>
              ${record.backNumbers.map(n => `<span class="ball-sm blue">${String(n).padStart(2,'0')}</span>`).join('')}
            </div>
          </div>
        </div>
      `;
    }
  }).join('');
}

// ========== 折叠往期推荐 ==========
function toggleHistoryRec() {
  const content = document.getElementById('historyRecContent');
  const toggle = document.getElementById('historyRecToggle');
  const isOpen = content.style.display !== 'none';
  
  if (isOpen) {
    content.style.display = 'none';
    toggle.textContent = '▶';
  } else {
    content.style.display = 'block';
    toggle.textContent = '▼';
    renderHistoryRecPanel(getState());
  }
}

// ========== Toast ==========
function showToast(message) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ========== 过滤历史 ==========
function filterHistory() {
  renderHistory(getState().historyData);
}

// ========== 加载状态 ==========
function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  const btn = document.getElementById('refreshBtn');
  if (show) {
    overlay.classList.add('active');
    btn.disabled = true;
    btn.classList.add('loading');
  } else {
    overlay.classList.remove('active');
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ========== 内置备用数据（扩充到30期） ==========
function getBuiltInData(type) {
  if (type === 'ssq') {
    return [
      { period: '26039', date: '2026-04-09', redNumbers: [1, 15, 23, 25, 28, 30], blueNumber: 5 },
      { period: '26038', date: '2026-04-07', redNumbers: [13, 14, 18, 21, 25, 33], blueNumber: 4 },
      { period: '26037', date: '2026-04-05', redNumbers: [2, 12, 27, 29, 31, 3], blueNumber: 13 },
      { period: '26036', date: '2026-04-02', redNumbers: [6, 10, 12, 15, 22, 28], blueNumber: 8 },
      { period: '26035', date: '2026-03-31', redNumbers: [2, 6, 12, 24, 25, 32], blueNumber: 2 },
      { period: '26034', date: '2026-03-29', redNumbers: [1, 3, 7, 13, 22, 32], blueNumber: 7 },
      { period: '26033', date: '2026-03-26', redNumbers: [3, 6, 13, 21, 28, 29], blueNumber: 6 },
      { period: '26032', date: '2026-03-24', redNumbers: [1, 3, 11, 18, 31, 33], blueNumber: 2 },
      { period: '26031', date: '2026-03-22', redNumbers: [3, 10, 12, 18, 33, 8], blueNumber: 8 },
      { period: '26030', date: '2026-03-19', redNumbers: [10, 11, 14, 19, 22, 24], blueNumber: 4 },
      { period: '26029', date: '2026-03-17', redNumbers: [6, 19, 22, 23, 28, 31], blueNumber: 5 },
      { period: '26028', date: '2026-03-15', redNumbers: [2, 6, 9, 17, 25, 28], blueNumber: 15 },
      { period: '26027', date: '2026-03-12', redNumbers: [2, 13, 17, 18, 25, 26], blueNumber: 13 },
      { period: '26026', date: '2026-03-10', redNumbers: [2, 9, 16, 22, 25, 29], blueNumber: 3 },
      { period: '26025', date: '2026-03-08', redNumbers: [2, 3, 15, 20, 23, 24], blueNumber: 10 },
      { period: '26024', date: '2026-03-05', redNumbers: [1, 2, 13, 21, 23, 29], blueNumber: 14 },
      { period: '26023', date: '2026-03-03', redNumbers: [1, 3, 8, 10, 23, 29], blueNumber: 6 },
      { period: '26022', date: '2026-03-01', redNumbers: [15, 18, 23, 25, 28, 32], blueNumber: 11 },
      { period: '26021', date: '2026-02-26', redNumbers: [3, 13, 25, 26, 30, 31], blueNumber: 4 },
      { period: '26020', date: '2026-02-24', redNumbers: [1, 13, 14, 21, 24, 30], blueNumber: 2 },
      { period: '26019', date: '2026-02-22', redNumbers: [5, 8, 12, 19, 27, 33], blueNumber: 9 },
      { period: '26018', date: '2026-02-19', redNumbers: [3, 9, 14, 18, 26, 31], blueNumber: 5 },
      { period: '26017', date: '2026-02-17', redNumbers: [1, 6, 11, 18, 22, 29], blueNumber: 1 },
      { period: '26016', date: '2026-02-15', redNumbers: [2, 7, 12, 19, 25, 30], blueNumber: 12 },
      { period: '26015', date: '2026-02-12', redNumbers: [4, 10, 13, 21, 27, 32], blueNumber: 7 },
      { period: '26014', date: '2026-02-10', redNumbers: [1, 3, 9, 14, 22, 28], blueNumber: 3 },
      { period: '26013', date: '2026-02-08', redNumbers: [5, 11, 16, 20, 25, 33], blueNumber: 6 },
      { period: '26012', date: '2026-02-05', redNumbers: [2, 6, 13, 19, 24, 31], blueNumber: 11 },
      { period: '26011', date: '2026-02-03', redNumbers: [1, 4, 9, 15, 23, 30], blueNumber: 2 },
      { period: '26010', date: '2026-01-29', redNumbers: [3, 7, 12, 18, 26, 29], blueNumber: 8 },
      { period: '26009', date: '2026-01-26', redNumbers: [2, 8, 11, 17, 22, 32], blueNumber: 14 },
      { period: '26008', date: '2026-01-22', redNumbers: [5, 10, 14, 20, 28, 31], blueNumber: 4 },
      { period: '26007', date: '2026-01-19', redNumbers: [1, 6, 9, 16, 25, 33], blueNumber: 10 },
      { period: '26006', date: '2026-01-15', redNumbers: [3, 11, 15, 19, 27, 30], blueNumber: 5 },
      { period: '26005', date: '2026-01-12', redNumbers: [2, 7, 13, 18, 24, 29], blueNumber: 1 },
      { period: '26004', date: '2026-01-08', redNumbers: [4, 8, 12, 16, 21, 32], blueNumber: 13 },
      { period: '26003', date: '2026-01-05', redNumbers: [1, 5, 10, 17, 23, 28], blueNumber: 7 },
      { period: '26002', date: '2026-01-02', redNumbers: [3, 9, 14, 20, 26, 31], blueNumber: 2 },
      { period: '26001', date: '2025-12-29', redNumbers: [2, 6, 11, 15, 22, 27], blueNumber: 9 },
    ];
  } else {
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
      { period: '26028', date: '2026-03-18', frontNumbers: [15, 27, 29, 30, 34], backNumbers: [1, 10] },
      { period: '26027', date: '2026-03-16', frontNumbers: [9, 10, 11, 12, 16], backNumbers: [1, 11] },
      { period: '26026', date: '2026-03-14', frontNumbers: [10, 11, 22, 26, 32], backNumbers: [1, 8] },
      { period: '26025', date: '2026-03-11', frontNumbers: [3, 15, 24, 28, 29], backNumbers: [3, 7] },
      { period: '26024', date: '2026-03-09', frontNumbers: [2, 4, 8, 10, 21], backNumbers: [9, 12] },
      { period: '26023', date: '2026-03-07', frontNumbers: [9, 25, 26, 27, 28], backNumbers: [1, 8] },
      { period: '26022', date: '2026-03-04', frontNumbers: [5, 8, 12, 14, 17], backNumbers: [4, 5] },
      { period: '26021', date: '2026-03-02', frontNumbers: [1, 10, 21, 23, 29], backNumbers: [10, 12] },
      { period: '26020', date: '2026-02-28', frontNumbers: [12, 13, 14, 16, 31], backNumbers: [4, 12] },
      { period: '26019', date: '2026-02-25', frontNumbers: [9, 11, 19, 30, 35], backNumbers: [1, 12] },
      { period: '26018', date: '2026-02-22', frontNumbers: [1, 3, 8, 16, 22], backNumbers: [3, 9] },
      { period: '26017', date: '2026-02-19', frontNumbers: [5, 14, 21, 27, 33], backNumbers: [2, 6] },
      { period: '26016', date: '2026-02-17', frontNumbers: [4, 7, 18, 25, 31], backNumbers: [5, 11] },
      { period: '26015', date: '2026-02-14', frontNumbers: [2, 9, 13, 20, 28], backNumbers: [4, 8] },
      { period: '26014', date: '2026-02-12', frontNumbers: [6, 11, 15, 24, 32], backNumbers: [1, 7] },
      { period: '26013', date: '2026-02-10', frontNumbers: [3, 8, 17, 22, 35], backNumbers: [2, 10] },
      { period: '26012', date: '2026-02-07', frontNumbers: [1, 5, 12, 19, 26], backNumbers: [3, 9] },
      { period: '26011', date: '2026-02-05', frontNumbers: [4, 10, 16, 23, 29], backNumbers: [6, 12] },
      { period: '26010', date: '2026-02-03', frontNumbers: [2, 7, 14, 21, 30], backNumbers: [1, 5] },
      { period: '26009', date: '2026-01-29', frontNumbers: [5, 9, 18, 25, 34], backNumbers: [4, 11] },
      { period: '26008', date: '2026-01-26', frontNumbers: [3, 6, 11, 20, 27], backNumbers: [2, 8] },
      { period: '26007', date: '2026-01-22', frontNumbers: [8, 13, 17, 24, 31], backNumbers: [3, 7] },
      { period: '26006', date: '2026-01-19', frontNumbers: [1, 4, 10, 15, 28], backNumbers: [5, 9] },
      { period: '26005', date: '2026-01-15', frontNumbers: [6, 9, 14, 22, 33], backNumbers: [1, 6] },
      { period: '26004', date: '2026-01-12', frontNumbers: [2, 5, 11, 18, 25], backNumbers: [4, 10] },
      { period: '26003', date: '2026-01-08', frontNumbers: [7, 12, 16, 23, 30], backNumbers: [2, 12] },
      { period: '26002', date: '2026-01-05', frontNumbers: [3, 8, 13, 19, 26], backNumbers: [3, 8] },
      { period: '26001', date: '2026-01-02', frontNumbers: [4, 9, 15, 21, 32], backNumbers: [1, 7] },
    ];
  }
}
