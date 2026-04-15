const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// ========== ML 目录设置：从 asar 复制到 userData ==========
function ensureMlSetup() {
  const mlDest = path.join(app.getPath('userData'), 'ml');
  if (fs.existsSync(mlDest)) {
    return mlDest; // 已存在，跳过
  }

  const mlSrc = path.join(__dirname, 'ml');
  if (!fs.existsSync(mlSrc)) {
    console.warn('[ML] 打包中未找到 ml 目录，ML 功能将不可用');
    return null;
  }

  fs.mkdirSync(mlDest, { recursive: true });

  // 递归复制
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(mlSrc, mlDest);
  console.log(`[ML] 已初始化 ml 目录: ${mlDest}`);
  return mlDest;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 920,
    minHeight: 680,
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

app.whenReady().then(() => {
  ensureMlSetup(); // 初始化 ML 目录
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========== IPC: 导出历史数据到 JSON（供 Python 训练脚本读取） ==========
ipcMain.handle('export-history-data', async (event, lotteryType, historyData) => {
  try {
    // 用 app.getPath('userData') 避免 asar 只读问题
    const dataDir = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, `${lotteryType}_history.json`);
    fs.writeFileSync(filePath, JSON.stringify(historyData, null, 2), 'utf8');
    console.log(`[Main] 导出 ${lotteryType} 数据到 ${filePath}, ${historyData.length} 条`);
    return { success: true, count: historyData.length, path: filePath };
  } catch (error) {
    console.error('[Main] 导出失败:', error);
    return { success: false, error: error.message };
  }
});

// ========== IPC: 获取推荐号码 ==========
ipcMain.handle('get-stats-analysis', async (event, lotteryType) => {
  try {
    const mlDir = path.join(app.getPath('userData'), 'ml');
    const scriptPath = path.join(mlDir, 'stats.py');
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: 'stats.py not found' };
    }
    const { execSync } = require('child_process');
    const cmd = `python "${scriptPath}" ${lotteryType} 50 2>&1`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
    const match = output.match(/__RESULT_JSON__([\s\S]*?)__END_RESULT__/);
    if (match) {
      const results = JSON.parse(match[1]);
      return { success: true, data: results[lotteryType] };
    }
    // 没有JSON时返回文本摘要
    const lines = output.split('\n').filter(l => l.trim() && !l.includes('__RESULT'));
    return { success: true, text: lines.join('\n') };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-recommendation', async (event, lotteryType, historyData) => {
  console.log(`[Main] 收到推荐请求: ${lotteryType}, 历史数据 ${historyData?.length || 0} 条`);
  
  try {
    // 1. 调用 ML 预测（ml/ 已由 ensureMlSetup() 复制到 userData）
    let mlPrediction = null;
    try {
      const { execSync } = require('child_process');
      const mlDir = path.join(app.getPath('userData'), 'ml');
      const scriptPath = path.join(mlDir, 'predict.py');
      const cmd = `python "${scriptPath}" --${lotteryType}-only 2>&1`;
      console.log(`[Main] ML预测命令: ${cmd}`);
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
      console.log(`[Main] ML输出长度: ${output.length} 字符`);
      
      // 提取 JSON 结果
      const match = output.match(/__RESULT_JSON__([\s\S]*?)__END_RESULT__/);
      if (match) {
        const results = JSON.parse(match[1]);
        mlPrediction = results[lotteryType];
        console.log(`[Main] ML预测成功: type=${mlPrediction?.type}, redBalls=${JSON.stringify(mlPrediction?.redBalls)}`);
      } else {
        console.warn('[Main] ML输出中未找到 JSON 结果');
      }
    } catch (mlErr) {
      console.warn('[Main] ML预测失败，使用规则策略:', mlErr.message);
    }

    // 玄学推荐（第2组）
    let mysticalPrediction = null;
    try {
      const { execSync } = require('child_process');
      const mlDir = path.join(app.getPath('userData'), 'ml');
      const scriptPath = path.join(mlDir, 'mystical_recommend.py');
      const cmd = `python "${scriptPath}" ${lotteryType} 2>&1`;
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
      const match = output.match(/__RESULT_JSON__([\s\S]*?)__END_RESULT__/);
      if (match) {
        mysticalPrediction = JSON.parse(match[1]);
        console.log('[Main] 玄学推荐成功:', JSON.stringify(mysticalPrediction?.redBalls || mysticalPrediction?.frontBalls));
      }
    } catch (mystErr) {
      console.warn('[Main] 玄学推荐失败:', mystErr.message);
    }

    // 固定策略榜单：每期固定 7 个策略，并按历史表现排序
    const strategyBoard = generateRankedStrategyBoard(lotteryType, historyData, mlPrediction, mysticalPrediction);
    console.log(`[Main] 固定策略 ${strategyBoard.atomicStrategies.length} 个，排序后输出 ${strategyBoard.rankedStrategies.length} 个`);
    return {
      success: true,
      data: strategyBoard.rankedStrategies,
      meta: {
        atomicStrategies: strategyBoard.atomicStrategies,
        architectureVersion: 'v3-ranked-strategies'
      }
    };
  } catch (error) {
    console.error('[Main] 生成推荐失败:', error);
    return { success: false, error: error.message };
  }
});

// ========== 智能推荐算法 ==========
function createRecommendationEnvelope(meta, payload, extraReason = []) {
  const originReasons = Array.isArray(payload?.reason) ? payload.reason : [];
  return {
    ...payload,
    masterKey: meta.key,
    masterName: meta.name,
    badge: meta.badge,
    summary: meta.summary,
    role: meta.role,
    reason: [...extraReason, ...originReasons]
  };
}

function cloneRecommendation(rec) {
  return JSON.parse(JSON.stringify(rec));
}

function scoreRecommendationQuality(lotteryType, rec, historyData) {
  if (!rec) return -999;
  const latest = historyData?.[0] || null;
  const main = lotteryType === 'ssq' ? [...(rec.redBalls || [])] : [...(rec.frontBalls || [])];
  if (!main.length) return -999;
  const sorted = [...main].sort((a, b) => a - b);
  const odd = main.filter(n => n % 2 === 1).length;
  const sum = main.reduce((a, b) => a + b, 0);
  const ac = calcAC(main);
  const consecutive = countConsecutivePairs(main);
  const repeatWithLast = latest
    ? (lotteryType === 'ssq'
      ? main.filter(n => (latest.redNumbers || []).includes(n)).length
      : main.filter(n => (latest.frontNumbers || []).includes(n)).length)
    : 0;

  let score = 50;
  if (lotteryType === 'ssq') {
    if (sum >= 75 && sum <= 130) score += 12;
    if (ac >= 8 && ac <= 10) score += 10;
    if (odd >= 2 && odd <= 4) score += 8;
  } else {
    if (sum >= 60 && sum <= 110) score += 12;
    if (ac >= 7 && ac <= 10) score += 10;
    if (odd >= 2 && odd <= 3) score += 8;
  }
  if (consecutive <= 2) score += 6;
  score += Math.max(0, 8 - repeatWithLast * 2);
  score += Math.max(0, new Set(main.map(n => n % 10)).size - 3);
  return score;
}

function buildMasterRecommendations(lotteryType, rawRecommendations, historyData, mlPrediction, mysticalPrediction) {
  const recs = Array.isArray(rawRecommendations) ? rawRecommendations.filter(Boolean) : [];
  const mlRec = recs.find(r => r.reason?.some?.(x => String(x).includes('ML模型')))
    || (mlPrediction ? recs[0] : null);
  const mysticRec = recs.find(r => r.reason?.some?.(x => String(x).includes('玄学') || String(x).includes('上期') || String(x).includes('遗漏')))
    || (mysticalPrediction ? recs.find(r => r !== mlRec) : null);
  const others = recs.filter(r => r !== mlRec && r !== mysticRec)
    .map(r => ({ rec: r, score: scoreRecommendationQuality(lotteryType, r, historyData) }))
    .sort((a, b) => b.score - a.score);

  const bestRec = others[0]?.rec || mlRec || mysticRec || recs[0] || null;
  const hotRec = others.find(x => x.rec.reason?.some?.(r => String(r).includes('热号')))?.rec || others[1]?.rec || mlRec || bestRec;
  const steadyRec = others.find(x => x.rec.reason?.some?.(r => String(r).includes('平衡') || String(r).includes('稳健') || String(r).includes('奇偶')))?.rec || bestRec || others[0]?.rec;
  const coldRec = others.find(x => x.rec.reason?.some?.(r => String(r).includes('冷号') || String(r).includes('回补') || String(r).includes('遗漏')))?.rec || others[others.length - 1]?.rec || bestRec;
  const mysticFinal = mysticRec || others.find(x => x.rec.reason?.some?.(r => String(r).includes('和值') || String(r).includes('跨度') || String(r).includes('区间')))?.rec || bestRec;

  const blueLabel = lotteryType === 'ssq' ? '蓝球' : '后区';
  const masterMeta = [
    { key: 'best', name: '综合最优', badge: '🏆 综合最优', role: 'balanced', summary: '融合结构质量与历史分布后的首选推荐', rec: bestRec, extra: ['综合评分最高，优先作为主推荐展示'] },
    { key: 'hot', name: '偏热策略', badge: '🔥 偏热策略', role: 'trend', summary: '偏向近期热号与热点结构', rec: hotRec, extra: ['强化近期热号趋势与热点组合'] },
    { key: 'steady', name: '偏稳策略', badge: '🛡️ 偏稳策略', role: 'stable', summary: '更注重奇偶、和值、分区的平衡', rec: steadyRec, extra: ['更强调结构均衡与可读性'] },
    { key: 'cold', name: '偏冷策略', badge: '❄️ 偏冷策略', role: 'rebound', summary: '关注遗漏与冷号回补机会', rec: coldRec, extra: ['偏向遗漏修复与冷号回补逻辑'] },
    { key: 'mystic', name: '偏玄学', badge: '🔮 偏玄学', role: 'style', summary: '保留风格化选号思路与差异化表达', rec: mysticFinal, extra: [`保留风格化思路，${blueLabel}搭配更偏个性化`] }
  ];

  return masterMeta.map(item => createRecommendationEnvelope(item, cloneRecommendation(item.rec || bestRec || recs[0] || {}), item.extra));
}

function buildBallSetFromScores(scoreEntries, count, maxNum) {
  const picked = [];
  for (const [num] of scoreEntries) {
    const val = Number(num);
    if (!picked.includes(val)) picked.push(val);
    if (picked.length >= count) break;
  }
  for (let n = 1; picked.length < count && n <= maxNum; n++) {
    if (!picked.includes(n)) picked.push(n);
  }
  return picked.sort((a, b) => a - b);
}

function scorePoolToReason(scoreEntries, topN = 5, suffix = 'Top') {
  return `${suffix}: ${scoreEntries.slice(0, topN).map(([n]) => String(n).padStart(2, '0')).join(', ')}`;
}

function computeAtomicScoreMaps(lotteryType, historyData, mlPrediction, mysticalPrediction) {
  const recent10 = historyData.slice(0, 10);
  const recent30 = historyData.slice(0, 30);
  const recent50 = historyData.slice(0, 50);

  if (lotteryType === 'ssq') {
    const maxMain = 33;
    const maxBack = 16;
    const hotFreq = new Array(maxMain + 1).fill(0);
    const blueFreq = new Array(maxBack + 1).fill(0);
    recent10.forEach(record => {
      (record.redNumbers || []).forEach(n => hotFreq[n]++);
      if (record.blueNumber) blueFreq[record.blueNumber]++;
    });
    const redMissing = computeMissingPeriods(1, maxMain, recent50, 'redNumbers');
    const longFreq = new Array(maxMain + 1).fill(0);
    recent30.forEach(record => (record.redNumbers || []).forEach(n => longFreq[n]++));
    const digitStats = computeDigitStats(recent30, 'redNumbers');

    const maps = {
      ml: {},
      mystical: {},
      hot: {},
      cold: {},
      balanced: {},
      trend: {},
      zoneSum: {},
      pattern: {},
      blue: {}
    };

    for (let n = 1; n <= maxMain; n++) {
      const mlScore = mlPrediction?.probabilities?.[String(n)] ? Number(mlPrediction.probabilities[String(n)]) * 100 : 0;
      const mystScore = mysticalPrediction?.redBalls?.includes?.(n) ? 95 - (mysticalPrediction.redBalls.indexOf(n) * 5) : 0;
      const zoneIndex = n <= 11 ? 0 : (n <= 22 ? 1 : 2);
      const edgeBias = (n <= 6 || n >= 28) ? 8 : 0;
      const centerBias = (n >= 12 && n <= 22) ? 10 : 0;
      const tailRarity = Math.max(0, 8 - ((digitStats[n % 10] || 0) / 2));
      const hotScore = hotFreq[n] * 20 + longFreq[n] * 4 + (n <= 11 ? 3 : 0);
      const coldScore = redMissing[n] * 9 + (hotFreq[n] === 0 ? 14 : 0) + edgeBias;
      const balancedScore = (hotFreq[n] >= 1 ? 18 : 9) + centerBias + ((n % 2 === 1) ? 6 : 5) + (zoneIndex === 1 ? 4 : 2) + tailRarity;
      const trendScore = Math.max(0, hotFreq[n] * 16 - longFreq[n] * 2) + (redMissing[n] <= 2 ? 10 : 0) + (zoneIndex !== 1 ? 3 : 0);
      const zoneScore = (zoneIndex === 1 ? 22 : 15) + tailRarity + (redMissing[n] >= 4 && redMissing[n] <= 10 ? 6 : 0);
      const patternScore = (redMissing[n] >= 3 && redMissing[n] <= 8 ? 24 : 0)
        + (redMissing[n] >= 15 ? 22 : 0)
        + (hotFreq[n] === 0 ? 10 : 0)
        + (longFreq[n] <= 1 ? 12 : 0)
        + tailRarity
        + (zoneIndex !== 1 ? 4 : 0);
      maps.ml[n] = mlScore;
      maps.mystical[n] = mystScore;
      maps.hot[n] = hotScore;
      maps.cold[n] = coldScore;
      maps.balanced[n] = balancedScore;
      maps.trend[n] = trendScore;
      maps.zoneSum[n] = zoneScore;
      maps.pattern[n] = patternScore;
    }

    for (let n = 1; n <= maxBack; n++) {
      const coolBlue = blueFreq[n] === 0 ? 12 : 0;
      const warmBlue = blueFreq[n] >= 2 ? 6 : 0;
      maps.blue[n] = (blueFreq[n] || 0) * 16 + ((mlPrediction?.blueBall === n) ? 26 : 0) + ((mysticalPrediction?.blueBalls || []).includes(n) ? 18 : 0) + coolBlue + warmBlue;
    }

    return maps;
  }

  const maxMain = 35;
  const maxBack = 12;
  const hotFreq = new Array(maxMain + 1).fill(0);
  const backFreq = new Array(maxBack + 1).fill(0);
  recent10.forEach(record => {
    (record.frontNumbers || []).forEach(n => hotFreq[n]++);
    (record.backNumbers || []).forEach(n => backFreq[n]++);
  });
  const frontMissing = computeMissingPeriods(1, maxMain, recent50, 'frontNumbers');
  const backMissing = computeMissingPeriods(1, maxBack, recent50, 'backNumbers');
  const longFreq = new Array(maxMain + 1).fill(0);
  recent30.forEach(record => (record.frontNumbers || []).forEach(n => longFreq[n]++));
  const digitStats = computeDigitStats(recent30, 'frontNumbers');

  const maps = {
    ml: {},
    mystical: {},
    hot: {},
    cold: {},
    balanced: {},
    trend: {},
    zoneSum: {},
    pattern: {},
    blue: {}
  };

  for (let n = 1; n <= maxMain; n++) {
    const mlScore = mlPrediction?.probabilities?.[String(n)] ? Number(mlPrediction.probabilities[String(n)]) * 100 : 0;
    const mystScore = mysticalPrediction?.redBalls?.includes?.(n) ? 95 - (mysticalPrediction.redBalls.indexOf(n) * 5) : 0;
    const zoneIndex = n <= 12 ? 0 : (n <= 24 ? 1 : 2);
    const spanBias = (n >= 8 && n <= 29) ? 8 : 3;
    const frontTailRarity = Math.max(0, 7 - ((digitStats[n % 10] || 0) / 2));
    const hotScore = hotFreq[n] * 18 + longFreq[n] * 5 + (zoneIndex === 1 ? 4 : 0);
    const coldScore = frontMissing[n] * 8 + (hotFreq[n] === 0 ? 10 : 0) + (zoneIndex !== 1 ? 4 : 1);
    const balancedScore = (hotFreq[n] >= 1 ? 15 : 7) + Math.max(0, 11 - Math.abs(18 - n)) + ((n % 2 === 1) ? 4 : 5) + spanBias;
    const trendScore = Math.max(0, hotFreq[n] * 17 - longFreq[n] * 1.5) + (frontMissing[n] <= 2 ? 10 : 0) + (n >= 10 && n <= 30 ? 4 : 0);
    const zoneScore = (zoneIndex === 1 ? 18 : 14) + frontTailRarity + (n >= 10 && n <= 30 ? 6 : 0) + (frontMissing[n] >= 5 && frontMissing[n] <= 11 ? 4 : 0);
    const patternScore = (frontMissing[n] >= 4 && frontMissing[n] <= 9 ? 20 : 0)
      + (frontMissing[n] >= 14 ? 18 : 0)
      + (hotFreq[n] === 0 ? 8 : 0)
      + (longFreq[n] <= 1 ? 8 : 0)
      + frontTailRarity
      + (zoneIndex === 1 ? 5 : 2);
    maps.ml[n] = mlScore;
    maps.mystical[n] = mystScore;
    maps.hot[n] = hotScore;
    maps.cold[n] = coldScore;
    maps.balanced[n] = balancedScore;
    maps.trend[n] = trendScore;
    maps.zoneSum[n] = zoneScore;
    maps.pattern[n] = patternScore;
  }

  for (let n = 1; n <= maxBack; n++) {
    const hotBackBias = backFreq[n] >= 2 ? 10 : 0;
    const coldBackBias = backMissing[n] >= 6 ? 14 : backMissing[n] >= 3 ? 7 : 0;
    maps.blue[n] = (backFreq[n] || 0) * 14 + ((mlPrediction?.backBalls || []).includes(n) ? 24 : 0) + ((mysticalPrediction?.blueBalls || []).includes(n) ? 18 : 0) + (backMissing[n] || 0) * 5 + hotBackBias + coldBackBias;
  }

  return maps;
}

function buildAtomicStrategies(lotteryType, historyData, mlPrediction, mysticalPrediction) {
  const scoreMaps = computeAtomicScoreMaps(lotteryType, historyData, mlPrediction, mysticalPrediction);
  const mainCount = lotteryType === 'ssq' ? 6 : 5;
  const backCount = lotteryType === 'ssq' ? 1 : 2;
  const maxMain = lotteryType === 'ssq' ? 33 : 35;
  const maxBack = lotteryType === 'ssq' ? 16 : 12;
  const blueEntries = Object.entries(scoreMaps.blue).sort((a, b) => b[1] - a[1]);

  // ===== 双色球专属策略池 =====
  const ssqDefs = [
    { key: 'ml', name: 'ML模型推荐', source: 'ml', reason: ['基于RF+GB集成模型概率输出，三区+尾数+AC值特征工程'] },
    { key: 'mystical', name: '玄学规律推荐', source: 'mystical', reason: ['龙虎斗、五行生克、尾数玄机，风格化双色球选号'] },
    { key: 'hot', name: '红球热力追踪', source: 'rule', reason: ['近10期高频红球优先，三区热度加权，中短遗漏窗口确认'] },
    { key: 'cold', name: '冷号回补猎手', source: 'rule', reason: ['遗漏≥8期的冷号优先，边区冷号补偿，蓝球冷热切换'] },
    { key: 'balanced', name: '三区均衡锁定', source: 'rule', reason: ['奇偶3:3，三区2:2:2，和值75~130，尾数≥4种，AC≥8'] },
    { key: 'trend', name: '短周期动量', source: 'rule', reason: ['10期热度穿透30期均值，非中区节奏分加成'] },
    { key: 'zoneSum', name: '区间和值锚定', source: 'rule', reason: ['中区(12-22)核心区优先，尾数稀缺加成，和值±20约束'] },
    { key: 'pattern', name: '形态反转捕捉', source: 'rule', reason: ['3~8期回摆+15期超长遗漏+冷温断层+尾数稀缺+非中区偏置'] }
  ];

  // ===== 大乐透专属策略池 =====
  const dltDefs = [
    { key: 'ml', name: 'ML模型推荐', source: 'ml', reason: ['基于RF+GB集成模型概率输出，前区跨度+和值+连号特征工程'] },
    { key: 'mystical', name: '玄学规律推荐', source: 'mystical', reason: ['龙虎斗、五行生克适配大乐透前区5+后区2结构'] },
    { key: 'hot', name: '前区热点追踪', source: 'rule', reason: ['近10期前区热号，中区补权，遗漏≤2期加速确认'] },
    { key: 'cold', name: '前区冷号狙击', source: 'rule', reason: ['遗漏≥10期深度冷号优先，前区4~9期回摆窗口'] },
    { key: 'balanced', name: '跨度均衡控制', source: 'rule', reason: ['奇偶2:3或3:2，前区跨度25~32，和值60~110，尾数≥4种'] },
    { key: 'trend', name: '中段延续趋势', source: 'rule', reason: ['10~30主体区间延续，短热度×17-中频×1.5动量公式'] },
    { key: 'zoneSum', name: '前区区间锚定', source: 'rule', reason: ['前区三区(1-12/13-24/25-35)分布，主体区间10~30优先'] },
    { key: 'pattern', name: '遗漏形态捕捉', source: 'rule', reason: ['4~9期回摆+14期超冷+冷热断层+尾数稀缺+中区加成'] }
  ];

  const defs = lotteryType === 'ssq' ? ssqDefs : dltDefs;

  return defs.map(def => {
    const entries = Object.entries(scoreMaps[def.key] || {}).sort((a, b) => b[1] - a[1]);
    const mainBalls = buildBallSetFromScores(entries, mainCount, maxMain);
    const backBalls = buildBallSetFromScores(blueEntries, backCount, maxBack);
    const payload = lotteryType === 'ssq'
      ? { type: 'ssq', redBalls: mainBalls, blueBall: backBalls[0] || 1 }
      : { type: 'dlt', frontBalls: mainBalls, backBalls };
    const backLabel = lotteryType === 'ssq' ? '蓝球候选号' : '后区候选号';
    payload.reason = [...def.reason, scorePoolToReason(entries, 5, `${def.name}候选号`), scorePoolToReason(blueEntries, backCount === 1 ? 3 : 4, backLabel)];
    payload.atomicKey = def.key;
    payload.atomicName = def.name;
    payload.atomicSource = def.source;
    return payload;
  });
}

function mergeAtomicKeys(atomicStrategies, keys, lotteryType) {
  const picks = atomicStrategies.filter(item => keys.includes(item.atomicKey));
  const score = {};
  const backScore = {};
  picks.forEach((item, idx) => {
    const weight = picks.length - idx;
    const main = lotteryType === 'ssq' ? (item.redBalls || []) : (item.frontBalls || []);
    const back = lotteryType === 'ssq' ? [item.blueBall] : (item.backBalls || []);
    main.forEach((n, order) => { score[n] = (score[n] || 0) + (weight * 20 - order); });
    back.forEach((n, order) => { backScore[n] = (backScore[n] || 0) + (weight * 12 - order); });
  });
  return { score, backScore, picks };
}

function buildMasterFromAtomic(lotteryType, atomicStrategies, meta) {
  const mainCount = lotteryType === 'ssq' ? 6 : 5;
  const backCount = lotteryType === 'ssq' ? 1 : 2;
  const maxMain = lotteryType === 'ssq' ? 33 : 35;
  const maxBack = lotteryType === 'ssq' ? 16 : 12;
  const merged = mergeAtomicKeys(atomicStrategies, meta.keys, lotteryType);
  const mainBalls = filterAndFix(buildBallSetFromScores(Object.entries(merged.score).sort((a, b) => b[1] - a[1]), mainCount, maxMain), { peak: lotteryType === 'ssq' ? 102 : 82 }, { peak: lotteryType === 'ssq' ? 9 : 8 }, {}, lotteryType);
  const backBalls = buildBallSetFromScores(Object.entries(merged.backScore).sort((a, b) => b[1] - a[1]), backCount, maxBack);
  const payload = lotteryType === 'ssq'
    ? { type: 'ssq', redBalls: mainBalls, blueBall: backBalls[0] || 1 }
    : { type: 'dlt', frontBalls: mainBalls, backBalls };
  payload.reason = [
    ...meta.reason,
    `融合原子策略：${merged.picks.map(x => x.atomicName).join(' + ')}`,
    `主区结果：${mainBalls.map(n => String(n).padStart(2, '0')).join(' ')}`
  ];
  return createRecommendationEnvelope(meta, payload, []);
}

function evaluateStrategyHit(lotteryType, strategySet, drawRecord) {
  if (!strategySet || !drawRecord) return { totalHit: 0 };
  if (lotteryType === 'ssq') {
    const redHit = (strategySet.redBalls || []).filter(n => (drawRecord.redNumbers || []).includes(n)).length;
    const blueHit = strategySet.blueBall === drawRecord.blueNumber ? 1 : 0;
    return { redHit, blueHit, totalHit: redHit + blueHit };
  }
  const frontHit = (strategySet.frontBalls || []).filter(n => (drawRecord.frontNumbers || []).includes(n)).length;
  const backHit = (strategySet.backBalls || []).filter(n => (drawRecord.backNumbers || []).includes(n)).length;
  return { frontHit, backHit, totalHit: frontHit + backHit };
}

function scoreAtomicStrategyByHistory(lotteryType, strategy, historyData) {
  const usable = Array.isArray(historyData) ? historyData.slice(0, 30) : [];
  if (usable.length === 0) {
    return { avgHit: 0, bestHit: 0, sampleSize: 0, score: 0 };
  }
  const hits = usable.map(draw => evaluateStrategyHit(lotteryType, strategy, draw));
  const totalHit = hits.reduce((sum, item) => sum + (item.totalHit || 0), 0);
  const avgHit = totalHit / hits.length;
  const bestHit = Math.max(...hits.map(item => item.totalHit || 0), 0);
  const highHitCount = hits.filter(item => (item.totalHit || 0) >= (lotteryType === 'ssq' ? 3 : 2)).length;
  const score = Number((avgHit * 100 + bestHit * 12 + highHitCount * 6).toFixed(2));
  return { avgHit: Number(avgHit.toFixed(2)), bestHit, sampleSize: hits.length, score };
}

function generateRankedStrategyBoard(lotteryType, historyData, mlPrediction, mysticalPrediction) {
  const atomicStrategies = buildAtomicStrategies(lotteryType, historyData, mlPrediction, mysticalPrediction);
  const ssqBadges = {
    ml: '🤖 ML模型', mystical: '🔮 玄学规律', hot: '🔥 红球热力',
    cold: '❄️ 冷号猎手', balanced: '🛡️ 三区均衡', trend: '📈 短周期动量',
    zoneSum: '🧭 区间和值', pattern: '🧩 形态反转'
  };
  const dltBadges = {
    ml: '🤖 ML模型', mystical: '🔮 玄学规律', hot: '🔥 前区热点',
    cold: '❄️ 前区冷号', balanced: '🛡️ 跨度均衡', trend: '📈 中段延续',
    zoneSum: '🧭 前区区间', pattern: '🧩 遗漏形态'
  };
  const strategyBadgeMap = lotteryType === 'ssq' ? ssqBadges : dltBadges;

  const rankedStrategies = atomicStrategies.map((item, index) => {
    const perf = scoreAtomicStrategyByHistory(lotteryType, item, historyData);
    return {
      ...item,
      masterKey: item.atomicKey,
      masterName: item.atomicName,
      badge: strategyBadgeMap[item.atomicKey] || `策略 ${index + 1}`,
      summary: `近 ${perf.sampleSize} 期平均命中 ${perf.avgHit}，最佳命中 ${perf.bestHit}`,
      role: item.atomicSource || 'rule',
      rankScore: perf.score,
      performance: perf,
      reason: [
        `历史表现：近 ${perf.sampleSize} 期平均命中 ${perf.avgHit}，最佳命中 ${perf.bestHit}`,
        ...((Array.isArray(item.reason) ? item.reason : []).slice(0, 4))
      ]
    };
  }).sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));

  return { atomicStrategies, rankedStrategies };
}

