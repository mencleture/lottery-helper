"""用 Playwright 抓取 500彩票网历史数据（等待 JS 渲染完成）"""
import asyncio
import json
import os
import re
from pathlib import Path

# 动态导入 playwright（需要先 pip install playwright）
try:
    from playwright.async_api import async_playwright
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'playwright'])
    subprocess.check_call([sys.executable, '-m', 'playwright', 'install', 'chromium'])
    from playwright.async_api import async_playwright

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}


async def fetch_ssq(pages=15):
    url = 'https://datachart.500.com/ssq/history/newinc/history.php'
    records = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(extra_http_headers=HEADERS)
        
        for page_num in range(1, pages + 1):
            start = page_num * 100
            end = start + 99
            page_url = f'{url}?start={start}&end={end}'
            print(f'SSQ 第{page_num}页: {page_url}')
            
            page = await context.new_page()
            try:
                await page.goto(page_url, wait_until='networkidle', timeout=15000)
                
                # 等待 tbody 出现数据
                try:
                    await page.wait_for_selector('#tdata tr', timeout=8000)
                except:
                    print(f'  超时，跳过')
                    await page.close()
                    break
                
                # 提取数据
                rows = await page.query_selector_all('#tdata tr')
                print(f'  找到 {len(rows)} 行')
                
                for row in rows:
                    cells = await row.query_selector_all('td')
                    if len(cells) < 8:
                        continue
                    
                    period_text = await cells[0].inner_text()
                    period = re.sub(r'\D', '', period_text.strip())
                    if not period or len(period) < 5:
                        continue
                    
                    reds = []
                    for i in range(1, 7):
                        text = (await cells[i].inner_text()).strip()
                        n = int(text) if text.isdigit() else 0
                        if 1 <= n <= 33:
                            reds.append(n)
                    
                    blue_text = (await cells[7].inner_text()).strip()
                    blue = int(blue_text) if blue_text.isdigit() else 0
                    
                    if len(reds) == 6 and 1 <= blue <= 16:
                        records.append({'period': int(period), 'red': sorted(reds), 'blue': blue})
                
                await page.close()
                await asyncio.sleep(0.5)
                
            except Exception as e:
                print(f'  错误: {e}')
                await page.close()
                break
        
        await browser.close()
    
    # 去重
    seen = set()
    unique = []
    for r in sorted(records, key=lambda x: x['period'], reverse=True):
        if r['period'] not in seen:
            seen.add(r['period'])
            unique.append(r)
    
    print(f'SSQ 共 {len(unique)} 条')
    return unique


async def fetch_dlt(pages=15):
    url = 'https://datachart.500.com/dlt/history/newinc/history.php'
    records = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(extra_http_headers=HEADERS)
        
        for page_num in range(1, pages + 1):
            start = page_num * 100
            end = start + 99
            page_url = f'{url}?start={start}&end={end}'
            print(f'DLT 第{page_num}页: {page_url}')
            
            page = await context.new_page()
            try:
                await page.goto(page_url, wait_until='networkidle', timeout=15000)
                
                try:
                    await page.wait_for_selector('#tdata tr', timeout=8000)
                except:
                    print(f'  超时，跳过')
                    await page.close()
                    break
                
                rows = await page.query_selector_all('#tdata tr')
                print(f'  找到 {len(rows)} 行')
                
                for row in rows:
                    cells = await row.query_selector_all('td')
                    if len(cells) < 9:
                        continue
                    
                    period_text = await cells[0].inner_text()
                    period = re.sub(r'\D', '', period_text.strip())
                    if not period or len(period) < 5:
                        continue
                    
                    front = []
                    for i in range(1, 6):
                        text = (await cells[i].inner_text()).strip()
                        n = int(text) if text.isdigit() else 0
                        if 1 <= n <= 35:
                            front.append(n)
                    
                    back = []
                    for i in range(6, 8):
                        text = (await cells[i].inner_text()).strip()
                        n = int(text) if text.isdigit() else 0
                        if 1 <= n <= 12:
                            back.append(n)
                    
                    if len(front) == 5 and len(back) == 2:
                        records.append({'period': int(period), 'front': sorted(front), 'back': sorted(back)})
                
                await page.close()
                await asyncio.sleep(0.5)
                
            except Exception as e:
                print(f'  错误: {e}')
                await page.close()
                break
        
        await browser.close()
    
    seen = set()
    unique = []
    for r in sorted(records, key=lambda x: x['period'], reverse=True):
        if r['period'] not in seen:
            seen.add(r['period'])
            unique.append(r)
    
    print(f'DLT 共 {len(unique)} 条')
    return unique


async def main():
    print('=' * 50)
    print('Playwright 彩票数据抓取器')
    print('=' * 50)
    
    print('\n>>> 抓取双色球...')
    ssq = await fetch_ssq(pages=10)
    with open(DATA_DIR / 'ssq_history.json', 'w', encoding='utf-8') as f:
        json.dump(ssq, f, ensure_ascii=False, indent=2)
    print(f'保存: {DATA_DIR / "ssq_history.json"}')
    
    print('\n>>> 抓取大乐透...')
    dlt = await fetch_dlt(pages=10)
    with open(DATA_DIR / 'dlt_history.json', 'w', encoding='utf-8') as f:
        json.dump(dlt, f, ensure_ascii=False, indent=2)
    print(f'保存: {DATA_DIR / "dlt_history.json"}')
    
    print('\n✅ 全部完成!')
    if ssq:
        print(f'最新双色球: 第{ssq[0]["period"]}期, 红球={ssq[0]["red"]}, 蓝球={ssq[0]["blue"]}')
    if dlt:
        print(f'最新大乐透: 第{dlt[0]["period"]}期, 前区={dlt[0]["front"]}, 后区={dlt[0]["back"]}')


if __name__ == '__main__':
    asyncio.run(main())
