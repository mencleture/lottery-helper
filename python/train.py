"""
Lottery ML Training Script v2.0
Supports: SSQ (Double Ball) / DLT (Big Lotto)
Models: RF + GB + LightGBM + XGBoost Weighted Ensemble

Usage:
  python train.py                    # Train + backtest + predict
  python train.py --ssq-only         # SSQ only
  python train.py --dlt-only         # DLT only
  python train.py --top-k 10         # Backtest period count
"""
import argparse
import json
import os
import sys
import time
import numpy as np
from pathlib import Path
import joblib

sys.path.insert(0, str(Path(__file__).parent))

try:
    import built_in_data
    built_in_data.ensure_data_files()
except Exception as e:
    print(f'Built-in data: {e}')

from features import (
    load_records, build_all_samples, build_sample_features,
    calculate_missing_periods, calculate_frequency
)

from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, accuracy_score

import lightgbm as lgb
import xgboost as xgb

BASE_DIR = Path(__file__).parent.parent
MODEL_DIR = BASE_DIR / 'models'
DATA_DIR = BASE_DIR / 'data'
MODEL_DIR.mkdir(exist_ok=True)

FEATURE_NAMES = [
    'missing', 'freq50', 'freq20', 'freq10',
    'avg_miss', 'avg_freq50', 'avg_freq20', 'avg_freq8',
    'ac', 'tails', 'sum', 'odd_count',
    'is_even', 'tail', 'is_low', 'ball_num'
]

LOTTERY_CONFIG = {
    'ssq': {
        'ball_range': 33,
        'target_num': 6,
        'blue_range': 16,
        'blue_target': 1,
        'name': 'SSQ',
        'balls_key': 'balls',
    },
    'dlt': {
        'ball_range': 35,
        'target_num': 5,
        'blue_range': 12,
        'blue_target': 2,
        'name': 'DLT',
        'balls_key': 'balls',
    },
}


