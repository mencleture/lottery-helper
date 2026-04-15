# 彩票助手 更新日志

## v1.3.1 (2026-04-15)

### 新增：策略性能排序与历史回溯页联动

- **策略性能回测排序**：预测页策略卡片按历史回测平均命中数降序排列，与历史回溯页策略排名一致
- **回测数据联动**：`backfillStrategyPerformance()` 调用 `buildStrategyBacktest()` 聚合60期回测结果，填充每个策略的 `avgHit`、`bestHit`、`totalPeriods`
- **排序逻辑**：先按 `avgHit` 降序，相同则按 `bestHit` 降序
- **性能数据持久化**：回测结果同步写回 `state.allSets`，确保 `rebuildMasterRecommendations()` 重建时保留性能数据

### 修复

- 修复 `renderRecommendationPanel()` 内部调用 `rebuildMasterRecommendations()` 导致性能数据丢失的问题
- 修复切换策略时排序重置为生成顺序的问题

### 技术变更

- `rebuildMasterRecommendations()` 新增性能数据保存/恢复机制
- `backfillStrategyPerformance()` 新增 `state.allSets` 同步写入
- 移除冗余的 `dist-*` 构建目录，仅保留单一 `dist` 输出

### 致谢

UI 设计灵感参考 [Double-Color-Ball-AI](https://github.com/sinyu1012/Double-Color-Ball-AI) 项目

---

## v1.2.0 (2026-04-13)

### 新增：4模型加权集成 ML 预测

- **新增模型：** LightGBM + XGBoost，与原有 RF + GB 组成 4 模型加权集成
- **推理引擎升级：** `ml/predict.py` v2.0 支持加载 4 个 joblib 模型文件，真实加载模型做预测（非特征重要性估算）
- **加权策略：** 4 个模型的预测概率按 AUC 比例加权（自动计算权重）
- **时间序列 CV：** 新增 5-fold TimeSeriesSplit 交叉验证，更真实的离线评估
- **概率校准：** Top-N 信号强度量化（`signal` 字段：Top1 - TopN 概率差）

### 模型性能对比

| 模型 | SSQ AUC | DLT AUC |
|------|---------|---------|
| Random Forest | 0.773 | 0.805 |
| Gradient Boosting | 0.771 | 0.824 |
| LightGBM | 0.751 | 0.813 |
| XGBoost | 0.755 | 0.803 |
| **加权集成** | **0.767** | **0.817** |
| **CV 均值** | **0.777±0.024** | **0.804±0.024** |

### 回测结果

| 彩种 | 回测10期均中 | 满分 |
|------|-------------|------|
| 双色球 | 5.9 | 6 |
| 大乐透 | 4.9 | 5 |

### 技术变更

- `train.py` v2.0：训练 RF+GB+LGB+XGB，保存 joblib 模型文件
- `ml/predict.py` v2.0：加载 joblib 模型做真实推理
- 模型文件：`{type}_rf.joblib`, `{type}_gb.joblib`, `{type}_lgb.joblib`, `{type}_xgb.joblib`
- `package.json` files 配置补全 ml/、models/、data/ 目录
- app.asar 打包内容完整（84.7MB，含4模型+数据）

---

## v1.1.2 (2026-04-13)

### 新增：ML 模型接入 Electron

- `main.js` 新增 `ensureMlSetup()` 启动时从 asar 复制 ml/ 目录到 userData
- `getModelPrediction()` 调用 Python ML 模型生成推荐
- `generateSmartRecommendation()` 第1组用 ML，第2-5组用规则策略
- `predict.py` 支持从 Electron 真实数据文件读取历史记录
- `package.json` files 加入 ml/、models/、data/ 目录

---

## v1.1.1

- 修复推荐绑定已开奖期的问题
- 新增 calculateNextPeriod() 计算下一期
- 增量存储 + localStorage 持久化

---

## v1.1.0

- 智能推荐系统 5 组备选号码
- 每组带策略理由（热号为主/均衡型/冷号补充等）

---

## v1.0.0

- 双彩种支持（双色球/大乐透）
- 实时数据抓取（500彩票网）
- 确认锁定机制 + 历史推荐追踪
