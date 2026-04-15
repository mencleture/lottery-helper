"""抓取500.com全量历史数据（不限页数，自动探测）"""
import asyncio, json, re, time
from pathlib import Path
from playwright.async_api import async_playwright

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

def parse_tbody(html):
    """从HTML中提取tbody里的数据"""
    tbody_m = re.search(r'<tbody[^>]*id=["\']tdata["\'][^>]*>(.*?)</tbody>', html, re.DOTALL)
    if not tbody_m:
        return []
    body = tbody_m.group(1)
    trs = re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.DOTALL)
    records = []
    for tr in trs:
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.DOTALL)
        tds = [re.sub(r'<[^>]+>', '', t).strip() for t in tds]
        tds = [t for t in tds if t]
        if len(tds) >= 8:
            period = re.sub(r'\D', '', tds[0])
            if len(period) < 5:
                continue
            reds = []
            for i in range(1, 7):
                try:
                    n = int(tds[i])
                    if 1 <= n <= 33:
                        reds.append(n)
                except:
                    pass
            try:
                blue = int(tds[7])
                if not (1 <= blue <= 16):
                    blue = 0
            except:
                blue = 0
            if len(reds) == 6 and blue > 0:
                records.append({'period': int(period), 'redNumbers': sorted(reds), 'blueNumber': blue,
                               'balls': sorted(reds) + [blue]})
    return records

def parse_dlt(html):
    tbody_m = re.search(r'<tbody[^>]*id=["\']tdata["\'][^>]*>(.*?)</tbody>', html, re.DOTALL)
    if not tbody_m:
        return []
    body = tbody_m.group(1)
    trs = re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.DOTALL)
    records = []
    for tr in trs:
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.DOTALL)
        tds = [re.sub(r'<[^>]+>', '', t).strip() for t in tds]
        tds = [t for t in tds if t]
        if len(tds) >= 8:
            period = re.sub(r'\D', '', tds[0])
            if len(period) < 5:
                continue
            front = []
            for i in range(1, 6):
                try:
                    n = int(tds[i])
                    if 1 <= n <= 35:
                        front.append(n)
                except:
                    pass
            back = []
            for i in range(6, 8):
                try:
                    n = int(tds[i])
                    if 1 <= n <= 12:
                        back.append(n)
                except:
                    pass
            if len(front) == 5 and len(back) == 2:
                records.append({'period': int(period), 'frontNumbers': sorted(front), 'backNumbers': sorted(back),
                               'balls': sorted(front) + sorted(back)})
    return records

def load_existing(path):
    if path.exists():
        with open(path, encoding='utf-8') as f:
            return {r['period']: r for r in json.load(f)}
    return {}

async def fetch_lottery(lt, max_pages=100):
    url = f'https://datachart.500.com/{lt}/history/newinc/history.php'
    data_path = DATA_DIR / f'{lt}_history.json'
    
    existing = load_existing(data_path)
    print(f'{lt}: 已有 {len(existing)} 期数据')
    
    records = []
    page_size = 100
    consecutive_empty = 0
    
    for page in range(1, max_pages + 1):
        start = (page - 1) * page_size + 1
        end = page * page_size
        page_url = f'{url}?start={start}&end={end}'
        
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page_obj = await browser.new_page()
                await page_obj.set_extra_http_headers(HEADERS)
                await page_obj.goto(page_url, wait_until='networkidle', timeout=20000)
                
                html = await page_obj.content()
                await browser.close()
        except Exception as e:
            print(f'  第{page}页 网络错误: {e}')
            consecutive_empty += 1
            if consecutive_empty >= 3:
                break
            continue
        
        parse_fn = parse_tbody if lt == 'ssq' else parse_dlt
        new_records = parse_fn(html)
        
        if not new_records:
            consecutive_empty += 1
            print('  第' + str(page) + '页: 无数据 (连续' + str(consecutive_empty) + '页空白)')
            if consecutive_empty >= 3:
                break
            continue
        
        consecutive_empty = 0
        added = 0
        for r in new_records:
            if r['period'] not in existing:
                records.append(r)
                added += 1
        
        periods = [r['period'] for r in new_records]
        print(f'  第{page}页: {min(periods)}-{max(periods)} 共{len(new_records)}条, 新增{added}')
        
        if page >= 50 and page % 10 == 0:
            print(f'  已获取约 {page * page_size} 期...')
    
    # 合并去重并保存
    all_data = {**existing, **{r['period']: r for r in records}}
    all_list = sorted(all_data.values(), key=lambda x: x['period'])
    
    with open(data_path, 'w', encoding='utf-8') as f:
        json.dump(all_list, f, ensure_ascii=False, indent=2)
    
    print(f'\n{lt} 完成: 原有{len(existing)}期 + 新增{len(records)}期 = 共{len(all_list)}期')
    print(f'  范围: {min(r["period"] for r in all_list)} - {max(r["period"] for r in all_list)}')
    return all_list

if __name__ == '__main__':
    print('=== 抓取双色球(SSQ) ===')
    ssq = asyncio.run(fetch_lottery('ssq', max_pages=50))
    print(f'\n=== 抓取大乐透(DLT) ===')
    dlt = asyncio.run(fetch_lottery('dlt', max_pages=50))
    print(f'\n=== 全部完成 ===')
    print(f'SSQ: {len(ssq)}期  DLT: {len(dlt)}期')
