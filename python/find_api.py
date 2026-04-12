import subprocess, time, sys

# 写一个临时HTML文件来探测500.com的API
html = """<!DOCTYPE html>
<html>
<head><title>API Test</title></head>
<body>
<script>
async function findApi() {
  // 劫持fetch来捕获所有请求
  const orig = window.fetch;
  window.fetch = async (...args) => {
    const url = args[0].url || args[0];
    if (url.includes('500.com') || url.includes('chart')) {
      console.log('FETCH:', url);
    }
    return orig.apply(window, args);
  };
  
  // 加载双色球页面
  const resp = await fetch('https://datachart.500.com/ssq/history/newinc/history.php?start=25001&end=26100');
  const html = await resp.text();
  console.log('PAGE_LEN:', html.length);
  
  // 找script标签中的API调用
  const scripts = html.match(/<script[^>]*>(.*?)<\/script>/gis) || [];
  for (const s of scripts) {
    if (s.includes('getChartdata') || s.includes('tdata') || s.includes('chart')) {
      console.log('SCRIPT:', s.substring(0, 500));
    }
  }
}
findApi();
</script>
</body>
</html>"""

with open('api_test.html', 'w') as f:
    f.write(html)
print('Written api_test.html')
