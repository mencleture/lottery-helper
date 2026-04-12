"""
彩票 ML 训练脚本
支持：双色球(SSQ) / 大乐透(DLT)
算法：Random Forest + Gradient Boosting 集成

使用方法：
  python train.py                    # 训练 + 回测 + 导出预测
  python train.py --ssq-only         # 仅训练双色球
  python train.py --dlt-only         # 仅训练大乐透
  python train.py --predict-only     # 仅生成最新预测（不重新训练）
"""
import argparse
import json
import os
import sys
import time
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

# 先确保有基础数据文件
try:
    import built_in_data
    built_in_data.ensure_data_files()
except Exception as e:
    print(f'内置数据初始化: {e}')

from features import load_records, build_all_samples, build_sample_features, calculate_missing_periods, calculate_frequency

from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, accuracy_score

BASE_DIR = Path(__file__).parent.parent
MODEL_DIR = BASE_DIR / 'models'
DATA_DIR = BASE_DIR / 'data'
MODEL_DIR.mkdir(exist_ok=True)

FEATURE_NAMES = [
    'missing', 'freq50', 'freq20', 'freq10',
    'avg_miss', 'avg_freq50', 'avg_freq20', 'avg_freq10',
    'ac', 'tails', 'sum', 'odd_count', 'is_even', 'tail', 'is_low', 'ball_num'
]

LOTTERY_CONFIG = {
    'ssq': {
        'ball_range': 33,
        'target_num': 6,
        'blue_range': 16,
        'blue_target': 1,
        'name': '双色球',
        'balls_key': 'balls',
    },
    'dlt': {
        'ball_range': 35,
        'target_num': 5,
        'blue_range': 12,
        'blue_target': 2,
        'name': '大乐透',
        'balls_key': 'balls',
    },
}


