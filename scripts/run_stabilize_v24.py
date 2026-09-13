#!/usr/bin/env python3
"""Temporarily repair and run the one-shot v24 migration.

The normal CI workflow is removed from the runner workspace after generation
because GitHub's Actions token cannot create workflow files. ChatGPT adds that
file separately through the authorized GitHub connection after migration.
"""
from pathlib import Path
import subprocess

p = Path(__file__).with_name('stabilize_v24.py')
root = p.parent.parent
original = p.read_text(encoding='utf-8')
old = "html = replace_once(html, 'for (let i = 0; i < 4; i++)', 'for (let i = 0; i < 6; i++)', \"six character room codes\")"
new = '''html = replace_once(
    html,
    "function netGenCode() {\\n  let c = '';\\n  for (let i = 0; i < 4; i++)",
    "function netGenCode() {\\n  let c = '';\\n  for (let i = 0; i < 6; i++)",
    "six character room codes",
)'''
if original.count(old) != 1:
    raise RuntimeError(f'expected one broad room-code migration statement, found {original.count(old)}')
patched = original.replace(old, new, 1)
p.write_text(patched, encoding='utf-8')
try:
    subprocess.run(['python3', str(p)], check=True)
    generated_ci = root / '.github' / 'workflows' / 'ci.yml'
    if generated_ci.exists():
        generated_ci.unlink()
finally:
    p.write_text(original, encoding='utf-8')