function generateSmartRecommendation(lotteryType, historyData, mlPrediction, mysticalPrediction) {
  const recommendations = [];
  const recent10 = historyData.slice(0, 10);
  const recent30 = historyData.slice(0, 30);
  const recent50 = historyData.slice(0, 50);

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

    // 热号：出现3次以上 | 温号：出现1-2次 | 遗漏：0次
    const hotReds = [];
    const warmReds = [];
    const missingReds = [];
    for (let i = 1; i <= 33; i++) {
      if (redFreq[i] >= 3) hotReds.push(i);
      else if (redFreq[i] >= 1) warmReds.push(i);
      else missingReds.push(i);
    }

    // 2. 遗漏期数精确计算（最近50期）
    const redMissing = computeMissingPeriods(1, 33, recent50, 'redNumbers');

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

    // 6. 和值区间分布（从真实历史统计）
    const sumStats = computeSumStats(recent50, 'redNumbers');

    // 7. AC值分布（从真实历史统计）
    const acStats = computeACStats(recent50, 'redNumbers');

    // 8. 尾数分布统计
    const digitStats = computeDigitStats(recent30, 'redNumbers');

    // 生成5组策略：第1组ML，第2组玄学，第3-5组规则
    const strategies = [];

    // 第1组：ML模型预测
    if (mlPrediction && mlPrediction.type === 'ssq') {
      const mlRed = mlPrediction.redBalls || [];
      const mlBlue = mlPrediction.blueBall || 8;
      const mlReasons = [];
      if (mlPrediction.modelAuc) mlReasons.push(`ML模型(AUC=${mlPrediction.modelAuc})`);
      if (mlPrediction.probabilities) {
        const top5Prob = Object.entries(mlPrediction.probabilities)
          .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))
          .slice(0, 5)
          .map(([n]) => parseInt(n));
        mlReasons.push(`概率Top5: ${top5Prob.join(',')}`);
      }
      strategies.push({ name: 'ML模型推荐', weight: 'ml', redBalls: mlRed, blueBall: mlBlue, reasons: mlReasons });
    }

    // 第2组：玄学规律推荐
    if (mysticalPrediction && mysticalPrediction.source === 'mystical') {
      strategies.push({
        name: '玄学规律',
        weight: 'mystical',
        redBalls: mysticalPrediction.redBalls || [],
        blueBall: (mysticalPrediction.blueBalls || [])[0] || 8,
        reasons: mysticalPrediction.reasons || []
      });
    }

    // 第3-6组：规则策略（4组）
    strategies.push({ name: '热号为主', weight: 'hot' });
    strategies.push({ name: '均衡稳健', weight: 'balanced' });
    strategies.push({ name: '冷号回补', weight: 'cold' });
    strategies.push({ name: '区间精选', weight: 'zone' });

    strategies.forEach((strategy, idx) => {
      // ML和玄学跳过生成（已直接构造）
      if (strategy.weight === 'ml' || strategy.weight === 'mystical') {
        recommendations.push({
          setIndex: idx,
          redBalls: strategy.redBalls,
          blueBall: strategy.blueBall,
          reason: strategy.reasons,
        });
        return;
      }
      const result = generateSSQSet(
        strategy, hotReds, warmReds, missingReds,
        consecutiveRate, avgOdd, zoneCount, blueFreq,
        redMissing, sumStats, acStats, digitStats
      );
      recommendations.push(result);
    });

  } else if (lotteryType === 'dlt') {
    // ===== 大乐透分析 =====

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

    // 遗漏期数（前区）
    const frontMissing = computeMissingPeriods(1, 35, recent50, 'frontNumbers');
    // 遗漏期数（后区）
    const backMissing = computeMissingPeriods(1, 12, recent50, 'backNumbers');

    // 连号统计
    let consecutiveCount = 0;
    recent10.forEach(record => {
      if (hasConsecutive(record.frontNumbers)) consecutiveCount++;
    });
    const consecutiveRate = consecutiveCount / recent10.length;

    // 和值统计（前区）
    const frontSumStats = computeSumStats(recent50, 'frontNumbers');

    // AC值统计（前区）
    const frontACStats = computeACStats(recent50, 'frontNumbers');

    // 尾数统计（前区）
    const frontDigitStats = computeDigitStats(recent30, 'frontNumbers');

    const strategies = [];

    // 第1组：ML模型预测
    if (mlPrediction && mlPrediction.type === 'dlt') {
      const mlFront = mlPrediction.frontBalls || [];
      const mlBack = mlPrediction.backBalls || [];
      const mlReasons = [];
      if (mlPrediction.modelAuc) mlReasons.push(`ML模型(AUC=${mlPrediction.modelAuc})`);
      strategies.push({ name: 'ML模型推荐', weight: 'ml', frontBalls: mlFront, backBalls: mlBack, reasons: mlReasons });
    }

    // 第2组：玄学规律推荐
    if (mysticalPrediction && mysticalPrediction.source === 'mystical') {
      strategies.push({
        name: '玄学规律',
        weight: 'mystical',
        frontBalls: mysticalPrediction.redBalls || [],
        backBalls: mysticalPrediction.blueBalls || [],
        reasons: mysticalPrediction.reasons || []
      });
    }

    // 第3-6组：规则策略（4组）
    strategies.push({ name: '热号追踪', weight: 'hot' });
    strategies.push({ name: '均衡稳健', weight: 'balanced' });
    strategies.push({ name: '冷号回补', weight: 'cold' });
    strategies.push({ name: '和值优选', weight: 'sum' });
    strategies.push({ name: '区间精选', weight: 'zone' });
    strategies.push({ name: '连号组合', weight: 'consecutive' });
    strategies.push({ name: '形态反转', weight: 'pattern' });

    strategies.forEach((strategy, idx) => {
      if (strategy.weight === 'ml' || strategy.weight === 'mystical') {
        recommendations.push({
          setIndex: idx,
          frontBalls: strategy.frontBalls,
          backBalls: strategy.backBalls,
          reason: strategy.reasons,
        });
        return;
      }
      const result = generateDLTSet(
        strategy, hotFronts, warmFronts, missingFronts,
        hotBacks, backFreq, consecutiveRate,
        frontMissing, backMissing, frontSumStats, frontACStats, frontDigitStats
      );
      recommendations.push(result);
    });
  }

  return recommendations;
}

