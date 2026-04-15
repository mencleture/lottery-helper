"""
统计分析模块 - 彩票历史数据深度分析
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

def load_data(type_):
    path = Path(__file__).parent / 'data' / f'{type_}_history.json'
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def analyze_ssq(data, n_recent=50):
    n = len(data)
    balls = list(range(1, 34))
    blue_balls = list(range(1, 17))

    # 频率（所有期）
    red_freq = Counter()
    blue_freq = Counter()
    for item in data:
        red_freq.update(item['redNumbers'])
        blue_freq.update([item['blueNumber']])

    # 遗漏值：最近多少期没出（data[0]=最新期）
    last_appear = {b: None for b in balls}
    for i, item in enumerate(data):
        for b in item['redNumbers']:
            if last_appear[b] is None:
                last_appear[b] = i

    missing = {b: last_appear[b] if last_appear[b] is not None else 999 for b in balls}

    blue_last = {b: None for b in blue_balls}
    for i, item in enumerate(data):
        if blue_last[item['blueNumber']] is None:
            blue_last[item['blueNumber']] = i
    blue_missing = {b: blue_last[b] if blue_last[b] is not None else 999 for b in blue_balls}

    # 近期频率（最近n期）
    recent_freq = Counter()
    for item in data[:n_recent]:
        recent_freq.update(item['redNumbers'])

    # 共现矩阵（最近30期）
    co_occur = defaultdict(Counter)
    for item in data[:30]:
        reds = sorted(item['redNumbers'])
        for i in range(len(reds)):
            for j in range(i+1, len(reds)):
                co_occur[reds[i]][reds[j]] += 1

    # 奇偶比分布
    odd_even_dist = Counter()
    size_dist = Counter()
    sum_dist = Counter()
    ac_dist = Counter()
    consecutive_count = 0

    for item in data:
        reds = sorted(item['redNumbers'])
        odd = sum(1 for r in reds if r % 2 == 1)
        even = 6 - odd
        odd_even_dist[f"{odd}:{even}"] += 1
        small = sum(1 for r in reds if r <= 16)
        large = 6 - small
        size_dist[f"{small}:{large}"] += 1
        sum_dist[f"{sum(reds)}"] += 1
        ac_dist[str(calc_ac(reds))] += 1
        # 连号
        for i in range(len(reds)-1):
            if reds[i+1] - reds[i] == 1:
                consecutive_count += 1

    # 和值
    sums = [sum(item['redNumbers']) for item in data]
    avg_sum = sum(sums) / len(sums)
    sum_ranges = Counter()
    for s in sums:
        rng = (s // 10) * 10
        sum_ranges[f"{rng}-{rng+9}"] += 1

    # 理论频率
    expected = n / 33.0
    blue_expected = n / 16.0

    # 偏离分析
    deviation = {b: round(red_freq.get(b, 0) - expected, 1) for b in balls}
    most_over = sorted(balls, key=lambda b: deviation[b], reverse=True)[:5]
    most_under = sorted(balls, key=lambda b: deviation[b])[:5]

    # 分区热号
    zones = [Counter() for _ in range(3)]
    for item in data:
        for r in item['redNumbers']:
            zones[(r-1)//11][r] += 1

    # 最热/最冷
    hot_balls = sorted(balls, key=lambda b: recent_freq.get(b, 0), reverse=True)
    cold_balls = sorted(balls, key=lambda b: missing[b], reverse=True)
    # 长期不出+近期也冷
    hot_miss_balls = sorted(balls, key=lambda b: (-missing[b], recent_freq.get(b, 0)))[:5]
    blue_hot = sorted(blue_balls, key=lambda b: blue_freq.get(b, 0), reverse=True)
    blue_cold = sorted(blue_balls, key=lambda b: blue_missing[b], reverse=True)

    return {
        'total': n,
        'hot_balls': hot_balls[:10],
        'cold_balls': cold_balls[:5],
        'hot_miss_balls': hot_miss_balls,
        'blue_hot': blue_hot[:8],
        'blue_cold': blue_cold[:8],
        'expected': round(expected, 1),
        'blue_expected': round(blue_expected, 1),
        'red_freq': {str(b): red_freq.get(b, 0) for b in balls},
        'recent_freq': {str(b): recent_freq.get(b, 0) for b in balls},
        'missing': {str(b): missing[b] for b in balls},
        'blue_missing': {str(b): blue_missing[b] for b in blue_balls},
        'deviation': {str(b): deviation[b] for b in balls},
        'most_over': most_over,
        'most_under': most_under,
        'odd_even_dist': dict(sorted(odd_even_dist.items(), key=lambda x: -x[1])),
        'size_dist': dict(sorted(size_dist.items(), key=lambda x: -x[1])),
        'sum_avg': round(avg_sum, 1),
        'sum_ranges': dict(sorted(sum_ranges.items(), key=lambda x: -x[1])[:6]),
        'ac_dist': dict(sorted(ac_dist.items(), key=lambda x: int(x[0]))),
        'consecutive_rate': round(consecutive_count / n, 2),
        'co_occur': {str(k): dict(v.most_common(5)) for k, v in list(co_occur.items())[:15]},
        'zone_hot': [[z.most_common(3) for z in zones]],
    }

def analyze_dlt(data, n_recent=50):
    n = len(data)
    front_balls = list(range(1, 36))
    back_balls = list(range(1, 13))

    front_freq = Counter()
    back_freq = Counter()
    for item in data:
        front_freq.update(item['frontNumbers'])
        back_freq.update(item['backNumbers'])

    front_last = {b: None for b in front_balls}
    for i, item in enumerate(data):
        for b in item['frontNumbers']:
            if front_last[b] is None:
                front_last[b] = i
    front_missing = {b: front_last[b] if front_last[b] is not None else 999 for b in front_balls}

    back_last = {b: None for b in back_balls}
    for i, item in enumerate(data):
        for b in item['backNumbers']:
            if back_last[b] is None:
                back_last[b] = i
    back_missing = {b: back_last[b] if back_last[b] is not None else 999 for b in back_balls}

    recent_front = Counter()
    for item in data[:n_recent]:
        recent_front.update(item['frontNumbers'])

    front_co = defaultdict(Counter)
    for item in data[:30]:
        nums = sorted(item['frontNumbers'])
        for i in range(len(nums)):
            for j in range(i+1, len(nums)):
                front_co[nums[i]][nums[j]] += 1

    odd_even = Counter()
    for item in data:
        fo = sum(1 for r in item['frontNumbers'] if r % 2 == 1)
        odd_even[f"{fo}:{5-fo}"] += 1

    front_sums = [sum(item['frontNumbers']) for item in data]
    avg_sum = sum(front_sums) / len(front_sums)

    front_zones = [Counter() for _ in range(5)]
    for item in data:
        for r in item['frontNumbers']:
            front_zones[(r-1)//7][r] += 1

    back_pair = Counter()
    for item in data:
        pair = tuple(sorted(item['backNumbers']))
        back_pair[pair] += 1

    front_expected = n / 35.0
    back_expected = n * 2 / 12.0
    front_dev = {b: round(front_freq.get(b, 0) - front_expected, 1) for b in front_balls}
    back_dev = {b: round(back_freq.get(b, 0) - back_expected, 1) for b in back_balls}

    front_hot = sorted(front_balls, key=lambda b: recent_front.get(b, 0), reverse=True)
    front_cold = sorted(front_balls, key=lambda b: front_missing[b], reverse=True)
    front_hot_miss = sorted(front_balls, key=lambda b: (-front_missing[b], recent_front.get(b, 0)))[:5]
    back_hot = sorted(back_balls, key=lambda b: back_freq.get(b, 0), reverse=True)
    back_cold = sorted(back_balls, key=lambda b: back_missing[b], reverse=True)

    return {
        'total': n,
        'front_hot': front_hot[:10],
        'front_cold': front_cold[:5],
        'front_hot_miss': front_hot_miss,
        'back_hot': back_hot[:8],
        'back_cold': back_cold[:8],
        'front_expected': round(front_expected, 1),
        'back_expected': round(back_expected, 1),
        'front_freq': {str(b): front_freq.get(b, 0) for b in front_balls},
        'back_freq': {str(b): back_freq.get(b, 0) for b in back_balls},
        'front_missing': {str(b): front_missing[b] for b in front_balls},
        'back_missing': {str(b): back_missing[b] for b in back_balls},
        'front_dev': {str(b): front_dev[b] for b in front_balls},
        'back_dev': {str(b): back_dev[b] for b in back_balls},
        'odd_even': dict(sorted(odd_even.items(), key=lambda x: -x[1])),
        'front_sum_avg': round(avg_sum, 1),
        'front_hot_co': {str(k): dict(v.most_common(5)) for k, v in list(front_co.items())[:15]},
        'back_pair': dict(back_pair.most_common(10)),
        'zone_hot': [[z.most_common(3) for z in front_zones]],
    }

def calc_ac(reds):
    diffs = []
    for i in range(len(reds)):
        for j in range(i+1, len(reds)):
            diffs.append(reds[j] - reds[i])
    return len(set(diffs)) - 5

if __name__ == '__main__':
    import sys
    type_ = sys.argv[1] if len(sys.argv) > 1 else 'ssq'
    n_recent = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    data = load_data(type_)
    if type_ == 'ssq':
        result = analyze_ssq(data, n_recent)
    else:
        result = analyze_dlt(data, n_recent)
    print("__RESULT_JSON__")
    print(json.dumps({type_: result}, ensure_ascii=False, indent=2))
    print("__END_RESULT__")