def train_and_backtest(ltype, top_k=10):
    cfg = LOTTERY_CONFIG[ltype]
    records = load_records(ltype)
    if not records:
        print(f'  [{cfg["name"]}] No data found! Get latest data in Electron app first.')
        return None, None

    print(f'\n{"=" * 60}')
    print(f'  {cfg["name"]} ML Training v2.0 (RF+GB+LGB+XGB Ensemble)')
    print(f'  Records: {len(records)} | Latest: Period {records[0]["period"]}')
    print(f'{"=" * 60}')

    train_start = 12
    if len(records) < train_start + top_k + 5:
        train_start = max(5, len(records) - top_k - 5)

    # Build samples
    X_all, y_all = build_all_samples(records, cfg['ball_range'], train_start)
    X_all = np.array(X_all, dtype=np.float32)
    y_all = np.array(y_all, dtype=np.int32)
    print(f'Samples: {len(X_all)}, Positives: {y_all.sum()}, Ratio: {y_all.mean():.3f}')

    split = int(len(X_all) * 0.8)
    X_train, X_test = X_all[:split], X_all[split:]
    y_train, y_test = y_all[:split], y_all[split:]

    models_dict = {}
    test_probas = {}
    aucs = {}

    # 1. Random Forest
    print('\n  [1/4] Random Forest...')
    t0 = time.time()
    rf = RandomForestClassifier(
        n_estimators=300, max_depth=12, min_samples_leaf=4,
        class_weight='balanced', random_state=42, n_jobs=-1
    )
    rf.fit(X_train, y_train)
    rf_proba = rf.predict_proba(X_test)[:, 1]
    rf_auc = roc_auc_score(y_test, rf_proba)
    models_dict['rf'] = rf
    test_probas['rf'] = rf_proba
    aucs['rf'] = rf_auc
    print(f'      AUC={rf_auc:.4f}  ({time.time()-t0:.1f}s)')

    # 2. Gradient Boosting
    print('  [2/4] Gradient Boosting...')
    t0 = time.time()
    gb = GradientBoostingClassifier(
        n_estimators=300, max_depth=6, learning_rate=0.05,
        min_samples_leaf=4, subsample=0.8, random_state=42
    )
    gb.fit(X_train, y_train)
    gb_proba = gb.predict_proba(X_test)[:, 1]
    gb_auc = roc_auc_score(y_test, gb_proba)
    models_dict['gb'] = gb
    test_probas['gb'] = gb_proba
    aucs['gb'] = gb_auc
    print(f'      AUC={gb_auc:.4f}  ({time.time()-t0:.1f}s)')

    # 3. LightGBM
    print('  [3/4] LightGBM...')
    t0 = time.time()
    pos_ratio = y_train.mean()
    scale_pos = (1 - pos_ratio) / max(pos_ratio, 0.001)
    lgb_model = lgb.LGBMClassifier(
        n_estimators=500, max_depth=8, learning_rate=0.05, num_leaves=31,
        min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=0.1, scale_pos_weight=scale_pos,
        random_state=42, verbose=-1, n_jobs=-1
    )
    lgb_model.fit(X_train, y_train)
    lgb_proba = lgb_model.predict_proba(X_test)[:, 1]
    lgb_auc = roc_auc_score(y_test, lgb_proba)
    models_dict['lgb'] = lgb_model
    test_probas['lgb'] = lgb_proba
    aucs['lgb'] = lgb_auc
    print(f'      AUC={lgb_auc:.4f}  ({time.time()-t0:.1f}s)')

    # 4. XGBoost
    print('  [4/4] XGBoost...')
    t0 = time.time()
    xgb_model = xgb.XGBClassifier(
        n_estimators=500, max_depth=8, learning_rate=0.05, subsample=0.8,
        colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=0.1,
        scale_pos_weight=scale_pos, random_state=42,
        eval_metric='logloss', verbosity=0
    )
    xgb_model.fit(X_train, y_train)
    xgb_proba = xgb_model.predict_proba(X_test)[:, 1]
    xgb_auc = roc_auc_score(y_test, xgb_proba)
    models_dict['xgb'] = xgb_model
    test_probas['xgb'] = xgb_proba
    aucs['xgb'] = xgb_auc
    print(f'      AUC={xgb_auc:.4f}  ({time.time()-t0:.1f}s)')

    # Weighted ensemble (AUC-proportional weights)
    total_auc = rf_auc + gb_auc + lgb_auc + xgb_auc
    w_rf = rf_auc / total_auc
    w_gb = gb_auc / total_auc
    w_lgb = lgb_auc / total_auc
    w_xgb = xgb_auc / total_auc
    final_w = {'rf': round(w_rf, 4), 'gb': round(w_gb, 4),
               'lgb': round(w_lgb, 4), 'xgb': round(w_xgb, 4)}
    print(f'\n  Weights: RF={w_rf:.3f} GB={w_gb:.3f} LGB={w_lgb:.3f} XGB={w_xgb:.3f}')

    ens_proba = rf_proba * w_rf + gb_proba * w_gb + lgb_proba * w_lgb + xgb_proba * w_xgb
    ens_auc = roc_auc_score(y_test, ens_proba)
    aucs['ensemble'] = ens_auc
    print(f'  [ENSEMBLE] AUC: {ens_auc:.4f}')

    # Time-series CV
    print(f'\n  Time-series 5-fold CV (ensemble)...')
    ens_cv_scores = []
    tscv = TimeSeriesSplit(n_splits=5)
    for fold_idx, (tr_idx, val_idx) in enumerate(tscv.split(X_all)):
        X_tr, X_val = X_all[tr_idx], X_all[val_idx]
        y_tr, y_val = y_all[tr_idx], y_all[val_idx]
        pos_r = y_tr.mean()
        spw = (1 - pos_r) / max(pos_r, 0.001)

        rf_cv = RandomForestClassifier(n_estimators=300, max_depth=12, min_samples_leaf=4,
                                       class_weight='balanced', random_state=42, n_jobs=-1)
        rf_cv.fit(X_tr, y_tr)
        gb_cv = GradientBoostingClassifier(n_estimators=300, max_depth=6, learning_rate=0.05,
                                          min_samples_leaf=4, subsample=0.8, random_state=42)
        gb_cv.fit(X_tr, y_tr)
        lgb_cv = lgb.LGBMClassifier(n_estimators=500, max_depth=8, learning_rate=0.05,
                                    num_leaves=31, min_child_samples=20, subsample=0.8,
                                    colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=0.1,
                                    scale_pos_weight=spw, random_state=42, verbose=-1, n_jobs=-1)
        lgb_cv.fit(X_tr, y_tr)
        xgb_cv = xgb.XGBClassifier(n_estimators=500, max_depth=8, learning_rate=0.05,
                                    subsample=0.8, colsample_bytree=0.8, reg_alpha=0.1,
                                    reg_lambda=0.1, scale_pos_weight=spw, random_state=42,
                                    eval_metric='logloss', verbosity=0)
        xgb_cv.fit(X_tr, y_tr)

        p_rf = rf_cv.predict_proba(X_val)[:, 1]
        p_gb = gb_cv.predict_proba(X_val)[:, 1]
        p_lgb = lgb_cv.predict_proba(X_val)[:, 1]
        p_xgb = xgb_cv.predict_proba(X_val)[:, 1]
        p_ens = p_rf * w_rf + p_gb * w_gb + p_lgb * w_lgb + p_xgb * w_xgb

        fold_auc = roc_auc_score(y_val, p_ens)
        ens_cv_scores.append(fold_auc)
        print(f'    Fold {fold_idx+1}: AUC={fold_auc:.4f}')

    mean_cv = np.mean(ens_cv_scores)
    std_cv = np.std(ens_cv_scores)
    print(f'  CV Mean: {mean_cv:.4f} +/- {std_cv:.4f}')

    # Backtest (use all data for final model)
    print(f'\n{"-" * 60}')
    print(f'  Backtest last {top_k} periods (full history training)')
    print(f'{"-" * 60}')

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

    pos_all = y_all.mean()
    spw_all = (1 - pos_all) / max(pos_all, 0.001)

    final_lgb = lgb.LGBMClassifier(
        n_estimators=500, max_depth=8, learning_rate=0.05, num_leaves=31,
        min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=0.1, scale_pos_weight=spw_all,
        random_state=42, verbose=-1, n_jobs=-1
    )
    final_lgb.fit(X_all, y_all)

    final_xgb = xgb.XGBClassifier(
        n_estimators=500, max_depth=8, learning_rate=0.05, subsample=0.8,
        colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=0.1,
        scale_pos_weight=spw_all, random_state=42, eval_metric='logloss', verbosity=0
    )
    final_xgb.fit(X_all, y_all)

    # Save 4 model files (for predict.py to load)
    joblib.dump(final_rf, MODEL_DIR / f'{ltype}_rf.joblib')
    joblib.dump(final_gb, MODEL_DIR / f'{ltype}_gb.joblib')
    joblib.dump(final_lgb, MODEL_DIR / f'{ltype}_lgb.joblib')
    joblib.dump(final_xgb, MODEL_DIR / f'{ltype}_xgb.joblib')
    print(f'  Model files saved: {ltype}_rf/gb/lgb/xgb.joblib')

    # Backtest evaluation
    backtest_results = []
    total_hits = {k: 0 for k in ['rf', 'gb', 'lgb', 'xgb', 'ens']}

    for i in range(len(records) - top_k, len(records)):
        actual = set(records[i]['balls'])
        X, _ = build_sample_features(records, cfg['ball_range'], i)
        X = np.array(X, dtype=np.float32)

        p_rf = final_rf.predict_proba(X)[:, 1]
        p_gb = final_gb.predict_proba(X)[:, 1]
        p_lgb = final_lgb.predict_proba(X)[:, 1]
        p_xgb = final_xgb.predict_proba(X)[:, 1]
        p_ens = p_rf * w_rf + p_gb * w_gb + p_lgb * w_lgb + p_xgb * w_xgb

        top_n = cfg['target_num']
        top_k_models = {
            'rf': {int(j + 1) for j in np.argsort(p_rf)[-top_n:]},
            'gb': {int(j + 1) for j in np.argsort(p_gb)[-top_n:]},
            'lgb': {int(j + 1) for j in np.argsort(p_lgb)[-top_n:]},
            'xgb': {int(j + 1) for j in np.argsort(p_xgb)[-top_n:]},
            'ens': {int(j + 1) for j in np.argsort(p_ens)[-top_n:]},
        }

        hits = {k: len(top_k_models[k] & actual) for k in top_k_models}
        for k in total_hits:
            total_hits[k] += hits[k]

        rec = records[i]
        result = {
            'period': int(rec['period']),
            'actual': sorted(actual),
            'rf': {'top': sorted(top_k_models['rf']), 'hit': hits['rf']},
            'gb': {'top': sorted(top_k_models['gb']), 'hit': hits['gb']},
            'lgb': {'top': sorted(top_k_models['lgb']), 'hit': hits['lgb']},
            'xgb': {'top': sorted(top_k_models['xgb']), 'hit': hits['xgb']},
            'ens': {'top': sorted(top_k_models['ens']), 'hit': hits['ens']},
        }
        backtest_results.append(result)

        marker = 'OK' if hits['ens'] >= 3 else '.'
        print(f'  {marker} Period {rec["period"]} | Ens hits={hits["ens"]} | Draw:{sorted(actual)}')

    avg_hits = {k: round(total_hits[k] / top_k, 2) for k in total_hits}
    print(f'\n  Avg hits: RF={avg_hits["rf"]} GB={avg_hits["gb"]} LGB={avg_hits["lgb"]} XGB={avg_hits["xgb"]} Ens={avg_hits["ens"]}')

    # Latest prediction
    print(f'\n{"-" * 60}')
    print(f'  Latest prediction (Period {records[0]["period"]})')
    print(f'{"-" * 60}')

    X_latest, _ = build_sample_features(records, cfg['ball_range'], 0)
    X_latest = np.array(X_latest, dtype=np.float32)

    p_rf = final_rf.predict_proba(X_latest)[:, 1]
    p_gb = final_gb.predict_proba(X_latest)[:, 1]
    p_lgb = final_lgb.predict_proba(X_latest)[:, 1]
    p_xgb = final_xgb.predict_proba(X_latest)[:, 1]
    p_ens = p_rf * w_rf + p_gb * w_gb + p_lgb * w_lgb + p_xgb * w_xgb

    top_n = cfg['target_num']
    ens_top = [int(j + 1) for j in np.argsort(p_ens)[-top_n:]]
    top15 = [int(j) for j in np.argsort(p_ens)[-15:]]
    print(f'  Ensemble: {ens_top}  Top15: {top15}')

    miss = calculate_missing_periods(records, cfg['ball_range'], 0)
    freq20 = calculate_frequency(records, cfg['ball_range'], 0, 20)
    top5_hot = sorted(range(1, cfg['ball_range'] + 1), key=lambda x: -freq20.get(x, 0))[:5]
    top5_miss = sorted(range(1, cfg['ball_range'] + 1), key=lambda x: -miss.get(x, 0))[:5]

    prediction = {
        'lottery_type': ltype,
        'period': int(records[0]['period']),
        'recommended': ens_top,
        'top15': top15,
        'probabilities': {str(j): round(float(p_ens[j - 1]), 4) for j in range(1, cfg['ball_range'] + 1)},
        'top5_hot': top5_hot,
        'top5_missing': top5_miss,
        'auc_rf': round(float(rf_auc), 4),
        'auc_gb': round(float(gb_auc), 4),
        'auc_lgb': round(float(lgb_auc), 4),
        'auc_xgb': round(float(xgb_auc), 4),
        'auc_ensemble': round(float(ens_auc), 4),
        'cv_mean': round(float(mean_cv), 4),
        'cv_std': round(float(std_cv), 4),
        'ensemble_weights': final_w,
        'backtest_avg': round(float(avg_hits['ens']), 3),
        'backtest_avg_detail': {k: round(float(v), 2) for k, v in avg_hits.items()},
        'backtest_results': backtest_results,
    }

    pred_path = MODEL_DIR / f'{ltype}_prediction.json'
    with open(pred_path, 'w', encoding='utf-8') as f:
        json.dump(prediction, f, ensure_ascii=False, indent=2)
    print(f'  Prediction saved: {pred_path}')

    save_model_info(
        rf=final_rf, lgb_model=final_lgb, xgb_model=final_xgb,
        ltype=ltype, cfg=cfg,
        aucs=aucs, final_w=final_w, mean_cv=mean_cv, std_cv=std_cv
    )

    return prediction, avg_hits['ens']


