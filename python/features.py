"""特征工程：统一处理 SSQ 和 DLT"""
import json
import os
import math
from collections import Counter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")


def load_records(lottery_type):
    """加载历史记录
    支持格式：
    - Electron导出格式: {period, redNumbers/red, blueNumber/blue} 或 {period, frontNumbers/front, backNumbers/back}
    - 内置转换格式: {period, balls, blue/back}
    """
    path = os.path.join(DATA_DIR, f'{lottery_type}_history.json')
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)

    records = []
    for r in raw:
        period_str = str(r.get('period') or '').strip().strip('"')
        period = int(period_str) if period_str.isdigit() else 0
        if not period:
            continue

        rec = {'period': period}

        # 优先用已转换格式（balls 字段）
        if 'balls' in r and r['balls']:
            rec['balls'] = r['balls']
        elif lottery_type == 'ssq':
            balls = r.get('redNumbers') or r.get('red') or []
            rec['balls'] = sorted([int(x) for x in balls if 1 <= int(x) <= 33]) if isinstance(balls, list) else []
            rec['blue'] = r.get('blueNumber') or r.get('blue') or 0
        else:  # dlt
            front = r.get('frontNumbers') or r.get('front') or []
            rec['balls'] = sorted([int(x) for x in front if 1 <= int(x) <= 35]) if isinstance(front, list) else []
            rec['back'] = r.get('backNumbers') or r.get('back') or []
            if isinstance(rec['back'], list):
                rec['back'] = sorted([int(x) for x in rec['back'] if 1 <= int(x) <= 12])

        if len(rec.get('balls', [])) >= 5:
            records.append(rec)

    records.sort(key=lambda x: x['period'], reverse=True)
    return records


def calculate_missing_periods(records, ball_range, up_to_idx):
    """计算各号码在 up_to_idx 时期的遗漏期数"""
    result = {i: 0 for i in range(1, ball_range + 1)}
    if up_to_idx < 0 or len(records) == 0:
        return result

    target_period = records[up_to_idx]['period']
    for i in range(up_to_idx - 1, -1, -1):
        gap = target_period - records[i]['period']
        if gap > 100:
            break
        target_period = records[i]['period']
        for b in records[i]['balls']:
            if 1 <= b <= ball_range:
                result[b] = gap
    return result


def calculate_frequency(records, ball_range, up_to_idx, window=50):
    """计算各号码最近N期出现次数"""
    result = {i: 0 for i in range(1, ball_range + 1)}
    if up_to_idx < 0:
        return result
    start = max(0, up_to_idx - window + 1)
    for i in range(start, up_to_idx + 1):
        for b in records[i]['balls']:
            if 1 <= b <= ball_range:
                result[b] += 1
    return result


def calculate_ac(balls):
    """计算 AC 值（号码复杂度）"""
    if len(balls) < 2:
        return 0
    diffs = sorted(set(abs(balls[i] - balls[j]) for i in range(len(balls)) for j in range(i + 1, len(balls))))
    return len(diffs) - (len(balls) - 1)


def build_sample_features(records, ball_range, up_to_idx):
    """为某一期构建特征，返回 (X, y)
    X: 每个球的特征向量 [f1..f16]
    y: 标签（1=被选中，0=未选中）
    """
    miss50 = calculate_missing_periods(records, ball_range, up_to_idx)
    freq50 = calculate_frequency(records, ball_range, up_to_idx, 50)
    freq20 = calculate_frequency(records, ball_range, up_to_idx, 20)
    freq10 = calculate_frequency(records, ball_range, up_to_idx, 10)

    balls = records[up_to_idx]['balls']
    avg_miss = sum(miss50[b] for b in balls if b in miss50) / len(balls)
    avg_freq50 = sum(freq50[b] for b in balls if b in freq50) / len(balls)
    avg_freq20 = sum(freq20[b] for b in balls if b in freq20) / len(balls)
    avg_freq10 = sum(freq10[b] for b in balls if b in freq10) / len(balls)
    ac = calculate_ac(balls)
    tails = len(set(b % 10 for b in balls))
    ball_sum = sum(balls)
    odd_count = sum(1 for b in balls if b % 2 == 1)

    X, y = [], []
    for num in range(1, ball_range + 1):
        X.append([
            miss50.get(num, 0),       # 0  遗漏期数
            freq50.get(num, 0),       # 1  50期频率
            freq20.get(num, 0),       # 2  20期频率
            freq10.get(num, 0),       # 3  10期频率
            avg_miss,                 # 4  本期平均遗漏
            avg_freq50,               # 5  本期平均50期频率
            avg_freq20,               # 6  本期平均20期频率
            avg_freq10,               # 7  本期平均10期频率
            ac,                       # 8  AC值
            tails,                    # 9  尾数种类
            ball_sum,                 # 10 和值
            odd_count,                # 11 奇数个数
            1 if num % 2 == 0 else 0,  # 12 是否偶数
            num % 10,                 # 13 尾数
            1 if num <= ball_range // 2 else 0,  # 14 是否小号
            num,                      # 15 球号本身
        ])
        y.append(1 if num in balls else 0)

    return X, y


def build_all_samples(records, ball_range, train_start=50):
    """构建所有样本"""
    X_all, y_all = [], []
    for i in range(train_start, len(records)):
        X, y = build_sample_features(records, ball_range, i)
        X_all.extend(X)
        y_all.extend(y)
    return X_all, y_all


if __name__ == '__main__':
    for lt in ['ssq', 'dlt']:
        records = load_records(lt)
        print(f'{lt}: {len(records)} 条')
        if records:
            print(f'  最新: 第{records[0]["period"]}期, {records[0]}')
