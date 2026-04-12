import urllib.request
import json

# Check available Electron versions
MIRRORS = [
    "https://npmmirror.com/mirrors/electron/",
    "https://cdn.npmmirror.com/binaries/electron/",
]

for mirror in MIRRORS:
    print(f"\nChecking: {mirror}")
    try:
        url = f"{mirror}index.json"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, timeout=10)
        data = json.loads(response.read().decode())
        
        # Get latest stable versions
        versions = []
        for item in data[:20]:  # Show top 20
            if item.get('version', '').startswith('v28') or item.get('version', '').startswith('v27'):
                versions.append(item['version'])
        
        print(f"Available v28/v27 versions: {versions[:10]}")
    except Exception as e:
        print(f"Error: {e}")
