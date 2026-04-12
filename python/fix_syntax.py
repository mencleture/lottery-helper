content = open(r'C:\Users\HP\.qclaw\workspace\lottery-app\python\built_in_data.py', encoding='utf-8').read()
# Pattern: ], },\s*"blueNumber or ], },\s*"backNumbers
# Fix: remove the spurious },
import re
fixed = re.sub(r'],\s*},', '],', content)
fixed = re.sub(r'(\]),\s*\}\s*,\s*"', r'\1, "', fixed)
count = content.count('},') - fixed.count('},')
print(f'Fixed {count} occurrences')
open(r'C:\Users\HP\.qclaw\workspace\lottery-app\python\built_in_data.py', 'w', encoding='utf-8').write(fixed)
