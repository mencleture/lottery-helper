const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========== IPC: 获取推荐号码 ==========
ipcMain.handle('get-recommendation', async (event, lotteryType, historyData) => {
  console.log(`[Main] 收到推荐请求: ${lotteryType}, 历史数据 ${historyData?.length || 0} 条`);
  
  try {
    const recommendations = generateSmartRecommendation(lotteryType, historyData);
    console.log(`[Main] 生成 ${recommendations.length} 组推荐`);
    return { success: true, data: recommendations };
  } catch (error) {
    console.error('[Main] 生成推荐失败:', error);
    return { success: false, error: error.message };
  }
});

// ========== 智能推荐算法 ==========
function generateSmartRecommendation(lotteryType, historyData) {
  const recommendations = [];
  const recent10 = historyData.slice(0, 10);  // 最近10期
  const recent30 = historyData.slice(0, 30);  // 最近30期
  
  if (lotteryType === 'ssq') {
    // ===== 双色球分析 =====
    
    // 1. 热号统计（最近10期出现频率）
    const redFreq = new Array(34).fill(0);
    const blueFreq = new Array(17).fill(0);
    
    recent10.forEach(record => {
      if (record.redNumbers) {
        record.redNumbers.forEach(n => redFreq[n]++);
      }
      if (record.blueNumber) blueFreq[record.blueNumber]++;
    });
    
    // 热号：出现2次以上
    const hotReds = [];
    const warmReds = [];  // 出现1次
    for (let i = 1; i <= 33; i++) {
      if (redFreq[i] >= 3) hotReds.push(i);
      else if (redFreq[i] === 1 || redFreq[i] === 2) warmReds.push(i);
    }
    
    // 2. 遗漏号（最近10期未出现）
    const missingReds = [];
    for (let i = 1; i <= 33; i++) {
      if (redFreq[i] === 0) missingReds.push(i);
    }
    
    // 3. 连号分析（最近10期含连号的期数）
    let consecutiveCount = 0;
    recent10.forEach(record => {
      if (hasConsecutive(record.redNumbers)) consecutiveCount++;
    });
    const consecutiveRate = consecutiveCount / recent10.length;
    
    // 4. 奇偶统计（最近10期）
    let oddTotal = 0;
    recent10.forEach(record => {
      oddTotal += record.redNumbers.filter(n => n % 2 === 1).length;
    });
    const avgOdd = oddTotal / recent10.length;
    
    // 5. 区间统计（三区：1-11, 12-22, 23-33）
    const zoneCount = [0, 0, 0];
    recent10.forEach(record => {
      record.redNumbers.forEach(n => {
        if (n <= 11) zoneCount[0]++;
        else if (n <= 22) zoneCount[1]++;
        else zoneCount[2]++;
      });
    });
    
    // 生成5组不同策略
    const strategies = [
      { name: '热号为主', weight: 'hot' },
      { name: '均衡型', weight: 'balanced' },
      { name: '冷号回补', weight: 'cold' },
      { name: '连号组合', weight: 'consecutive' },
      { name: '区间精选', weight: 'zone' }
    ];
    
    strategies.forEach((strategy, idx) => {
      const result = generateSSQSet(
        strategy, hotReds, warmReds, missingReds, 
        consecutiveRate, avgOdd, zoneCount, blueFreq
      );
      recommendations.push(result);
    });
    
  } else if (lotteryType === 'dlt') {
    // ===== 大乐透分析 =====
    
    // 热号统计
    const frontFreq = new Array(36).fill(0);
    const backFreq = new Array(13).fill(0);
    
    recent10.forEach(record => {
      if (record.frontNumbers) {
        record.frontNumbers.forEach(n => frontFreq[n]++);
      }
      if (record.backNumbers) {
        record.backNumbers.forEach(n => backFreq[n]++);
      }
    });
    
    const hotFronts = [];
    const warmFronts = [];
    const missingFronts = [];
    
    for (let i = 1; i <= 35; i++) {
      if (frontFreq[i] >= 3) hotFronts.push(i);
      else if (frontFreq[i] >= 1) warmFronts.push(i);
      else missingFronts.push(i);
    }
    
    const hotBacks = [];
    for (let i = 1; i <= 12; i++) {
      if (backFreq[i] >= 2) hotBacks.push(i);
    }
    
    // 连号统计
    let consecutiveCount = 0;
    recent10.forEach(record => {
      if (hasConsecutive(record.frontNumbers)) consecutiveCount++;
    });
    const consecutiveRate = consecutiveCount / recent10.length;
    
    // 生成5组
    const strategies = [
      { name: '热号追踪', weight: 'hot' },
      { name: '均衡稳健', weight: 'balanced' },
      { name: '冷号回补', weight: 'cold' },
      { name: '连号组合', weight: 'consecutive' },
      { name: '和值优选', weight: 'sum' }
    ];
    
    strategies.forEach(strategy => {
      const result = generateDLTSet(
        strategy, hotFronts, warmFronts, missingFronts, 
        hotBacks, backFreq, consecutiveRate
      );
      recommendations.push(result);
    });
  }
  
  return recommendations;
}