// ========== 双色球生成 ==========
function generateSSQSet(strategy, hotReds, warmReds, missingReds,
                         consecutiveRate, avgOdd, zoneCount, blueFreq,
                         redMissing, sumStats, acStats, digitStats) {
  const reasons = [strategy.name + '策略'];
  let redBalls = [];
  let blueBall;

  // ---------- 候选池加权 ----------
  // 遗漏值越大的球，权重越高（冷号回补理论）
  const missingWeight = (n) => Math.min(redMissing[n] / 10, 3); // 上限3倍
  const hotWeight = (n) => hotReds.includes(n) ? 2.5 : warmReds.includes(n) ? 1.5 : 1;

  switch (strategy.weight) {
    case 'hot':
      {
        // 热号为主：3-4个热号 + 其余从加权池补
        const hotPick = pickRandom(hotReds, Math.min(4, hotReds.length));
        const pool = [...hotReds, ...warmReds, ...missingReds];
        const weighted = pool
          .filter(n => !hotPick.includes(n))
          .sort((a, b) => missingWeight(b) - missingWeight(a));
        const warmPick = pickRandom(weighted.slice(0, Math.min(6, weighted.length)), 6 - hotPick.length);
        redBalls = [...hotPick, ...warmPick].slice(0, 6);
        redBalls = filterAndFix(redBalls, sumStats, acStats, digitStats, 'ssq');
        reasons.push(`热号${hotPick.length}个：${hotPick.join(',')}`);
        reasons.push('近10期高频号码，中奖概率较高');
      }
      break;

    case 'balanced':
      {
        // 均衡型：2热+2温+2冷，各项指标约束
        const b1 = pickRandom(hotReds, Math.min(2, hotReds.length));
        const b2 = pickRandom(warmReds, Math.min(2, warmReds.length));
        const b3 = pickRandom(missingReds, Math.min(2, missingReds.length));
        redBalls = [...b1, ...b2, ...b3];
        redBalls = filterAndFix(redBalls, sumStats, acStats, digitStats, 'ssq');
        const oddC = redBalls.filter(n => n % 2 === 1).length;
        if (oddC < 2 || oddC > 4) {
          redBalls = rebalanceOddEven(redBalls, 3);
          redBalls = filterAndFix(redBalls, sumStats, acStats, digitStats, 'ssq');
        }
        reasons.push('热温冷各取2个，平衡分布');
        reasons.push('奇偶比3:3，最稳定组合');
        reasons.push(`AC值${calcAC(redBalls)}，和值${redBalls.reduce((a,b)=>a+b,0)}`);
      }
      break;

    case 'cold':
      {
        // 冷号回补：选遗漏大的球，配合遗漏约束
        const sorted = [...missingReds, ...warmReds].sort((a, b) => missingWeight(b) - missingWeight(a));
        const coldPick = sorted.slice(0, Math.min(4, sorted.length));
        const pool = [...missingReds, ...warmReds, ...hotReds];
        const extra = pickRandom(pool.filter(n => !coldPick.includes(n)), 6 - coldPick.length);
        redBalls = [...coldPick, ...extra];
        redBalls = filterAndFix(redBalls, sumStats, acStats, digitStats, 'ssq');
        const maxMissing = Math.max(...redBalls.map(n => redMissing[n]));
        reasons.push(`冷号回补，遗漏最大值${maxMissing}期`);
        reasons.push('遗漏期数大的号码近期回补概率较高');
      }
      break;

    case 'consecutive':
      {
        // 连号组合：按历史出现率控制连号数量
        redBalls = generateWithConsecutive(hotReds, warmReds, missingReds);
        redBalls = filterAndFix(redBalls, sumStats, acStats, digitStats, 'ssq');
        const hasConsec = hasConsecutive(redBalls) ? '有连号' : '无连号';
        reasons.push(`${hasConsec}，历史出现率${(consecutiveRate*100).toFixed(0)}%`);
      }
      break;

    case 'zone':
      {
        // 区间精选：三区均衡 + 和值约束
        redBalls = generateByZone(hotReds, warmReds, missingReds, zoneCount);
        redBalls = filterAndFix(redBalls, sumStats, acStats, digitStats, 'ssq');
        const z1 = redBalls.filter(n => n <= 11).length;
        const z2 = redBalls.filter(n => n > 11 && n <= 22).length;
        const z3 = redBalls.filter(n => n > 22).length;
        reasons.push(`三区比${z1}:${z2}:${z3}`);
        reasons.push('区间分布均衡，覆盖面广');
        reasons.push(`和值${redBalls.reduce((a,b)=>a+b,0)}（历史高频区间${sumStats.peak}±15）`);
      }
      break;
  }

  // 排序
  redBalls.sort((a, b) => a - b);

  // 蓝球：热号优先 + 遗漏约束
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

// ========== 大乐透生成（完整版：含区间、形态反转）==========
function generateDLTSet(strategy, hotFronts, warmFronts, missingFronts,
                        hotBacks, backFreq, consecutiveRate,
                        frontMissing, backMissing, frontSumStats, frontACStats, frontDigitStats) {
  const reasons = [strategy.name + '策略'];
  let frontBalls = [];
  let backBalls = [];

  // 遗漏权重（前区）
  const missingWeight = (n) => Math.min(frontMissing[n] / 8, 3);

  switch (strategy.weight) {
    case 'hot':
      {
        const fh = pickRandom(hotFronts, Math.min(3, hotFronts.length));
        const pool = [...hotFronts, ...warmFronts, ...missingFronts].sort((a, b) => missingWeight(b) - missingWeight(a));
        const extra = pickRandom(pool.filter(n => !fh.includes(n)), 5 - fh.length);
        frontBalls = [...fh, ...extra];
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        reasons.push(`前区热号${fh.length}个`);
        reasons.push(`AC值${calcAC(frontBalls)}`);
      }
      break;

    case 'balanced':
      {
        const b1 = pickRandom(hotFronts, 2);
        const b2 = pickRandom(warmFronts, 2);
        const b3 = pickRandom(missingFronts, 1);
        frontBalls = [...b1, ...b2, ...b3];
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        reasons.push('前区热温冷均衡');
        reasons.push(`和值${frontBalls.reduce((a,b)=>a+b,0)}（历史高频${frontSumStats.peak}±15）`);
      }
      break;

    case 'cold':
      {
        const sorted = [...missingFronts, ...warmFronts].sort((a, b) => missingWeight(b) - missingWeight(a));
        const coldPick = sorted.slice(0, Math.min(3, sorted.length));
        const extra = pickRandom(sorted.filter(n => !coldPick.includes(n)), 5 - coldPick.length);
        frontBalls = [...coldPick, ...extra];
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        const maxMissing = Math.max(...frontBalls.map(n => frontMissing[n]));
        reasons.push(`前区冷号回补，遗漏最大值${maxMissing}期`);
      }
      break;

    case 'consecutive':
      {
        frontBalls = generateDLTWithConsecutive(hotFronts, warmFronts, missingFronts);
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        const hasConsec = hasConsecutive(frontBalls) ? '有连号' : '无连号';
        reasons.push(`${hasConsec}，出现率${(consecutiveRate*100).toFixed(0)}%`);
      }
      break;

    case 'sum':
      {
        // 和值在历史峰值±15区间内
        frontBalls = generateBySumAdv(
          hotFronts, warmFronts, missingFronts,
          frontSumStats.peak - 15, frontSumStats.peak + 15,
          frontMissing
        );
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        const sum = frontBalls.reduce((a, b) => a + b, 0);
        reasons.push(`和值${sum}，在黄金区间${frontSumStats.peak}±15`);
      }
      break;

    case 'zone':
      {
        // 大乐透专属区间精选：三区(1-12/13-24/25-35)，主体区间10~30优先
        frontBalls = generateByZoneDLT(hotFronts, warmFronts, missingFronts, frontMissing);
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        const z1 = frontBalls.filter(n => n <= 12).length;
        const z2 = frontBalls.filter(n => n > 12 && n <= 24).length;
        const z3 = frontBalls.filter(n => n > 24).length;
        const sum = frontBalls.reduce((a, b) => a + b, 0);
        reasons.push(`前区三区比${z1}:${z2}:${z3}`);
        reasons.push(`和值${sum}，主体区间10~30覆盖`);
      }
      break;

    case 'pattern':
      {
        // 大乐透专属形态反转：4~9期回摆 + 14期超冷 + 冷热断层
        const patternPick = generateDLTPattern(missingFronts, warmFronts, hotFronts, frontMissing);
        frontBalls = patternPick;
        frontBalls = filterAndFix(frontBalls, frontSumStats, frontACStats, frontDigitStats, 'dlt');
        const avgMissing = Math.round(frontBalls.reduce((s, n) => s + frontMissing[n], 0) / 5);
        reasons.push(`遗漏形态选号，平均遗漏${avgMissing}期`);
        reasons.push(`融合4~9期回摆与14+超冷形态`);
      }
      break;
  }

  frontBalls.sort((a, b) => a - b);

  // 后区：热号优先 + 遗漏约束
  const allBacks = Array.from({ length: 12 }, (_, i) => i + 1);
  const hotBackPool = [...hotBacks];
  const coldBackPool = allBacks.filter(n => !hotBacks.includes(n))
    .sort((a, b) => backMissing[b] - backMissing[a]);

  if (hotBackPool.length >= 2) {
    backBalls = pickRandom(hotBackPool, 2);
  } else if (hotBackPool.length === 1) {
    backBalls = [hotBackPool[0], coldBackPool[0] || Math.floor(Math.random() * 12) + 1];
  } else {
    backBalls = [coldBackPool[0] || 1, coldBackPool[1] || 2];
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

// ========== 新增统计函数 ==========

/**
 * 计算每个球的遗漏期数（最近N期未出现的次数）
 * @param {number} min - 最小球号
 * @param {number} max - 最大球号
 * @param {Array} recentData - 最近N期数据
 * @param {string} field - 字段名
 * @returns {Object} - {球号: 遗漏期数}
 */
function computeMissingPeriods(min, max, recentData, field) {
  const result = {};
  for (let n = min; n <= max; n++) {
    let missing = 0;
    for (const record of recentData) {
      const nums = record[field] || [];
      if (!nums.includes(n)) {
        missing++;
      } else {
        break; // 一旦出现，遗漏计数停止
      }
    }
    result[n] = missing;
  }
  return result;
}

/**
 * 计算AC值（号码复杂度）
 * AC值 = 不同差值数量 / (号码数-1)
 * SSQ有效范围: 8-10, 实际开奖常见8-10
 * DLT前区有效范围: 6-10
 */
function calcAC(balls) {
  if (!balls || balls.length < 2) return 0;
  const diffs = new Set();
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      diffs.add(Math.abs(balls[i] - balls[j]));
    }
  }
  return diffs.size - (balls.length - 1);
}

/**
 * 从历史数据统计和值分布
 * 返回：{峰值, 范围, 各区间命中数}
 */
function computeSumStats(recentData, field) {
  if (recentData.length === 0) {
    return { peak: 100, range: [70, 130] };
  }
  const sums = recentData.map(r => (r[field] || []).reduce((a, b) => a + b, 0));
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  // 统计分布
  const ranges = {
    '<70': 0, '70-89': 0, '90-109': 0, '110-130': 0, '>130': 0
  };
  sums.forEach(s => {
    if (s < 70) ranges['<70']++;
    else if (s <= 89) ranges['70-89']++;
    else if (s <= 109) ranges['90-109']++;
    else if (s <= 130) ranges['110-130']++;
    else ranges['>130']++;
  });
  // 找最高频区间
  const peak = Math.round(avgSum);
  return { peak, ranges };
}

/**
 * 从历史数据统计AC值分布
 */
function computeACStats(recentData, field) {
  if (recentData.length === 0) {
    return { peak: 9, validRange: [8, 10] };
  }
  const acValues = recentData.map(r => calcAC(r[field] || []));
  const freq = {};
  acValues.forEach(ac => { freq[ac] = (freq[ac] || 0) + 1; });
  let peak = 9;
  let maxCount = 0;
  Object.entries(freq).forEach(([ac, count]) => {
    if (count > maxCount) { maxCount = count; peak = parseInt(ac); }
  });
  return { peak, freq };
}

/**
 * 从历史数据统计尾数出现频率
 * @returns {Object} {尾数: 出现次数}
 */
function computeDigitStats(recentData, field) {
  const digitFreq = {};
  recentData.forEach(record => {
    (record[field] || []).forEach(n => {
      const d = n % 10;
      digitFreq[d] = (digitFreq[d] || 0) + 1;
    });
  });
  return digitFreq;
}

/**
 * 核心过滤修复函数
 * 对生成的红球组合做约束修正：
 * 1. AC值约束：SSQ在[6,10]，DLT在[5,10]
 * 2. 尾数约束：覆盖4种以上不同尾数
 * 3. 和值约束：在历史峰值±20内
 * 4. 连号约束：最多2组
 */
function filterAndFix(balls, sumStats, acStats, digitStats, type) {
  const maxAttempts = 30;
  let result = [...balls];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ac = calcAC(result);
    const sum = result.reduce((a, b) => a + b, 0);
    const digits = new Set(result.map(n => n % 10));
    const consecutive = countConsecutivePairs(result);

    // 约束条件
    const acRange = type === 'ssq' ? [6, 11] : [5, 11];
    const sumRange = [sumStats.peak - 20, sumStats.peak + 20];
    const acOk = ac >= acRange[0] && ac <= acRange[1];
    const sumOk = sum >= sumRange[0] && sum <= sumRange[1];
    const digitOk = digits.size >= 4;
    const consecOk = consecutive <= 2;

    if (acOk && sumOk && digitOk && consecOk) {
      break; // 全部满足
    }

    // 修复策略
    if (!acOk) {
      // AC值过低：替换最小/最大的球来增加差异
      result = fixAC(result, acStats.peak);
    }
    if (!sumOk) {
      // 和值过高/过低：替换边界球
      result = fixSum(result, sumStats.peak);
    }
    if (!digitOk) {
      // 尾数重复过多：替换以增加尾数种类
      result = fixDigits(result, digitStats);
    }
    if (!consecOk) {
      // 连号过多：拆分连号
      result = fixConsecutive(result);
    }
  }

  // 最终去重并排序
  result = [...new Set(result)].sort((a, b) => a - b);

  // 如果去重后数量不够，补充
  const maxNum = type === 'ssq' ? 33 : 35;
  const count = type === 'ssq' ? 6 : 5;
  while (result.length < count) {
    const r = Math.floor(Math.random() * maxNum) + 1;
    if (!result.includes(r)) result.push(r);
  }

  return result.slice(0, count);
}

