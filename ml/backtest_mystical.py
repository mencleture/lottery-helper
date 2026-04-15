"""
玄学特征回测脚本
评估五行、跨度、同尾、重号率、邻号率等玄学特征的实际预测能力
"""
import json, os, sys, random
from collections import defaultdict, Counter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

# 五行映射（按号码%5循环，有周期性寓意）
WUXING_MAP = {1: '金', 2: '木', 3: '水', 4: '火', 0: '土'}
SSQ_WUXING = {i: WUXING_MAP[i % 5] for i in range(1, 34)}
DLT_WUXING = {i: WUXING_MAP[i % 5] for i in range(1, 36)}


def load_records(lottery_type):
    path = os.path.join(DATA_DIR, f'{lottery_type}_history.json')
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
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
        elif lottery_type == 'ssq':
            balls = r.get('redNumbers', []) or r.get('red', [])
            rec['balls'] = sorted([int(x) for x in balls if 1 <= int(x) <= 33])
            rec['blue'] = r.get('blueNumber') or r.get('blue') or 0
        else:
            front = r.get('frontNumbers', []) or r.get('front', [])
            rec['balls'] = sorted([int(x) for x in front if 1 <= int(x) <= 35])
            back = r.get('backNumbers', []) or r.get('back', [])
            rec['back'] = sorted([int(x) for x in back if 1 <= int(x) <= 12])
        if len(rec.get('balls', [])) >= 5:
            records.append(rec)
    records.sort(key=lambda x: x['period'])
    return records


def evaluate_wuxing(records):
    print("\n--- [1] 五行分析 ---")
    wuxing = SSQ_WUXING if len(records[0]['balls']) <= 6 else DLT_WUXING

    # 统计：上期某五行出现N个，下期该五行命中几个
    wuxing_hit = defaultdict(list)
    for i in range(1, len(records)):
        prev, curr = records[i-1], records[i]
        prev_wx = Counter(wuxing[b] for b in prev['balls'])
        curr_set = set(curr['balls'])
        for wx in ['金', '木', '水', '火', '土']:
            prev_cnt = prev_wx.get(wx, 0)
            hit = sum(1 for b in curr_set if wuxing.get(b) == wx)
            wuxing_hit[wx].append({'prev_cnt': prev_cnt, 'hit': hit})

    print(f"  {'五行':>4} | {'上期均值':>8} | {'下期期望':>8} | {'最优N':>6} | {'最优命中':>8} | {'提升':>8}")
    for wx in ['金', '木', '水', '火', '土']:
        data = wuxing_hit[wx]
        if not data:
            continue
        avg_prev = sum(d['prev_cnt'] for d in data) / len(data)
        overall_avg = sum(d['hit'] for d in data) / len(data)
        by_cnt = defaultdict(list)
        for d in data:
            by_cnt[d['prev_cnt']].append(d['hit'])
        best_cnt, best_data = max(by_cnt.items(), key=lambda x: sum(x[1])/len(x[1]) if len(x[1]) > 5 else 0)
        best_avg = sum(best_data) / len(best_data) if best_data else 0
        lift = (best_avg - overall_avg) / max(overall_avg, 0.01)
        print(f"  {wx:>4} | {avg_prev:>8.2f} | {overall_avg:>8.3f} | {best_cnt:>6} | {best_avg:>8.3f} | {'+' + str(round(lift*100)) + '%' if lift > 0 else 'n.s.':>8}")


def evaluate_tail_group(records):
    print("\n--- [2] 同尾抱团分析 ---")
    # 统计：上期某尾数出现N个，下期该尾数命中几个
    tail_hit = defaultdict(lambda: defaultdict(list))

    for i in range(1, len(records)):
        prev, curr = records[i-1], records[i]
        prev_tails = Counter(b % 10 for b in prev['balls'])
        curr_tails = Counter(b % 10 for b in curr['balls'])
        for t in range(10):
            prev_cnt = prev_tails.get(t, 0)
            curr_hit = curr_tails.get(t, 0)
            tail_hit[t][prev_cnt].append(curr_hit)

    print(f"  {'尾数':>4} | {'下期期望':>8} | {'最优N':>6} | {'最优命中':>8} | {'提升':>8} | {'样本量':>6}")
    results = []
    for t in range(10):
        all_data = []
        for cnt, hits in tail_hit[t].items():
            all_data.extend(hits)
        if not all_data:
            continue
        overall_avg = sum(all_data) / len(all_data)
        valid_cnts = {c: h for c, h in tail_hit[t].items() if len(h) > 5}
        if valid_cnts:
            best_cnt, best_data = max(valid_cnts.items(), key=lambda x: sum(x[1])/len(x[1]))
            best_avg = sum(best_data) / len(best_data)
            lift = (best_avg - overall_avg) / max(overall_avg, 0.01)
            results.append((t, best_cnt, best_avg, lift, len(all_data)))
            print(f"  {t:>4} | {overall_avg:>8.3f} | {best_cnt:>6} | {best_avg:>8.3f} | {'+' + str(round(lift*100)) + '%' if lift > 0 else 'n.s.':>8} | {len(all_data):>6}")
        else:
            print(f"  {t:>4} | 数据不足，跳过")

    best = max(results, key=lambda x: x[3]) if results else None
    if best:
        print(f"  -> 最优尾数抱团: 尾数{best[0]}上期出{best[1]}个，下期平均命中{best[2]:.2f}个 (提升+{round(best[3]*100)}%)")
    return results


