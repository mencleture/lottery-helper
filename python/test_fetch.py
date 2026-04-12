import requests, re
resp = requests.get('https://datachart.500.com/ssq/history/newinc/history.php?start=1&end=50', timeout=15, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
})
print('Status:', resp.status_code, 'Length:', len(resp.text))
# 写到文件再读
with open('page_test.html', 'wb') as f:
    f.write(resp.content)
print('written to page_test.html')
print('Encoding used:', resp.encoding)
print('First 500 bytes (repr):', repr(resp.text[:500]))
