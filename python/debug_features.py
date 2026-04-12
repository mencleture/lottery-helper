import sys, os, json
sys.path.insert(0, '.')

path = os.path.join('.', '..', 'data', 'ssq_history.json')
with open(path) as f:
    raw = json.load(f)

print('Total records:', len(raw))
for i, r in enumerate(raw[:3]):
    period_str = str(r.get('period') or '')
    print(f'  [{i}] period_str={repr(period_str)}, isdigit={period_str.isdigit()}')
    if period_str.isdigit():
        period = int(period_str)
        balls = r.get('balls', [])
        print(f'      period={period}, balls={balls}, len={len(balls)}')