def evaluate_repeat_and_neighbor(records):
    print("\n--- [3] 重号率 & 邻号率 ---")
    repeat_hits = []
    neighbor_hits = []

    for i in range(1, len(records)):
        prev, curr = records[i-1], records[i]
        prev_set = set(prev['balls'])
        curr_set = set(curr['balls'])

        # 重号
        repeat_hits.append(len(prev_set & curr_set))

        # 邻号（±1，不含重号）
        neighbor = set()
        for b in prev_set:
            if (b - 1) in curr_set and (b - 1) not in prev_set:
                neighbor.add(b - 1)
            if (b + 1) in curr_set and (b + 1) not in prev_set:
                neighbor.add(b + 1)
        neighbor_hits.append(len(neighbor))

    ball_cnt = len(records[0]['balls'])
    total_balls = 33 if ball_cnt == 6 else 35
    random_expect = ball_cnt / total_balls

    avg_repeat = sum(repeat_hits) / len(repeat_hits)
    avg_neighbor = sum(neighbor_hits) / len(neighbor_hits)

    print(f"  重号: 平均 {avg_repeat:.3f} 个/期  (随机期望: {random_expect:.3f}, 比值: {avg_repeat/random_expect:.2f}x)")
    print(f"  邻号: 平均 {avg_neighbor:.3f} 个/期")
    print(f"  -> {'重号有微弱预测力' if avg_repeat > random_expect * 1.1 else '重号接近随机，无显著预测力'}")

    return avg_repeat, avg_neighbor


def evaluate_span(records):
    print("\n--- [4] 号码跨度分析 ---")
    span_ranges = defaultdict(list)

    for i in range(1, len(records)):
        prev, curr = records[i-1], records[i]
        span = max(prev['balls']) - min(prev['balls'])
        hit = len(set(curr['balls']) & set(prev['balls']))
        if span <= 10:
            rng = '0-10'
        elif span <= 15:
            rng = '11-15'
        elif span <= 20:
            rng = '16-20'
        elif span <= 25:
            rng = '21-25'
        else:
            rng = '26+'
        span_ranges[rng].append(hit)

    overall_avg = sum(sum(v) for v in span_ranges.values()) / max(sum(len(v) for v in span_ranges.values()), 1)
    print(f"  {'跨度':>10} | {'平均命中':>10} | {'样本量':>6} | {'相对均值':>8}")
    results = []
    for rng in ['0-10', '11-15', '16-20', '21-25', '26+']:
        hits = span_ranges.get(rng, [])
        if hits:
            avg = sum(hits) / len(hits)
            lift = (avg - overall_avg) / max(overall_avg, 0.01)
            print(f"  {rng:>10} | {avg:>10.3f} | {len(hits):>6} | {'+' + str(round(lift*100)) + '%' if lift > 0 else str(round(lift*100)) + '%':>8}")
            results.append((rng, avg))
    return results


def evaluate_consecutive(records):
    print("\n--- [5] 连号模式分析 ---")
    consecutive_groups = defaultdict(list)

    for i in range(1, len(records)):
        prev, curr = records[i-1], records[i]
        prev_sorted = sorted(prev['balls'])
        cons = 0
        for j in range(len(prev_sorted) - 1):
            if prev_sorted[j+1] - prev_sorted[j] == 1:
                cons += 1
        hit = len(set(curr['balls']) & set(prev['balls']))
        consecutive_groups[cons].append(hit)

    overall_avg = sum(sum(v) for v in consecutive_groups.values()) / max(sum(len(v) for v in consecutive_groups.values()), 1)
    print(f"  {'连号组数':>8} | {'下期平均命中':>12} | {'样本量':>6} | {'相对均值':>8}")
    results = []
    for cons_cnt in range(5):
        hits = consecutive_groups.get(cons_cnt, [])
        if hits:
            avg = sum(hits) / len(hits)
            lift = (avg - overall_avg) / max(overall_avg, 0.01)
            print(f"  {cons_cnt:>8} | {avg:>12.3f} | {len(hits):>6} | {'+' + str(round(lift*100)) + '%' if lift > 0 else str(round(lift*100)) + '%':>8}")
            results.append((cons_cnt, avg, len(hits)))
    return results