// ========== 双色球生成 ==========
function generateSSQSet(strategy, hotReds, warmReds, missingReds, 
                         consecutiveRate, avgOdd, zoneCount, blueFreq) {
  const reasons = [strategy.name + '策略'];
  let redBalls = [];
  let blueBall;
  
  switch (strategy.weight) {
    case 'hot':
      // 热号为主：3-4个热号 + 2-3个温号
      const hotPick = pickRandom(hotReds, Math.min(4, hotReds.length));
      const warmPick = pickRandom(warmReds, 6 - hotPick.length);
      redBalls = [...hotPick, ...warmPick].slice(0, 6);
      while (redBalls.length < 6) {
        const r = Math.floor(Math.random() * 33) + 1;
        if (!redBalls.includes(r)) redBalls.push(r);
      }
      reasons.push(`热号${hotPick.length}个：${hotPick.join(',')}`);
      reasons.push('近10期高频号码，中奖概率较高');
      break;
      
    case 'balanced':
      // 均衡型：2热+2温+2冷
      const b1 = pickRandom(hotReds, Math.min(2, hotReds.length));
      const b2 = pickRandom(warmReds, Math.min(2, warmReds.length));
      const b3 = pickRandom(missingReds, Math.min(2, missingReds.length));
      redBalls = [...b1, ...b2, ...b3];
      while (redBalls.length < 6) {
        const r = Math.floor(Math.random() * 33) + 1;
        if (!redBalls.includes(r)) redBalls.push(r);
      }
      reasons.push('热温冷各取2个，平衡分布');
      // 确保奇偶平衡
      const oddC = redBalls.filter(n => n % 2 === 1).length;
      if (oddC < 2 || oddC > 4) {
        redBalls = rebalanceOddEven(redBalls, 3);
      }
      reasons.push('奇偶比3:3，最稳定组合');
      break;
      
    case 'cold':
      // 冷号回补：重点选遗漏号
      const coldPick = pickRandom(missingReds, Math.min(4, missingReds.length));
      const coldWarm = pickRandom(warmReds, 6 - coldPick.length);
      redBalls = [...coldPick, ...coldWarm];
      while (redBalls.length < 6) {
        const r = Math.floor(Math.random() * 33) + 1;
        if (!redBalls.includes(r)) redBalls.push(r);
      }
      reasons.push(`冷号${coldPick.length}个：遗漏回补`);
      reasons.push('冷号长期未出，近期可能出现');
      break;
      
    case 'consecutive':
      // 连号组合：强制包含1-2组连号
      redBalls = generateWithConsecutive(hotReds, warmReds);
      reasons.push('含连号组合');
      reasons.push(`近10期连号出现率${(consecutiveRate*100).toFixed(0)}%`);
      break;
      
    case 'zone':
      // 区间精选：按三区分布
      redBalls = generateByZone(hotReds, warmReds, missingReds, zoneCount);
      const z1 = redBalls.filter(n => n <= 11).length;
      const z2 = redBalls.filter(n => n > 11 && n <= 22).length;
      const z3 = redBalls.filter(n => n > 22).length;
      reasons.push(`三区比${z1}:${z2}:${z3}`);
      reasons.push('区间分布均衡，覆盖面广');
      break;
  }
  
  redBalls.sort((a, b) => a - b);
  
  // 蓝球：优先选热号
  const hotBlues = [];
  for (let i = 1; i <= 16; i++) {
    if (blueFreq[i] >= 2) hotBlues.push(i);
  }
  if (hotBlues.length > 0) {
    blueBall = hotBlues[Math.floor(Math.random() * hotBlues.length)];
    reasons.push(`蓝球${blueBall}为热号`);
  } else {
    blueBall = Math.floor(Math.random() * 16) + 1;
    reasons.push(`蓝球${blueBall}随机选取`);
  }
  
  return {
    type: 'ssq',
    redBalls,
    blueBall,
    reason: reasons
  };
}