def train_and_backtest(ltype, top_k=10):
    cfg = LOTTERY_CONFIG[ltype]
    records = load_records(ltype)
    if not records:
        print(f'  [{cfg["name"]}] 未找到数据！请先在 Electron 应用中获取最新数据')
        return None, None

    print(f'\n{"=" * 55}')
    print(f'  {cfg["name"]} ML 训练')
    print(f'  数据量: {len(records)} 期 | 最新: 第{records[0]["period"]}期')
    print(f'{"=" * 55}')

    train_start = 12  # 最少需要 12 期历史才能构建特征
    if len(records) < train_start + top_k + 5:
        print(f'  数据太少（需要 {train_start + top_k + 5} 期，实际 {len(records)} 期），降低阈值重试')
        train_start = max(5, len(records) - top_k - 5)

    # -- 构建样本 ---------------------------------------------
    X_all, y_all = build_all_samples(records, cfg['ball_range'], train_start)
    X_all = np.array(X_all, dtype=np.float32)
    y_all = np.array(y_all, dtype=np.int32)
    print(f'样本总数: {len(X_all)}, 正样本: {y_all.sum()}, 比例: {y_all.mean():.3f}')

    # 训练集 80%，测试集 20%
    split = int(len(X_all) * 0.8)
    X_train, X_test = X_all[:split], X_all[split:]
    y_train, y_test = y_all[:split], y_all[split:]

    # -- 训练 Random Forest ----------------------------------
    print('\n训练 Random Forest...')
    t0 = time.time()
    rf = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=4,
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )
    rf.fit(X_train, y_train)
    rf_proba = rf.predict_proba(X_test)[:, 1]
    rf_auc = roc_auc_score(y_test, rf_proba)
    print(f'  RF AUC: {rf_auc:.4f}  (耗时 {time.time()-t0:.1f}s)')

    # -- 训练 Gradient Boosting -------------------------------
    print('训练 Gradient Boosting...')
    t0 = time.time()
    gb = GradientBoostingClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        min_samples_leaf=4,
        subsample=0.8,
        random_state=42
    )
    gb.fit(X_train, y_train)
    gb_proba = gb.predict_proba(X_test)[:, 1]
    gb_auc = roc_auc_score(y_test, gb_proba)
    print(f'  GB AUC: {gb_auc:.4f}  (耗时 {time.time()-t0:.1f}s)')

    # -- 集成 AUC ---------------------------------------------
    ens_proba = (rf_proba + gb_proba) / 2
    ens_auc = roc_auc_score(y_test, ens_proba)
    print(f'  集成 AUC: {ens_auc:.4f}')

    # -- 回测（最近 top_k 期）--------------------------------
    print(f'\n{"-" * 55}')
    print(f'  回测最近 {top_k} 期（用全部历史训练最终模型）')
    print(f'{"-" * 55}')

    # 用全部数据训练最终模型
    final_rf = RandomForestClassifier(
        n_estimators=300, max_depth=12, min_samples_leaf=4,
        class_weight='balanced', random_state=42, n_jobs=-1
    )
    final_rf.fit(X_all, y_all)

    final_gb = GradientBoostingClassifier(
        n_estimators=300, max_depth=6, learning_rate=0.05,
        min_samples_leaf=4, subsample=0.8, random_state=42
    )
    final_gb.fit(X_all, y_all)

    backtest_results = []
    total_rf_hit, total_gb_hit, total_ens_hit = 0, 0, 0

    for i in range(len(records) - top_k, len(records)):
        actual = set(records[i]['balls'])
        X, _ = build_sample_features(records, cfg['ball_range'], i)
        X = np.array(X, dtype=np.float32)

        rf_proba = final_rf.predict_proba(X)[:, 1]
        gb_proba = final_gb.predict_proba(X)[:, 1]
        ens_proba = (rf_proba + gb_proba) / 2

        rf_top = {int(j + 1) for j in np.argsort(rf_proba)[-cfg['target_num']:]}
        gb_top = {int(j + 1) for j in np.argsort(gb_proba)[-cfg['target_num']:]}
        ens_top = {int(j + 1) for j in np.argsort(ens_proba)[-cfg['target_num']:]}

        rf_hit = len(rf_top & actual)
        gb_hit = len(gb_top & actual)
        ens_hit = len(ens_top & actual)

        total_rf_hit += rf_hit
        total_gb_hit += gb_hit
        total_ens_hit += ens_hit

        rec = records[i]
        result = {
            'period': int(rec['period']),
            'actual': sorted(actual),
            'rf': {'top': sorted(rf_top), 'hit': rf_hit},
            'gb': {'top': sorted(gb_top), 'hit': gb_hit},
            'ens': {'top': sorted(ens_top), 'hit': ens_hit},
        }
        backtest_results.append(result)

        # 彩色输出
        marker = 'OK' if ens_hit >= 3 else '·'
        print(f'  {marker} 第{rec["period"]}期 | 集成命中{ens_hit} | 开奖:{sorted(actual)}')

    avg_rf = total_rf_hit / top_k
    avg_gb = total_gb_hit / top_k
    avg_ens = total_ens_hit / top_k
    print(f'\n  平均命中: RF={avg_rf:.2f}  GB={avg_gb:.2f}  集成={avg_ens:.2f}  (满分{cfg["target_num"]})')

    # -- 生成最新预测 ----------------------------------------
    print(f'\n{"-" * 55}')
    print(f'  最新一期预测（第{records[0]["period"]}期）')
    print(f'{"-" * 55}')

    X_latest, _ = build_sample_features(records, cfg['ball_range'], 0)
    X_latest = np.array(X_latest, dtype=np.float32)

    rf_proba = final_rf.predict_proba(X_latest)[:, 1]
    gb_proba = final_gb.predict_proba(X_latest)[:, 1]
    ens_proba = (rf_proba + gb_proba) / 2

    # Top-N 推荐
    top_n = cfg['target_num']
    ens_top = [int(j + 1) for j in np.argsort(ens_proba)[-top_n:]]
    print(f'  ML 集成推荐: {ens_top}')

    # Top-K 多注（取概率最高的 K 个球，从中组合）
    top_k_idx = [int(j + 1) for j in np.argsort(ens_proba)[-15:]]
    top_k_balls = [int(j) for j in top_k_idx]
    print(f'  概率最高15球: {top_k_balls}')

    # 生成理由
    miss = calculate_missing_periods(records, cfg['ball_range'], 0)
    freq20 = calculate_frequency(records, cfg['ball_range'], 0, 20)
    top5_hot = sorted(range(1, cfg['ball_range'] + 1), key=lambda x: -freq20.get(x, 0))[:5]
    top5_miss = sorted(range(1, cfg['ball_range'] + 1), key=lambda x: -miss.get(x, 0))[:5]

    prediction = {
        'lottery_type': ltype,
        'period': int(records[0]['period']),
        'recommended': ens_top,
        'top15': top_k_balls,
        'probabilities': {str(j): round(float(ens_proba[j - 1]), 4) for j in range(1, cfg['ball_range'] + 1)},
        'top5_hot': top5_hot,
        'top5_missing': top5_miss,
        'auc_rf': round(float(rf_auc), 4),
        'auc_gb': round(float(gb_auc), 4),
        'auc_ensemble': round(float(ens_auc), 4),
        'backtest_avg': round(float(avg_ens), 3),
        'backtest_results': backtest_results,
    }

    # 保存预测结果
    pred_path = MODEL_DIR / f'{ltype}_prediction.json'
    with open(pred_path, 'w', encoding='utf-8') as f:
        json.dump(prediction, f, ensure_ascii=False, indent=2)
    print(f'\n  预测结果已保存: {pred_path}')

    # 保存 RF 模型（特征重要性 + 树结构）
    save_rf_model(final_rf, ltype, cfg)

    return prediction, avg_ens