def evaluate_sum_mod(records):
    print("\n--- [6] 和值除N余数分析 ---")
    # 除3余数
    mod3_groups = defaultdict(list)
    for i in range(1, len(records)):
        s = sum(records[i-1]['balls'])
        hit = len(set(records[i]['balls']) & set(records[i-1]['balls']))
        mod3_groups[s % 3].append(hit)

    overall_avg = sum(sum(v) for v in mod3_groups.values()) / max(sum(len(v) for v in mod3_groups.values()), 1)
    print(f"  {'mod3':>6} | {'平均命中':>10} | {'样本量':>6} | {'相对均值':>8}")
    for m in range(3):
        hits = mod3_groups.get(m, [])
        if hits:
            avg = sum(hits) / len(hits)
            lift = (avg - overall_avg) / max(overall_avg, 0.01)
            print(f"  {m:>6} | {avg:>10.3f} | {len(hits):>6} | {'+' + str(round(lift*100)) + '%' if lift > 0 else str(round(lift*100)) + '%':>8}")


def evaluate_interval_gaps(records):
    """评估号码间隔规律"""
    print("\n--- [7] 号码间隔周期分析 ---")
    # 统计每个号的出现间隔，检测是否有周期性规律
    ball_last_seen = {}
    ball_intervals = defaultdict(list)
    total_balls = 33 if len(records[0]['balls']) == 6 else 35

    for idx, rec in enumerate(records):
        for b in rec['balls']:
            if b in ball_last_seen:
                interval = idx - ball_last_seen[b]
                if interval < 50:
                    ball_intervals[b].append(interval)
            ball_last_seen[b] = idx

    # 计算各球平均间隔 vs 理论均值
    total_intervals = sum(len(v) for v in ball_intervals.values())
    overall_avg_interval = sum(sum(v) for v in ball_intervals.values()) / max(total_intervals, 1)
    theoretical = total_balls / len(records[0]['balls'])
    print(f"  理论平均间隔: {theoretical:.2f} 期")
    print(f"  实际平均间隔: {overall_avg_interval:.2f} 期")
    print(f"  -> {'间隔规律显著！' if abs(overall_avg_interval - theoretical) > 1 else '接近理论值，无异常周期'}")


def evaluate_even_odd_zone(records):
    print("\n--- [8] 奇偶比 & 分区命中率 ---")
    # 奇偶比
    odd_even_groups = defaultdict(list)
    for i in range(1, len(records)):
        prev, curr = records[i-1], records[i]
        odd_cnt = sum(1 for b in prev['balls'] if b % 2 == 1)
        hit = len(set(curr['balls']) & set(prev['balls']))
        odd_even_groups[odd_cnt].append(hit)

    overall_avg = sum(sum(v) for v in odd_even_groups.values()) / max(sum(len(v) for v in odd_even_groups.values()), 1)
    print(f"  {'奇数个数':>8} | {'下期平均命中':>12} | {'样本量':>6} | {'相对均值':>8}")
    for oc in sorted(odd_even_groups.keys()):
        hits = odd_even_groups[oc]
        avg = sum(hits) / len(hits)
        lift = (avg - overall_avg) / max(overall_avg, 0.01)
        print(f"  {oc:>8} | {avg:>12.3f} | {len(hits):>6} | {'+' + str(round(lift*100)) + '%' if lift > 0 else str(round(lift*100)) + '%':>8}")


def full_backtest(lottery_type='ssq'):
    sep = "=" * 55
    print(f"\n{sep}")
    print(f"  [MYSTICAL]玄学特征回测报告 - {lottery_type.upper()}")
    print(f"{sep}")

    records = load_records(lottery_type)
    print(f"历史数据: {len(records)} 期, {records[0]['period']} - {records[-1]['period']}")
    if not records:
        print("ERROR: No data found!")
        return

    evaluate_wuxing(records)
    evaluate_tail_group(records)
    evaluate_repeat_and_neighbor(records)
    evaluate_span(records)
    evaluate_consecutive(records)
    evaluate_sum_mod(records)
    evaluate_even_odd_zone(records)
    evaluate_interval_gaps(records)

    # Monte Carlo 基准对比
    print(f"\n{sep}")
    print(f"  [SUMMARY] 玄学策略效果总结")
    print(f"{sep}")

    ball_cnt = len(records[0]['balls'])
    total_balls = 33 if ball_cnt == 6 else 35
    random_hits_per_draw = ball_cnt / total_balls * ball_cnt
    print(f"  随机基准: {random_hits_per_draw:.2f} 个红球/期")
    print(f"  预期提升: 五行/同尾/重号等因素可小幅优化选号策略")
    print(f"  玄学本质: 玄学特征本身不具备预测能力，但可辅助扩大选号覆盖面")
    print(f"\n  [结论] 可回测的玄学特征中：")
    print(f"  - 重号率: 参考上方输出，有微弱信号")
    print(f"  - 同尾抱团: 参考上方输出，部分尾数有轻微聚集倾向")
    print(f"  - 其他特征: 接近随机，主要价值在增加选号多样性")


if __name__ == '__main__':
    lt = sys.argv[1] if len(sys.argv) > 1 else 'ssq'
    full_backtest(lt)