function countConsecutivePairs(balls) {
  const sorted = [...balls].sort((a, b) => a - b);
  let pairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) pairs++;
  }
  return pairs;
}

function fixAC(balls, targetAC) {
  const result = [...balls];
  const currentAC = calcAC(result);
  if (currentAC < 6) {
    // AC过低：替换最内侧的球，往外扩
    const sorted = [...result].sort((a, b) => a - b);
    const maxNum = balls.length === 6 ? 33 : 35;
    const minNum = 1;
    const mid = Math.floor(sorted.length / 2);
    // 替换中间偏小的球，往大方向移动
    const idx = result.indexOf(sorted[mid]);
    let newVal = sorted[mid] + 2;
    while (result.includes(newVal) && newVal <= maxNum) newVal++;
    if (newVal <= maxNum) result[idx] = newVal;
  } else if (currentAC > 10) {
    // AC过高：替换最大或最小球，往中间靠
    const sorted = [...result].sort((a, b) => a - b);
    const idx = result.indexOf(sorted[0]);
    let newVal = sorted[0] + 1;
    while (result.includes(newVal)) newVal++;
    if (newVal <= 15) result[idx] = newVal;
  }
  return [...new Set(result)];
}

function fixSum(balls, targetSum) {
  const result = [...balls];
  const currentSum = result.reduce((a, b) => a + b, 0);
  const diff = targetSum - currentSum;
  const maxNum = balls.length === 6 ? 33 : 35;

  if (diff > 0) {
    // 和值偏低：把一个较小的球换大
    const sorted = [...result].sort((a, b) => a - b);
    const idx = result.indexOf(sorted[0]);
    let newVal = sorted[0] + Math.min(diff, 5);
    while (result.includes(newVal) && newVal <= maxNum) newVal++;
    if (newVal <= maxNum && !result.includes(newVal)) result[idx] = newVal;
  } else {
    // 和值偏高：把一个较大的球换小
    const sorted = [...result].sort((a, b) => b - a);
    const idx = result.indexOf(sorted[0]);
    let newVal = sorted[0] + diff;
    while (result.includes(newVal) && newVal >= 1) newVal--;
    if (newVal >= 1 && !result.includes(newVal)) result[idx] = newVal;
  }
  return [...new Set(result)];
}

