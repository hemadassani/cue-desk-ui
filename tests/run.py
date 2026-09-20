#!/usr/bin/env python3
"""End-to-end check for signup.html, dashboard.html and the desk.

    python tests/run.py

Drives the real pages in headless Edge or Chrome with a synthetic camera, so the
getUserMedia -> canvas -> JPEG path is genuinely exercised rather than stubbed.
Exits 0 only if every assertion passes.

Why a browser and not a unit test runner: the interesting behaviour here is
camera capture, the step machine and what the page says when a send fails. None
of that is reachable without a DOM.

Note it cannot test apps-script/Code.gs. That runs on Google's servers and needs
a deployed web app; the network layer is stubbed at fetch() instead.
"""
from __future__ import annotations

import http.server
import os
import pathlib
import shutil
import subprocess
import sys
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8791
RESULT = ROOT / "tests" / ".result.txt"
CONFIG = ROOT / "config.js"
BACKUP = ROOT / "tests" / ".config.js.bak"

# The harness stubs fetch(), so this only has to be truthy and same-origin.
TEST_CONFIG = (
    "window.CUE_SIGNUP = { endpoint: '/fake-exec', eventId: 'test-event', "
    "maxEdge: 640, quality: 0.82, pollMs: 15000 };\n"
)

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]


def find_browser() -> str:
    for path in BROWSERS:
        if path and pathlib.Path(path).exists():
            return path
    sys.exit("No Chrome or Edge found. Install one, or add its path to BROWSERS.")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path.startswith("/result"):
            RESULT.write_bytes(body)
            self.send_response(200)
        else:
            self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


def main() -> int:
    browser = find_browser()
    RESULT.unlink(missing_ok=True)
    BACKUP.unlink(missing_ok=True)

    had_config = CONFIG.exists()
    if had_config:
        shutil.copy2(CONFIG, BACKUP)
    CONFIG.write_text(TEST_CONFIG, encoding="utf-8")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    profile = ROOT / "tests" / ".profile"
    proc = subprocess.Popen(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--user-data-dir=" + str(profile),
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            f"http://127.0.0.1:{PORT}/tests/" + (sys.argv[1] if len(sys.argv) > 1 else "e2e.html"),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 120
        while time.time() < deadline and not RESULT.exists():
            time.sleep(0.5)
    finally:
        proc.kill()
        server.shutdown()
        if had_config:
            shutil.move(BACKUP, CONFIG)
        else:
            CONFIG.unlink(missing_ok=True)
        shutil.rmtree(profile, ignore_errors=True)

    if not RESULT.exists():
        print("The harness never reported back. Nothing was verified.")
        return 1

    text = RESULT.read_text(encoding="utf-8", errors="replace")
    RESULT.unlink(missing_ok=True)
    print(text)
    failed = sum(1 for line in text.splitlines() if line.startswith("FAIL"))
    passed = sum(1 for line in text.splitlines() if line.startswith("PASS"))
    if failed or not passed:
        print(f"\n{failed} failed of {passed + failed}")
        return 1
    print(f"\n{passed} checks passed")
    return 0


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(main())
