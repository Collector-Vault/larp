"""Parse bounded, already-fetched HTML. No fetchers, browsers or adaptive storage."""
import json
import sys
from importlib.metadata import version

if version("scrapling") != "0.5":
    raise RuntimeError("This adapter requires Scrapling 0.5")
from scrapling.parser import Selector

header = sys.stdin.buffer.readline(4097)
if len(header) > 4096 or not header.endswith(b"\n"):
    raise ValueError("Invalid input header")
metadata = json.loads(header)
source = metadata["source"]
if not isinstance(source, str) or len(source) > 2048:
    raise ValueError("Invalid source")
body = sys.stdin.buffer.read(131073)
if len(body) > 131072:
    raise ValueError("HTML exceeds limit")
page = Selector(body, url=source, huge_tree=False, adaptive=False)
selectors = {"title": "title::text", "description": 'meta[name="description"]::attr(content)'}
result = {"source": source, "selectors": selectors}
for field, selector in selectors.items():
    result[field] = str(page.css(selector, adaptive=False, auto_save=False).get("")).strip()[:500 if field == "description" else 200]
encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
if len(encoded) > 8192:
    raise ValueError("Output exceeds limit")
sys.stdout.buffer.write(encoded)
