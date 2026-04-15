"""
彩票 ML 预测脚本
基于已训练的模型，对下一期进行预测

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

from features import load_records, calculate_missing_periods, calculate_frequency, calculate_ac


def build_features(history_data, ball_range):
    """为所有球构建特征向量，与训练时一致"""
    if len(history_data) == 0:
        return None

    latest = history_data[0]
    balls = latest.get('balls', [])
    miss50 = calculate_missing_periods(history_data, ball_range, 0)
    freq50 = calculate_frequency(history_data, ball_range, 0, 50)
    freq20 = calculate_frequency(history_data, ball_range, 0, 20)
    freq10 = calculate_frequency(history_data, ball_range, 0, 10)

    avg_miss = sum(miss50.get(b, 0) for b in balls) / len(balls) if balls else 0
    avg_freq50 = sum(freq50.get(b, 0) for b in balls) / len(balls) if balls else 0
    avg_freq20 = sum(freq20.get(b, 0) for b in balls) / len(balls) if balls else 0
    avg_freq10 = sum(freq10.get(b, 0) for b in balls) / len(balls) if balls else 0
    ac = calculate_ac(balls)
    tails = len(set(b % 10 for b in balls))
    ball_sum = sum(balls)
    odd_count = sum(1 for b in balls if b % 2 == 1)

    # 特征名顺序（与 build_sample_features 一致）
    feature_names = [
        'missing', 'freq50', 'freq20', 'freq10',
        'avg_miss', 'avg_freq50', 'avg_freq20', 'avg_freq10',
        'ac', 'tails', 'sum', 'odd_count',
        'is_even', 'tail', 'is_low', 'ball_num'
    ]

    results = []
    for num in range(1, ball_range + 1):
        feat = {
            'missing': miss50.get(num, 0),
            'freq50': freq50.get(num, 0),
            'freq20': freq20.get(num, 0),
            'freq10': freq10.get(num, 0),
            'avg_miss': avg_miss,
            'avg_freq50': avg_freq50,
            'avg_freq20': avg_freq20,
            'avg_freq10': avg_freq10,
            'ac': ac,
            'tails': tails,
            'sum': ball_sum,
            'odd_count': odd_count,
            'is_even': 1 if num % 2 == 0 else 0,
            'tail': num % 10,
            'is_low': 1 if num <= ball_range // 2 else 0,
            'ball_num': num,
        }
        results.append({'ball': num, 'features': feat})

    return {'feature_names': feature_names, 'balls': results}


def score_balls_with_model(history_data, model_json, ball_range):
    """
    用模型特征重要性对各球打分
    关键：用每球各自的 min-max 归一化，让不同遗漏/频率的球有显著差异
    """
    feat_data = build_features(history_data, ball_range)
    if not feat_data:
        return []

    fi = model_json.get('feature_importance', {})
    feature_names = feat_data['feature_names']
    name_to_imp = {k: fi.get(k, 0) for k in feature_names}

    # 计算每个特征的全局范围（用于归一化）
    all_vals = {name: [] for name in feature_names}
    for item in feat_data['balls']:
        for name in feature_names:
            all_vals[name].append(item['features'][name])

    def min_max_norm(name, val):
        vals = all_vals[name]
        mn, mx = min(vals), max(vals)
        if mx == mn:
            return 0.5
        return (val - mn) / (mx - mn)

    # 先验概率（SSQ红球: 6/33≈0.182, DLT前区: 5/35≈0.143）
    ball_count = 6 if ball_range == 33 else 5
    prior = ball_count / ball_range

    results = []
    for item in feat_data['balls']:
        num = item['ball']
        feat = item['features']

        # 归一化后加权
        score = sum(
            min_max_norm(name, feat[name]) * name_to_imp.get(name, 0)
            for name in feature_names
        )
        total_imp = sum(name_to_imp.values())
        if total_imp > 0:
            score /= total_imp

        # 与先验混合
        prob = 0.25 * prior + 0.75 * score
        prob = max(0.02, min(0.90, prob))
        results.append({'ball': num, 'prob': prob})

    results.sort(key=lambda x: x['prob'], reverse=True)
    return results


def score_blue(history_data, ball_range=16):
    """蓝球/后区：遗漏期数 min-max 归一化"""
    if len(history_data) == 0:
        return [{'ball': b, 'prob': 1.0/ball_range} for b in range(1, ball_range+1)]

    miss = calculate_missing_periods(history_data, ball_range, 0)
    vals = list(miss.values())
    mn, mx = min(vals), max(vals)

    prior = 1.0 / ball_range
    results = []
    for b in range(1, ball_range + 1):
        m = miss.get(b, 0)
        norm = (m - mn) / (mx - mn) if mx > mn else 0.5
        prob = 0.3 * prior + 0.7 * norm
        prob = max(0.05, min(0.90, prob))
        results.append({'ball': b, 'prob': prob})
    results.sort(key=lambda x: x['prob'], reverse=True)
    return results


def predict_ssq(model_json, history_data):
    scored = score_balls_with_model(history_data, model_json, 33)
    if not scored:
        return None

    top6 = [r['ball'] for r in scored[:6]]
    blue_scored = score_blue(history_data, 16)
    blue_top = blue_scored[0]['ball']

    prob_dict = {str(r['ball']): round(r['prob'], 4) for r in scored}

    return {
        'type': 'ssq',
        'redBalls': sorted(top6),
        'blueBall': blue_top,
        'probabilities': prob_dict,
        'modelAuc': round(model_json.get('auc_rf') or 0, 4),
        'modelType': 'rf',
    }


def predict_dlt(model_json, history_data):
    scored = score_balls_with_model(history_data, model_json, 35)
    if not scored:
        return None

    top5 = [r['ball'] for r in scored[:5]]
    back_scored = score_blue(history_data, 12)
    top2_back = sorted([r['ball'] for r in back_scored[:2]])

    prob_dict = {str(r['ball']): round(r['prob'], 4) for r in scored}

    return {
        'type': 'dlt',
        'frontBalls': sorted(top5),
        'backBalls': top2_back,
        'probabilities': prob_dict,
        'modelAuc': round(model_json.get('auc_rf') or 0, 4),
        'modelType': 'rf',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ssq-only', action='store_true')
    parser.add_argument('--dlt-only', action='store_true')
    args = parser.parse_args()

    do_ssq = not args.dlt_only
    do_dlt = not args.ssq_only

    base_dir = Path(__file__).parent.parent
    results = {}

    for type_, pred_fn in [('ssq', predict_ssq), ('dlt', predict_dlt)]:
        if type_ == 'ssq' and not do_ssq:
            continue
        if type_ == 'dlt' and not do_dlt:
            continue

        hist_path = base_dir / 'data' / f'{type_}_history.json'
        history_data = None

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
                        rec['balls'] = sorted([int(x) for x in balls if 1 <= int(x) <= 33]) if isinstance(balls, list) else []
                        rec['blue'] = r.get('blueNumber') or r.get('blue') or 0
                    else:
                        front = r.get('frontNumbers') or r.get('front') or []
                        rec['balls'] = sorted([int(x) for x in front if 1 <= int(x) <= 35]) if isinstance(front, list) else []
                        back = r.get('backNumbers') or r.get('back') or []
                        rec['back'] = sorted([int(x) for x in back if 1 <= int(x) <= 12]) if isinstance(back, list) else []
                    if len(rec.get('balls', [])) >= 5:
                        records.append(rec)
                history_data = sorted(records, key=lambda x: x['period'], reverse=True)
                print(f'[{type_.upper()}] Electron数据: {len(history_data)}条, 最新期 {history_data[0]["period"]}')
            except Exception as e:
                print(f'[{type_.upper()}] Electron数据读取失败: {e}')

        if not history_data:
            history_data = load_records(type_)
            print(f'[{type_.upper()}] 内置数据: {len(history_data)}条, 最新期 {history_data[0]["period"] if history_data else "N/A"}')

        if not history_data:
            print(f'[{type_.upper()}] 无历史数据，跳过')
            results[type_] = None
            continue

        model_path = base_dir / 'models' / f'{type_}_model.json'
        if not model_path.exists():
            print(f'[{type_.upper()}] 模型不存在，先运行 train.py')
            results[type_] = None
            continue

        with open(model_path, 'r', encoding='utf-8') as f:
            model_json = json.load(f)

        pred = pred_fn(model_json, history_data)
        results[type_] = pred

        if pred:
            if type_ == 'ssq':
                print(f'[{type_.upper()}] ML预测: 红球 {pred["redBalls"]} + 蓝球 {pred["blueBall"]} (AUC={pred["modelAuc"]})')
                top5 = [int(ball) for ball, prob in sorted(pred["probabilities"].items(), key=lambda x: -x[1])[:5]]
                print(f'[{type_.upper()}] Top5概率: {top5}')
            else:
                print(f'[{type_.upper()}] ML预测: 前区 {pred["frontBalls"]} 后区 {pred["backBalls"]} (AUC={pred["modelAuc"]})')

    print(f'\n__RESULT_JSON__{json.dumps(results, ensure_ascii=False)}__END_RESULT__')


if __name__ == '__main__':
    main()