// ========== 大乐透生成 ==========
function generateDLTSet(strategy, hotFronts, warmFronts, missingFronts,
                        hotBacks, backFreq, consecutiveRate) {
  const reasons = [strategy.name + '策略'];
  let frontBalls = [];
  let backBalls = [];
  
  switch (strategy.weight) {
    case 'hot':
      const fh = pickRandom(hotFronts, Math.min(3, hotFronts.length));
      const fw = pickRandom(warmFronts, 5 - fh.length);
      frontBalls = [...fh, ...fw];
      while (frontBalls.length < 5) {
        const r = Math.floor(Math.random() * 35) + 1;
        if (!frontBalls.includes(r)) frontBalls.push(r);
      }
      reasons.push(`前区热号${fh.length}个`);
      break;
      
    case 'balanced':
      const b1 = pickRandom(hotFronts, 2);
      const b2 = pickRandom(warmFronts, 2);
      const b3 = pickRandom(missingFronts, 1);
      frontBalls = [...b1, ...b2, ...b3];
      while (frontBalls.length < 5) {
        const r = Math.floor(Math.random() * 35) + 1;
        if (!frontBalls.includes(r)) frontBalls.push(r);
      }
      reasons.push('前区热温冷均衡');
      break;
      
    case 'cold':
      const c1 = pickRandom(missingFronts, Math.min(3, missingFronts.length));
      const c2 = pickRandom(warmFronts, 5 - c1.length);
      frontBalls = [...c1, ...c2];
      while (frontBalls.length < 5) {
        const r = Math.floor(Math.random() * 35) + 1;
        if (!frontBalls.includes(r)) frontBalls.push(r);
      }
      reasons.push('前区冷号回补');
      break;
      
    case 'consecutive':
      frontBalls = generateDLTWithConsecutive(hotFronts, warmFronts);
      reasons.push(`连号组合，出现率${(consecutiveRate*100).toFixed(0)}%`);
      break;
      
    case 'sum':
      // 和值在80-120之间
      frontBalls = generateBySum(hotFronts, warmFronts, 80, 120);
      const sum = frontBalls.reduce((a, b) => a + b, 0);
      reasons.push(`和值${sum}，在黄金区间`);
      break;
  }
  
  frontBalls.sort((a, b) => a - b);
  
  // 后区：优先热号
  if (hotBacks.length >= 2) {
    backBalls = pickRandom(hotBacks, 2);
  } else if (hotBacks.length === 1) {
    backBalls = [...hotBacks];
    let r;
    do {
      r = Math.floor(Math.random() * 12) + 1;
    } while (r === hotBacks[0]);
    backBalls.push(r);
  } else {
    backBalls = pickRandom([1,2,3,4,5,6,7,8,9,10,11,12], 2);
  }
  backBalls.sort((a, b) => a - b);
  reasons.push(`后区${backBalls.join(',')}`);
  
  return {
    type: 'dlt',
    frontBalls,
    backBalls,
    reason: reasons
  };
}

// ========== 工具函数 ==========
function pickRandom(arr, count) {
  if (!arr || arr.length === 0) return [];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

function hasConsecutive(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) return true;
  }
  return false;
}

function generateWithConsecutive(hotReds, warmReds) {
  const result = [];
  const all = [...hotReds, ...warmReds];
  
  // 随机选一个起始号作为连号
  const start = Math.floor(Math.random() * 32) + 1;
  result.push(start, start + 1);
  
  // 再补4个非连号
  const remaining = all.filter(n => n !== start && n !== start + 1);
  const extra = pickRandom(remaining.length > 0 ? remaining : 
    Array.from({length: 31}, (_, i) => i + 1).filter(n => n !== start && n !== start + 1), 4);
  result.push(...extra);
  
  while (result.length < 6) {
    const r = Math.floor(Math.random() * 33) + 1;
    if (!result.includes(r)) result.push(r);
  }
  
  return result.slice(0, 6);
}