function fixDigits(balls, digitStats) {
  const result = [...balls];
  const digits = new Set(result.map(n => n % 10));

  // 找出缺少的尾数
  const usedDigits = [...digits];
  const maxNum = balls.length === 6 ? 33 : 35;
  for (let d = 0; d <= 9 && digits.size < 4; d++) {
    if (!digits.has(d)) {
      // 找一个有该尾数的球来替换
      const candidate = result.find(n => {
        const curD = n % 10;
        return !digits.has(curD) || [...digits].filter(x => x === curD).length > 1;
      });
      if (candidate !== undefined) {
        const idx = result.indexOf(candidate);
        // 找一个有目标尾数的号
        let newVal = d;
        while ((result.includes(newVal) || newVal > maxNum) && newVal <= maxNum) newVal += 10;
        if (newVal <= maxNum && !result.includes(newVal)) {
          result[idx] = newVal;
          digits.add(d);
        }
      }
    }
  }
  return [...new Set(result)];
}

function fixConsecutive(balls) {
  const result = [...balls].sort((a, b) => a - b);
  // 找到第一组连号，拆分
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i + 1] - result[i] === 1) {
      const maxNum = balls.length === 6 ? 33 : 35;
      let newVal = result[i] + 5;
      while (result.includes(newVal) && newVal <= maxNum) newVal++;
      if (newVal <= maxNum) {
        result[i + 1] = newVal;
        break;
      }
    }
  }
  return [...new Set(result)];
}

