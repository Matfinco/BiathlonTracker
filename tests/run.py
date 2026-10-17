#!/usr/bin/env python3
"""Run JavaScript regressions using the system JavaScriptCore library; no npm needed."""
import ctypes
import ctypes.util
import json
from pathlib import Path
import re
import sys
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
lib = ctypes.CDLL(ctypes.util.find_library('javascriptcoregtk-4.1'))
ptr = ctypes.c_void_p
lib.JSGlobalContextCreate.argtypes = [ptr]
lib.JSGlobalContextCreate.restype = ptr
lib.JSStringCreateWithUTF8CString.argtypes = [ctypes.c_char_p]
lib.JSStringCreateWithUTF8CString.restype = ptr
lib.JSEvaluateScript.argtypes = [ptr, ptr, ptr, ptr, ctypes.c_int, ctypes.POINTER(ptr)]
lib.JSEvaluateScript.restype = ptr
lib.JSValueToStringCopy.argtypes = [ptr, ptr, ctypes.POINTER(ptr)]
lib.JSValueToStringCopy.restype = ptr
lib.JSStringGetMaximumUTF8CStringSize.argtypes = [ptr]
lib.JSStringGetMaximumUTF8CStringSize.restype = ctypes.c_size_t
lib.JSStringGetUTF8CString.argtypes = [ptr, ctypes.c_char_p, ctypes.c_size_t]
lib.JSStringGetUTF8CString.restype = ctypes.c_size_t
lib.JSStringRelease.argtypes = [ptr]
lib.JSGlobalContextRelease.argtypes = [ptr]
ctx = lib.JSGlobalContextCreate(None)

def evaluate(source):
    script = lib.JSStringCreateWithUTF8CString(source.encode())
    error = ptr()
    result = lib.JSEvaluateScript(ctx, script, None, None, 1, ctypes.byref(error))
    lib.JSStringRelease(script)
    value = error.value or result
    string = lib.JSValueToStringCopy(ctx, value, None)
    size = lib.JSStringGetMaximumUTF8CStringSize(string)
    buffer = ctypes.create_string_buffer(size)
    lib.JSStringGetUTF8CString(string, buffer, size)
    lib.JSStringRelease(string)
    output = buffer.value.decode()
    if error.value:
        raise RuntimeError(output)
    return output

try:
    # Compile every executable JS file, including the service worker and Apps Script.
    sources = list((ROOT / 'src').glob('*.js')) + [ROOT / 'sw.js', ROOT / 'backend/Code.gs']
    for source in sources:
        evaluate('new Function(' + json.dumps(source.read_text()) + '); "compiled"')
    evaluate((ROOT / 'tests/platform.js').read_text())
    for name in ['src/domain.js', 'src/storage.js', 'src/sync.js', 'src/updates.js', 'backend/Code.gs', 'tests/regression.js']:
        evaluate((ROOT / name).read_text())
    # Entering/leaving JSC drains promise microtasks. All network and timers are simulated.
    for _ in range(1000):
        if evaluate('String(globalThis.testDone)') == 'true':
            break
    else:
        raise RuntimeError('Asynchronous tests did not finish')
    evaluate('globalThis.testDone=false')
    evaluate((ROOT / 'tests/storage-regression.js').read_text())
    for _ in range(1000):
        if evaluate('String(globalThis.testDone)') == 'true':
            break
    else:
        raise RuntimeError('Storage tests did not finish')
    evaluate('globalThis.testDone=false')
    evaluate((ROOT / 'tests/update-regression.js').read_text())
    for _ in range(1000):
        if evaluate('String(globalThis.testDone)') == 'true':
            break
    else:
        raise RuntimeError('Update tests did not finish')
    class TreeParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.tree = {'tag': 'document', 'attrs': {}, 'children': []}
            self.stack = [self.tree]
        def handle_starttag(self, tag, attrs):
            entry = {'tag': tag, 'attrs': {k: v or '' for k, v in attrs}, 'children': []}
            self.stack[-1]['children'].append(entry)
            if tag not in {'meta', 'link', 'input', 'img', 'hr', 'br', 'source', 'area', 'base', 'embed', 'param', 'track', 'wbr'}:
                self.stack.append(entry)
        def handle_endtag(self, tag):
            for i in range(len(self.stack) - 1, 0, -1):
                if self.stack[i]['tag'] == tag:
                    self.stack = self.stack[:i]
                    break
    parser = TreeParser()
    parser.feed((ROOT / 'index.html').read_text())
    evaluate('globalThis.__htmlTree=' + json.dumps(parser.tree))
    evaluate((ROOT / 'tests/ui-platform.js').read_text())
    evaluate((ROOT / 'src/app.js').read_text())
    evaluate('globalThis.testDone=false')
    evaluate((ROOT / 'tests/ui-regression.js').read_text())
    for _ in range(1000):
        if evaluate('String(globalThis.testDone)') == 'true':
            break
    else:
        raise RuntimeError('UI tests did not finish')
    evaluate('globalThis.__workerSource=' + json.dumps((ROOT / 'sw.js').read_text()))
    evaluate('globalThis.testDone=false')
    evaluate((ROOT / 'tests/worker-regression.js').read_text())
    for _ in range(1000):
        if evaluate('String(globalThis.testDone)') == 'true':
            break
    else:
        raise RuntimeError('Service worker tests did not finish')
    results = json.loads(evaluate('JSON.stringify(globalThis.testResults)'))
    for result in results:
        print(('PASS ' if result['ok'] else 'FAIL ') + result['name'] + (': ' + result.get('error', '') if not result['ok'] else ''))
    # Ensure UI references and locally cached assets resolve in a clean checkout.
    html = (ROOT / 'index.html').read_text()
    ids = re.findall(r'\bid="([^"]+)"', html)
    assert len(ids) == len(set(ids)), 'Duplicate HTML IDs'
    references = set(re.findall(r"\$\('([^']+)'\)", (ROOT / 'src/app.js').read_text()))
    assert references.issubset(ids), 'Missing UI elements: ' + str(references - set(ids))
    for name in re.findall(r"'([^']+\.(?:js|css|html|webmanifest|svg|png))'", (ROOT / 'sw.js').read_text()):
        assert (ROOT / name).is_file(), 'Missing offline asset: ' + name
    print('PASS UI references, unique IDs and offline assets')
    passed = sum(r['ok'] for r in results) + 1
    total = len(results) + 1
    print(f'{passed}/{total} checks passed; all {len(sources)} executable files compile')
    sys.exit(0 if passed == total else 1)
finally:
    lib.JSGlobalContextRelease(ctx)
