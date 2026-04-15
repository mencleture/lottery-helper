"""
彩票 ML 预测脚本 v2.0
基于已训练的 RF + GB + LightGBM + XGBoost 加权集成模型

使用方法：
  python predict.py                    # 预测双色球和大乐透
  python predict.py --ssq-only        # 仅预测双色球
  python predict.py --dlt-only        # 仅预测大乐透
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

try:
    import built_in_data
    built_in_data.ensure_data_files()
except Exception:
    pass

import joblib
import numpy as np
from features import (
    load_records, calculate_missing_periods, calculate_frequency,
    calculate_ac, build_sample_features
)


def load_history(type_, base_dir):
    """加载历史数据，优先从 ml/data/ 读 Electron 真实数据"""
    hist_path = base_dir / 'data' / f'{type_}_history.json'
    if hist_path.exists():
        try:
            with open(hist_path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            records = []
            for r in raw:
                period_str = str(r.get('period', '')).strip().strip('"')
                period = int(period_str) if period_str.isdigit() else 0
                if not period:
                    continue
                rec = {'period': period}
                if 'balls' in r:
                    rec['balls'] = r['balls']
                elif type_ == 'ssq':
                    balls = r.get('redNumbers') or r.get('red') or []
                    rec['balls'] = sorted([int(x) for x in balls
                                           if isinstance(x, (int, str)) and 1 <= int(x) <= 33])
                    rec['blue'] = int(r.get('blueNumber') or r.get('blue') or 0)
                else:
                    front = r.get('frontNumbers') or r.get('front') or []
                    rec['balls'] = sorted([int(x) for x in front
                                           if isinstance(x, (int, str)) and 1 <= int(x) <= 35])
                    back = r.get('backNumbers') or r.get('back') or []
                    rec['back'] = sorted([int(x) for x in back
                                         if isinstance(x, (int, str)) and 1 <= int(x) <= 12])
                if len(rec.get('balls', [])) >= 5:
                    records.append(rec)
            history_data = sorted(records, key=lambda x: x['period'], reverse=True)
            print(f'[{type_.upper()}] 数据: {len(history_data)}期, 最新第{history_data[0]["period"]}期')
            return history_data
        except Exception as e:
            print(f'[{type_.upper()}] 数据读取失败({e})，使用内置数据')

    # 回退到 built_in_data
    history_data = load_records(type_)
    print(f'[{type_.upper()}] 内置数据: {len(history_data)}期')
    return history_data


def load_models(type_, base_dir):
    """加载 4 个训练好的模型文件 + 模型元信息，返回 (models_dict, weights, model_meta)"""
    model_dir = base_dir / 'models'
    json_path = model_dir / f'{type_}_model.json'

    models = {}
    weights = {'rf': 0.25, 'gb': 0.25, 'lgb': 0.25, 'xgb': 0.25}
    meta = {}

    # 尝试加载 joblib 模型文件
    for name in ['rf', 'gb', 'lgb', 'xgb']:
        joblib_path = model_dir / f'{type_}_{name}.joblib'
        if joblib_path.exists():
            try:
                models[name] = joblib.load(str(joblib_path))
                print(f'  [{type_.upper()}] 加载 {name}: OK')
            except Exception as e:
                print(f'  [{type_.upper()}] 加载 {name} 失败: {e}')

    # 加载元信息（权重、AUC 等）
    if json_path.exists():
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                model_json = json.load(f)
            weights = model_json.get('ensemble_weights', weights)
            meta = {
                'auc_rf': model_json.get('auc_rf', 0),
                'auc_gb': model_json.get('auc_gb', 0),
                'auc_lgb': model_json.get('auc_lgb', 0),
                'auc_xgb': model_json.get('auc_xgb', 0),
                'auc_ensemble': model_json.get('auc_ensemble', 0),
                'cv_mean': model_json.get('cv_mean', 0),
                'cv_std': model_json.get('cv_std', 0),
                'ball_range': model_json.get('ball_range', 33 if type_ == 'ssq' else 35),
                'target_num': model_json.get('target_num', 6 if type_ == 'ssq' else 5),
                'feature_importance': model_json.get('feature_importance', {}),
            }
            print(f'  [{type_.upper()}] 权重: {weights}')
            print(f'  [{type_.upper()}] 集成AUC={meta["auc_ensemble"]:.4f} CV={meta["cv_mean"]:.4f}±{meta["cv_std"]:.4f}')
        except Exception as e:
            print(f'  [{type_.upper()}] 元信息加载失败: {e}')

    return models, weights, meta


def build_X(history_data, ball_range):
    """为所有球构建特征矩阵（与训练时完全一致）"""
    X_list = []
    for idx in range(len(history_data)):
        X_i, _ = build_sample_features(history_data, ball_range, idx)
        X_list.append(X_i)
    return np.array(X_list, dtype=np.float32)


def predict_with_ensemble(history_data, models, weights, ball_range, target_num):
    """
    4 模型加权集成推理
    返回各球的加权平均概率 + 排序后的 Top-N 推荐
    """
    # 构建特征
    feat_matrix = build_X(history_data, ball_range)

    # 取最新一期（index=0）的特征
    X = feat_matrix[0]  # shape: (ball_range, n_features)

    # 各模型独立预测
    probas = {}
    for name, model in models.items():
        try:
            probas[name] = model.predict_proba(X)[:, 1]  # shape: (ball_range,)
        except Exception as e:
            print(f'  [{name}] 预测失败: {e}')
            probas[name] = np.full(ball_range, 0.5 / ball_range)

    # 加权集成
    w_total = sum(weights.values())
    ens_proba = np.zeros(ball_range)
    for name, prob in probas.items():
        w = weights.get(name, 0) / w_total
        ens_proba += w * prob

    # 排序，选 Top-N
    top_indices = np.argsort(ens_proba)[-target_num:][::-1]  # 从高到低
    top_balls = sorted([int(i + 1) for i in top_indices])  # 球号从1开始

    # Top-15（概率最高的15个球）
    top15_indices = np.argsort(ens_proba)[-15:][::-1]
    top15 = [int(i + 1) for i in top15_indices]

    # 概率字典
    prob_dict = {str(i + 1): round(float(ens_proba[i]), 4) for i in range(ball_range)}

    # 信号强度（Top1 vs Top6 的概率差）
    sorted_probs = sorted(ens_proba, reverse=True)
    signal = round(sorted_probs[0] - sorted_probs[target_num - 1], 4)

    return top_balls, top15, prob_dict, signal


def predict_ssq(history_data, models, weights, meta):
    ball_range = meta.get('ball_range', 33)
    target_num = meta.get('target_num', 6)

    if not history_data:
        return None

    top_balls, top15, prob_dict, signal = predict_with_ensemble(
        history_data, models, weights, ball_range, target_num
    )

    # 蓝球：遗漏 + 先验
    blue_range = 16
    miss = calculate_missing_periods(history_data, blue_range, 0)
    vals = list(miss.values())
    mn, mx = min(vals), max(vals)
    prior = 1.0 / blue_range
    blue_probs = {}
    for b in range(1, blue_range + 1):
        m = miss.get(b, 0)
        norm = (m - mn) / (mx - mn) if mx > mn else 0.5
        blue_probs[b] = 0.3 * prior + 0.7 * norm
    blue_top = max(blue_probs, key=blue_probs.get)

    return {
        'type': 'ssq',
        'redBalls': top_balls,
        'blueBall': blue_top,
        'top15': top15,
        'probabilities': prob_dict,
        'modelAuc': round(float(meta.get('auc_ensemble', 0)), 4),
        'cvMean': round(float(meta.get('cv_mean', 0)), 4),
        'cvStd': round(float(meta.get('cv_std', 0)), 4),
        'signal': signal,
        'modelType': 'ensemble_4',
    }


def predict_dlt(history_data, models, weights, meta):
    ball_range = meta.get('ball_range', 35)
    target_num = meta.get('target_num', 5)

    if not history_data:
        return None

    top_balls, top15, prob_dict, signal = predict_with_ensemble(
        history_data, models, weights, ball_range, target_num
    )

    # 后区蓝球
    back_range = 12
    miss = calculate_missing_periods(history_data, back_range, 0)
    vals = list(miss.values())
    mn, mx = min(vals), max(vals)
    prior = 2.0 / back_range
    back_probs = {}
    for b in range(1, back_range + 1):
        m = miss.get(b, 0)
        norm = (m - mn) / (mx - mn) if mx > mn else 0.5
        back_probs[b] = 0.3 * prior + 0.7 * norm
    top2_back = sorted(back_probs.keys(), key=lambda x: -back_probs[x])[:2]

    return {
        'type': 'dlt',
        'frontBalls': top_balls,
        'backBalls': top2_back,
        'top15': top15,
        'probabilities': prob_dict,
        'modelAuc': round(float(meta.get('auc_ensemble', 0)), 4),
        'cvMean': round(float(meta.get('cv_mean', 0)), 4),
        'cvStd': round(float(meta.get('cv_std', 0)), 4),
        'signal': signal,
        'modelType': 'ensemble_4',
    }


def main():
    parser = argparse.ArgumentParser(description='彩票 ML 预测 v2.0')
    parser.add_argument('--ssq-only', action='store_true')
    parser.add_argument('--dlt-only', action='store_true')
    args = parser.parse_args()

    do_ssq = not args.dlt_only
    do_dlt = not args.ssq_only

    base_dir = Path(__file__).parent  # ml/ 目录（自包含）
    results = {}

    # 先检查是否有真实数据
    for type_ in (['ssq'] if do_ssq else []) + (['dlt'] if do_dlt else []):
        history_data = load_history(type_, base_dir)
        if not history_data:
            print(f'[{type_.upper()}] 无历史数据')
            results[type_] = None
            continue

        models, weights, meta = load_models(type_, base_dir)

        if not models:
            print(f'[{type_.upper()}] 模型文件未找到，跳过')
            results[type_] = None
            continue

        if type_ == 'ssq':
            pred = predict_ssq(history_data, models, weights, meta)
        else:
            pred = predict_dlt(history_data, models, weights, meta)

        results[type_] = pred

        if pred:
            if type_ == 'ssq':
                print(f'[{type_.upper()}] 集成预测: 红球 {pred["redBalls"]} 蓝球 {pred["blueBall"]}')
                print(f'[{type_.upper()}] 信号强度: {pred["signal"]}  Top15: {pred["top15"]}')
            else:
                print(f'[{type_.upper()}] 集成预测: 前区 {pred["frontBalls"]} 后区 {pred["backBalls"]}')
                print(f'[{type_.upper()}] 信号强度: {pred["signal"]}  Top15: {pred["top15"]}')

    print(f'\n__RESULT_JSON__{json.dumps(results, ensure_ascii=False)}__END_RESULT__')


if __name__ == '__main__':
    main()