// ========== 生成函数（增强版）==========

function generateWithConsecutive(hotReds, warmReds, missingReds) {
  const result = [];
  const maxNum = 33;
  const start = Math.floor(Math.random() * 28) + 1;
  result.push(start, start + 1);

  const pool = [...hotReds, ...warmReds, ...missingReds]
    .filter(n => n !== start && n !== start + 1);
  const extra = pickRandom(pool.length > 0 ? pool :
    Array.from({ length: 31 }, (_, i) => i + 1).filter(n => n !== start && n !== start + 1), 4);
  result.push(...extra);

  while (result.length < 6) {
    const r = Math.floor(Math.random() * maxNum) + 1;
    if (!result.includes(r)) result.push(r);
  }

  return [...new Set(result)].slice(0, 6);
}

function generateDLTWithConsecutive(hotFronts, warmFronts, missingFronts) {
  const result = [];
  const maxNum = 35;
  const start = Math.floor(Math.random() * 30) + 1;
  result.push(start, start + 1);

  const pool = [...hotFronts, ...warmFronts, ...missingFronts]
    .filter(n => n !== start && n !== start + 1);
  const extra = pickRandom(pool.length > 0 ? pool :
    Array.from({ length: 33 }, (_, i) => i + 1).filter(n => n !== start && n !== start + 1), 3);
  result.push(...extra);

  while (result.length < 5) {
    const r = Math.floor(Math.random() * maxNum) + 1;
    if (!result.includes(r)) result.push(r);
  }

  return [...new Set(result)].slice(0, 5);
}

