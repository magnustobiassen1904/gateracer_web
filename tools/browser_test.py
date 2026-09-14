"""
browser_test.py — styrer en ekte (headless) Chrome via DevTools-protokollen.
Brukes til å teste flyter som går over tid: søk, kartklikk, bygging i bakgrunnstråd, kjøring.
Headless Chrome med --virtual-time-budget venter ikke på Web Workers, derfor dette.

Bruk i Python:
    from browser_test import Browser
    b = Browser(); b.goto("http://127.0.0.1:8080/web/"); b.shot("/tmp/x.png"); b.close()
"""
import base64, json, subprocess, tempfile, time, urllib.request, websocket, shutil

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

class Browser:
    def __init__(self, w=1500, h=900, port=9333, mobile=False):
        self.dir = tempfile.mkdtemp(prefix="gr_chrome_")
        self.proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--remote-allow-origins=http://127.0.0.1:{port}", f"--user-data-dir={self.dir}",
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--hide-scrollbars", f"--window-size={w},{h}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                page = [t for t in tabs if t["type"] == "page"][0]; break
            except Exception: time.sleep(0.2)
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=120, suppress_origin=True)
        self.id = 0; self.logs = []
        self.cmd("Runtime.enable"); self.cmd("Page.enable")
        if mobile: self.cmd("Emulation.setTouchEmulationEnabled", enabled=True)

    def cmd(self, method, **params):
        self.id += 1; my = self.id
        self.ws.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("method") == "Runtime.consoleAPICalled":
                self.logs.append(" ".join(str(a.get("value", a.get("description", ""))) for a in m["params"]["args"]))
            if m.get("method") == "Runtime.exceptionThrown":
                self.logs.append("EXCEPTION " + json.dumps(m["params"]["exceptionDetails"].get("exception", {}).get("description", m["params"]["exceptionDetails"].get("text")))[:400])
            if m.get("id") == my: return m.get("result", m.get("error"))

    def pump(self, seconds):
        end = time.time() + seconds; self.ws.settimeout(0.3)
        while time.time() < end:
            try:
                m = json.loads(self.ws.recv())
                if m.get("method") == "Runtime.consoleAPICalled":
                    self.logs.append(" ".join(str(a.get("value", a.get("description", ""))) for a in m["params"]["args"]))
                if m.get("method") == "Runtime.exceptionThrown":
                    self.logs.append("EXCEPTION " + json.dumps(m["params"]["exceptionDetails"].get("exception", {}).get("description", m["params"]["exceptionDetails"].get("text")))[:400])
            except websocket.WebSocketTimeoutException: pass
        self.ws.settimeout(120)

    def js(self, expr):
        r = self.cmd("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("value") if isinstance(r, dict) else r

    def goto(self, url, wait=2): self.cmd("Page.navigate", url=url); self.pump(wait)

    def wait_for(self, expr, timeout=180, step=0.5):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if self.js(expr): return time.time() - t0
            self.pump(step)
        return None

    def click(self, x, y):
        for t in ("mousePressed", "mouseReleased"):
            self.cmd("Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)

    def shot(self, path):
        r = self.cmd("Page.captureScreenshot", format="png")
        open(path, "wb").write(base64.b64decode(r["data"]))

    def close(self):
        try: self.ws.close()
        except Exception: pass
        self.proc.terminate(); self.proc.wait(timeout=10); shutil.rmtree(self.dir, ignore_errors=True)