function generateDLTWithConsecutive(hotFronts, warmFronts) {
  const result = [];
  const start = Math.floor(Math.random() * 34) + 1;
  result.push(start, start + 1);
  
  const all = [...hotFronts, ...warmFronts];
  const remaining = all.filter(n => n !== start && n !== start + 1);
  const extra = pickRandom(remaining.length > 0 ? remaining : 
    Array.from({length: 33}, (_, i) => i + 1).filter(n => n !== start && n !== start + 1), 3);
  result.push(...extra);
  
  while (result.length < 5) {
    const r = Math.floor(Math.random() * 35) + 1;
    if (!result.includes(r)) result.push(r);
  }
  
  return result.slice(0, 5);
}

function generateByZone(hotReds, warmReds, missingReds, zoneCount) {
  const result = [];
  
  // 根据历史区间分布决定各区间选几个
  const total = zoneCount[0] + zoneCount[1] + zoneCount[2];
  const target = [2, 2, 2]; // 默认均衡
  
  // 一区
  const z1Pool = [...hotReds, ...warmReds, ...missingReds].filter(n => n <= 11);
  result.push(...pickRandom(z1Pool.length > 0 ? z1Pool : Array.from({length: 11}, (_, i) => i + 1), 2));
  
  // 二区
  const z2Pool = [...hotReds, ...warmReds, ...missingReds].filter(n => n > 11 && n <= 22);
  result.push(...pickRandom(z2Pool.length > 0 ? z2Pool : Array.from({length: 11}, (_, i) => i + 12), 2));
  
  // 三区
  const z3Pool = [...hotReds, ...warmReds, ...missingReds].filter(n => n > 22);
  result.push(...pickRandom(z3Pool.length > 0 ? z3Pool : Array.from({length: 11}, (_, i) => i + 23), 2));
  
  while (result.length < 6) {
    const r = Math.floor(Math.random() * 33) + 1;
    if (!result.includes(r)) result.push(r);
  }
  
  return result.slice(0, 6);
}

function rebalanceOddEven(balls, targetOdd) {
  const result = [...balls];
  let oddCount = result.filter(n => n % 2 === 1).length;
  
  while (oddCount < targetOdd) {
    const evenIdx = result.findIndex(n => n % 2 === 0);
    if (evenIdx === -1) break;
    const replacement = findOddNotIn(result);
    if (replacement) {
      result[evenIdx] = replacement;
      oddCount++;
    } else break;
  }
  
  while (oddCount > targetOdd) {
    const oddIdx = result.findIndex(n => n % 2 === 1);
    if (oddIdx === -1) break;
    const replacement = findEvenNotIn(result);
    if (replacement) {
      result[oddIdx] = replacement;
      oddCount--;
    } else break;
  }
  
  return result;
}

function findOddNotIn(arr) {
  for (let i = 1; i <= 33; i += 2) {
    if (!arr.includes(i)) return i;
  }
  return null;
}

function findEvenNotIn(arr) {
  for (let i = 2; i <= 33; i += 2) {
    if (!arr.includes(i)) return i;
  }
  return null;
}

function generateBySum(hotFronts, warmFronts, minSum, maxSum) {
  let best = null;
  let bestDiff = Infinity;
  
  for (let attempt = 0; attempt < 50; attempt++) {
    const all = [...hotFronts, ...warmFronts];
    const picked = pickRandom(all.length >= 5 ? all : Array.from({length: 35}, (_, i) => i + 1), 5);
    
    while (picked.length < 5) {
      const r = Math.floor(Math.random() * 35) + 1;
      if (!picked.includes(r)) picked.push(r);
    }
    
    const sum = picked.reduce((a, b) => a + b, 0);
    const targetSum = (minSum + maxSum) / 2;
    const diff = Math.abs(sum - targetSum);
    
    if (sum >= minSum && sum <= maxSum && diff < bestDiff) {
      best = picked;
      bestDiff = diff;
    }
  }
  
  return best || pickRandom(Array.from({length: 35}, (_, i) => i + 1), 5);
}