function generateByZone(hotReds, warmReds, missingReds, zoneCount) {
  const result = [];
  const maxNum = 33;

  // 一区 1-11
  const z1Pool = [...hotReds, ...warmReds, ...missingReds].filter(n => n <= 11);
  result.push(...pickRandom(z1Pool.length > 0 ? z1Pool : Array.from({ length: 11 }, (_, i) => i + 1), 2));

  // 二区 12-22
  const z2Pool = [...hotReds, ...warmReds, ...missingReds].filter(n => n > 11 && n <= 22);
  result.push(...pickRandom(z2Pool.length > 0 ? z2Pool : Array.from({ length: 11 }, (_, i) => i + 12), 2));

  // 三区 23-33
  const z3Pool = [...hotReds, ...warmReds, ...missingReds].filter(n => n > 22);
  result.push(...pickRandom(z3Pool.length > 0 ? z3Pool : Array.from({ length: 11 }, (_, i) => i + 23), 2));

  while (result.length < 6) {
    const r = Math.floor(Math.random() * maxNum) + 1;
    if (!result.includes(r)) result.push(r);
  }

  return [...new Set(result)].slice(0, 6);
}

function generateBySumAdv(hotFronts, warmFronts, missingFronts, minSum, maxSum, frontMissing) {
  const targetSum = Math.round((minSum + maxSum) / 2);
  let best = null;
  let bestDiff = Infinity;
  const maxNum = 35;
  const pool = [...hotFronts, ...warmFronts, ...missingFronts];

  for (let attempt = 0; attempt < 80; attempt++) {
    let picked = pickRandom(pool.length >= 5 ? pool :
      Array.from({ length: 35 }, (_, i) => i + 1), 5);
    while (picked.length < 5) {
      const r = Math.floor(Math.random() * maxNum) + 1;
      if (!picked.includes(r)) picked.push(r);
    }
    const sum = picked.reduce((a, b) => a + b, 0);
    const diff = Math.abs(sum - targetSum);
    if (sum >= minSum && sum <= maxSum && diff < bestDiff) {
      best = picked;
      bestDiff = diff;
      if (diff === 0) break;
    }
  }
  return best || pickRandom(Array.from({ length: 35 }, (_, i) => i + 1), 5);
}