def save_rf_model(rf, ltype, cfg):
    """把 RF 模型保存为 JSON（保留关键树结构和特征重要性）"""
    importance = rf.feature_importances_.tolist()
    feat_imp = dict(zip(FEATURE_NAMES, [round(v, 4) for v in importance]))
    sorted_imp = sorted(feat_imp.items(), key=lambda x: -x[1])

    # 取最重要的特征
    top_features = sorted_imp[:8]
    print(f'\n  特征重要性 Top8: {top_features}')

    model_data = {
        'lottery_type': ltype,
        'feature_names': FEATURE_NAMES,
        'feature_importance': feat_imp,
        'n_estimators': rf.n_estimators,
        'ball_range': cfg['ball_range'],
        'target_num': cfg['target_num'],
    }

    path = MODEL_DIR / f'{ltype}_model.json'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(model_data, f, ensure_ascii=False, indent=2)
    print(f'  模型已保存: {path}')


def main():
    parser = argparse.ArgumentParser(description='彩票 ML 训练')
    parser.add_argument('--ssq-only', action='store_true')
    parser.add_argument('--dlt-only', action='store_true')
    parser.add_argument('--predict-only', action='store_true')
    parser.add_argument('--top-k', type=int, default=10)
    args = parser.parse_args()

    print('+==================================================+')
    print('║      彩票 ML 训练系统  v1.0                       ║')
    print('║      Random Forest + Gradient Boosting 集成      ║')
    print('+==================================================+')

    results = {}
    run_ssq = not args.dlt_only
    run_dlt = not args.ssq_only

    if run_ssq:
        pred, avg = train_and_backtest('ssq', top_k=args.top_k)
        results['ssq'] = {'prediction': pred, 'backtest_avg': avg}

    if run_dlt:
        pred, avg = train_and_backtest('dlt', top_k=args.top_k)
        results['dlt'] = {'prediction': pred, 'backtest_avg': avg}

    print('\n' + '=' * 55)
    print('  训练完成！')
    for k, v in results.items():
        if v['backtest_avg'] is not None:
            print(f'  {k.upper()} 回测平均命中: {v["backtest_avg"]:.2f}')
    print(f'  预测文件: {MODEL_DIR}')
    print('=' * 55)


if __name__ == '__main__':
    main()
