"""特征工程：统一处理 SSQ 和 DLT，含玄学增强特征"""
import json
import os
import math
from collections import Counter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")

# ============ 五行属性（按号码%5循环） ============
WUXING_MAP = {1: '金', 2: '木', 3: '水', 4: '火', 0: '土'}
SSQ_WUXING = {i: WUXING_MAP[i % 5] for i in range(1, 34)}
DLT_WUXING = {i: WUXING_MAP[i % 5] for i in range(1, 36)}


def load_records(lottery_type):
    """加载历史记录"""
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

        if 'balls' in r and r['balls']:
            rec['balls'] = r['balls']
        elif lottery_type == 'ssq':
            balls = r.get('redNumbers') or r.get('red') or []
            rec['balls'] = sorted([int(x) for x in balls if 1 <= int(x) <= 33])
            rec['blue'] = r.get('blueNumber') or r.get('blue') or 0
        else:
            front = r.get('frontNumbers') or r.get('front') or []
            rec['balls'] = sorted([int(x) for x in front if 1 <= int(x) <= 35])
            back = r.get('backNumbers') or r.get('back') or []
            rec['back'] = sorted([int(x) for x in back if 1 <= int(x) <= 12])

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
    
    每个球特征向量共24维:
    [0-15]  原16维（遗漏/频率/AC/和值等）
    [16]    last_tail_2: 上期该球尾数是否出现2次（玄学特征）
    [17]    last_wuxing_cnt: 上期该球五行属性的出现次数
    [18]    last_repeat: 上期有多少个重号（全局，重号率特征）
    [19]    tail_group_count: 上期有多少个尾数出现2+次（同尾抱团特征）
    [20]    wuxing_cold_boost: 该五行上期出现0次=1（冷五行回补信号）
    [21]    span_range: 跨度区间（0-4）
    [22]    sum_mod3: 和值%3
    [23]    consecutive_count: 上期连号组数
    """
    miss50 = calculate_missing_periods(records, ball_range, up_to_idx)
    freq50 = calculate_frequency(records, ball_range, up_to_idx, 50)
    freq20 = calculate_frequency(records, ball_range, up_to_idx, 20)
    freq10 = calculate_frequency(records, ball_range, up_to_idx, 10)

    balls = records[up_to_idx]['balls']
    wuxing = SSQ_WUXING if ball_range == 33 else DLT_WUXING

    avg_miss = sum(miss50[b] for b in balls) / len(balls)
    avg_freq50 = sum(freq50[b] for b in balls) / len(balls)
    avg_freq20 = sum(freq20[b] for b in balls) / len(balls)
    avg_freq10 = sum(freq10[b] for b in balls) / len(balls)
    ac = calculate_ac(balls)
    tails = len(set(b % 10 for b in balls))
    ball_sum = sum(balls)
    odd_count = sum(1 for b in balls if b % 2 == 1)
    small_count = sum(1 for b in balls if b <= ball_range // 2)

    # ========== 玄学增强特征（基于上期开奖） ==========
    if up_to_idx + 1 < len(records):
        last_balls = records[up_to_idx + 1]['balls']
    else:
        last_balls = []

    # [玄学1] 上期各尾数出现次数
    last_tails = Counter(b % 10 for b in last_balls)

    # [玄学2] 上期各五行出现次数
    last_wuxing = Counter(wuxing.get(b, '土') for b in last_balls)

    # [玄学3] 重号数
    last_set = set(last_balls)
    repeat_cnt = len(set(balls) & last_set)

    # [玄学4] 同尾抱团数（上期有多少个尾数出现2+次）
    tail_group_count = sum(1 for cnt in last_tails.values() if cnt >= 2)

    # [玄学5] 跨度区间
    if last_balls:
        span = max(last_balls) - min(last_balls)
        if span <= 10:
            span_range = 0
        elif span <= 15:
            span_range = 1
        elif span <= 20:
            span_range = 2
        elif span <= 25:
            span_range = 3
        else:
            span_range = 4
    else:
        span_range = 2

    # [玄学6] 上期连号组数
    if last_balls:
        sorted_last = sorted(last_balls)
        consec = 0
        for j in range(len(sorted_last) - 1):
            if sorted_last[j+1] - sorted_last[j] == 1:
                consec += 1
    else:
        consec = 0

    # [玄学7] 和值%3
    sum_mod3 = ball_sum % 3

    X, y = [], []
    for num in range(1, ball_range + 1):
        tail = num % 10
        wx = wuxing.get(num, '土')

        # 上期该尾数出现几次（>1=抱团信号）
        last_tail_cnt = last_tails.get(tail, 0)

        # 上期该五行出现几次（=0=冷五行回补信号）
        last_wx_cnt = last_wuxing.get(wx, 0)

        # 该球五行是否上期为0（冷五行回补）
        wx_cold_boost = 1 if last_wx_cnt == 0 else 0

        X.append([
            miss50.get(num, 0),              # 0  遗漏期数
            freq50.get(num, 0),              # 1  50期频率
            freq20.get(num, 0),              # 2  20期频率
            freq10.get(num, 0),              # 3  10期频率
            avg_miss,                        # 4  本期平均遗漏
            avg_freq50,                      # 5  本期平均50期频率
            avg_freq20,                      # 6  本期平均20期频率
            avg_freq10,                      # 7  本期平均10期频率
            ac,                              # 8  AC值
            tails,                           # 9  尾数种类
            ball_sum,                        # 10 和值
            odd_count,                       # 11 奇数个数
            1 if num % 2 == 0 else 0,       # 12 是否偶数
            num % 10,                        # 13 尾数
            1 if num <= ball_range // 2 else 0,  # 14 是否小号
            num,                             # 15 球号本身
            1 if last_tail_cnt >= 2 else 0,  # 16 [玄学] 同尾抱团信号
            last_wx_cnt,                     # 17 [玄学] 上期该五行出现次数
            repeat_cnt,                      # 18 [玄学] 全局重号数
            tail_group_count,                # 19 [玄学] 同尾抱团总数
            wx_cold_boost,                   # 20 [玄学] 冷五行回补信号
            span_range,                      # 21 [玄学] 跨度区间
            sum_mod3,                        # 22 [玄学] 和值%3
            consec,                          # 23 [玄学] 上期连号组数
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


def feature_names():
    """返回特征名（用于分析特征重要性）"""
    base = [
        '遗漏期数', '50期频率', '20期频率', '10期频率',
        '平均遗漏', '平均50期频率', '平均20期频率', '平均10期频率',
        'AC值', '尾数种类', '和值', '奇数个数',
        '是否偶数', '尾数', '是否小号', '球号',
    ]
    mystical = [
        '同尾抱团信号', '上期五行出现次数', '全局重号数',
        '同尾抱团总数', '冷五行回补信号', '跨度区间',
        '和值%3', '上期连号组数',
    ]
    return base + mystical


if __name__ == '__main__':
    for lt in ['ssq', 'dlt']:
        records = load_records(lt)
        print(f'{lt}: {len(records)} records')
        if records:
            X, y = build_sample_features(records, 33 if lt == 'ssq' else 35, 0)
            print(f'  Features: {len(X[0])}, Samples: {len(X)}, Positive: {sum(y)}')