function generateByZoneDLT(hotFronts, warmFronts, missingFronts, frontMissing) {
  const result = [];
  const maxNum = 35;
  const pool = [...hotFronts, ...warmFronts, ...missingFronts];

  // 大乐透三区：1-12 / 13-24 / 25-35
  // 主体区间10~30优先，取2+2+1或1+2+2
  const z1Pool = pool.filter(n => n <= 12);
  const z2Pool = pool.filter(n => n > 12 && n <= 24);
  const z3Pool = pool.filter(n => n > 24);

  // 中区优先取2个
  result.push(...pickRandom(z2Pool.length > 0 ? z2Pool : Array.from({ length: 12 }, (_, i) => i + 13), 2));

  // 一区和三区各取1-2个
  const remainCount = 3;
  const z1Count = Math.random() > 0.5 ? 2 : 1;
  const z3Count = remainCount - z1Count;

  result.push(...pickRandom(z1Pool.length > 0 ? z1Pool : Array.from({ length: 12 }, (_, i) => i + 1), z1Count));
  result.push(...pickRandom(z3Pool.length > 0 ? z3Pool : Array.from({ length: 11 }, (_, i) => i + 25), z3Count));

  // 补够5个，优先主体区间10~30
  while (result.length < 5) {
    const r = Math.floor(Math.random() * 21) + 10; // 10~30
    if (!result.includes(r)) result.push(r);
  }

  return [...new Set(result)].slice(0, 5);
}

function generateDLTPattern(missingFronts, warmFronts, hotFronts, frontMissing) {
  // 大乐透形态反转：融合多种遗漏形态
  const result = [];
  const maxNum = 35;

  // 回摆信号：遗漏4~9期的号码
  const reboundPool = [...missingFronts, ...warmFronts, ...hotFronts]
    .filter(n => frontMissing[n] >= 4 && frontMissing[n] <= 9);

  // 超冷信号：遗漏14期以上
  const superCold = [...missingFronts]
    .filter(n => frontMissing[n] >= 14)
    .sort((a, b) => frontMissing[b] - frontMissing[a]);

  // 冷热断层：冷号+温号交替
  const coldWarmMix = [...missingFronts, ...warmFronts]
    .filter(n => frontMissing[n] >= 2 && frontMissing[n] <= 11)
    .sort((a, b) => frontMissing[b] - frontMissing[a]);

  // 构建组合
  if (reboundPool.length >= 2) {
    result.push(...pickRandom(reboundPool, 2));
  }
  if (superCold.length >= 1 && result.length < 5) {
    result.push(pickRandom(superCold, 1)[0]);
  }
  // 补充冷温交替号
  const remaining = coldWarmMix.filter(n => !result.includes(n));
  if (remaining.length > 0 && result.length < 5) {
    result.push(...pickRandom(remaining, Math.min(2, remaining.length)));
  }
  // 最终补够
  const allPool = [...missingFronts, ...warmFronts, ...hotFronts];
  while (result.length < 5) {
    const r = pickRandom(allPool, 1)[0];
    if (r && !result.includes(r)) result.push(r);
  }

  return [...new Set(result)].slice(0, 5);
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
