import json

for name in ['ssq', 'dlt']:
    with open(f'C:/Users/HP/.qclaw/workspace/lottery-app/models/{name}_prediction.json', encoding='utf-8') as f:
        p = json.load(f)
    with open(f'C:/Users/HP/.qclaw/workspace/lottery-app/models/{name}_model.json', encoding='utf-8') as f:
        m = json.load(f)
    top5 = sorted(m['feature_importance'].items(), key=lambda x: -x[1])[:5]
    print(f'[{name.upper()}]')
    print(f'  AUC Ensemble: {p["auc_ensemble"]}')
    print(f'  Latest period: {p["period"]}')
    print(f'  Recommended: {p["recommended"]}')
    print(f'  Backtest avg hits: {p["backtest_avg"]} / {m["target_num"]}')
    print(f'  Top features: {top5}')
    print()
