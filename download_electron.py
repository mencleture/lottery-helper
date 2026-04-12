import urllib.request
import os

ELECTRON_VERSION = "28.3.3"
# Try different mirrors
MIRRORS = [
    "https://npmmirror.com/mirrors/electron/",
    "https://cdn.npmmirror.com/binaries/electron/",
]

FILENAME = f"electron-v{ELECTRON_VERSION}-win32-x64.zip"

for mirror in MIRRORS:
    URL = f"{mirror}{FILENAME}"
    OUTPUT_PATH = f"node_modules/electron/dist/{FILENAME}"
    
    print(f"Trying: {URL}")
    
    try:
        os.makedirs("node_modules/electron/dist", exist_ok=True)
        
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, hdrs, newurl):
                return None
        
        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(URL, method='HEAD')
        
        try:
            response = opener.open(req, timeout=10)
            print(f"  Found! Content-Length: {response.headers.get('Content-Length', 'unknown')}")
        except urllib.error.HTTPError as e:
            print(f"  Not found: {e.code}")
            continue
        except Exception as e:
            print(f"  Error: {e}")
            continue
        
        print(f"Downloading to: {OUTPUT_PATH}")
        urllib.request.urlretrieve(URL, OUTPUT_PATH)
        print(f"Downloaded successfully!")
        break
        
    except Exception as e:
        print(f"  Failed: {e}")
        continue