def save_model_info(rf, lgb_model, xgb_model, ltype, cfg, aucs, final_w, mean_cv, std_cv):
    importance = rf.feature_importances_.tolist()
    feat_imp = dict(zip(FEATURE_NAMES, [round(v, 4) for v in importance]))
    sorted_imp = sorted(feat_imp.items(), key=lambda x: -x[1])
    top8 = sorted_imp[:8]
    print(f'\n  Feature Importance Top8: {top8}')

    lgb_imp = lgb_model.feature_importances_.tolist()
    lgb_feat_imp = dict(zip(FEATURE_NAMES, [round(v, 4) for v in lgb_imp]))
    lgb_sorted = sorted(lgb_feat_imp.items(), key=lambda x: -x[1])[:8]

    model_data = {
        'lottery_type': ltype,
        'feature_names': FEATURE_NAMES,
        'feature_importance': feat_imp,
        'lgb_feature_importance': lgb_feat_imp,
        'lgb_top8': dict(lgb_sorted),
        'n_estimators': rf.n_estimators,
        'ball_range': cfg['ball_range'],
        'target_num': cfg['target_num'],
        'ensemble_weights': final_w,
        'auc_rf': round(float(aucs['rf']), 4),
        'auc_gb': round(float(aucs['gb']), 4),
        'auc_lgb': round(float(aucs['lgb']), 4),
        'auc_xgb': round(float(aucs['xgb']), 4),
        'auc_ensemble': round(float(aucs['ensemble']), 4),
        'cv_mean': round(float(mean_cv), 4),
        'cv_std': round(float(std_cv), 4),
    }

    path = MODEL_DIR / f'{ltype}_model.json'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(model_data, f, ensure_ascii=False, indent=2)
    print(f'  Model saved: {path}')


def main():
    parser = argparse.ArgumentParser(description='Lottery ML Training v2.0')
    parser.add_argument('--ssq-only', action='store_true')
    parser.add_argument('--dlt-only', action='store_true')
    parser.add_argument('--top-k', type=int, default=10)
    args = parser.parse_args()

    print('+==================================================+')
    print('+   Lottery ML Training v2.0                       +')
    print('+   RF + GB + LightGBM + XGBoost Ensemble          +')
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

    print('\n' + '=' * 60)
    print('  Training complete!')
    for k, v in results.items():
        if v['backtest_avg'] is not None:
            p = v['prediction']
            print(f'  {k.upper()} AUC={p["auc_ensemble"]:.4f} (CV:{p["cv_mean"]:.4f}+/-{p["cv_std"]:.4f}) Backtest={v["backtest_avg"]:.2f}')
    print(f'  Files: {MODEL_DIR}')
    print('=' * 60)


if __name__ == '__main__':
    main()
