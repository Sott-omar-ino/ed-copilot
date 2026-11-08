"""Overlay: piccola finestra semitrasparente, sempre in primo piano, da tenere sopra il gioco.

Funziona con Elite Dangerous in modalità "Finestra senza bordi" o "In finestra" (lo schermo intero esclusivo
copre qualsiasi finestra). Quando è bloccato i clic lo attraversano e finiscono al gioco.
WebView2 non supporta la trasparenza per singolo pixel in una finestra Windows: usiamo l'opacità dell'intera finestra.
"""

import ctypes
import threading

from .lang import pick

TITLE = "Voidwatch ED Overlay"   # come il <title> di web/overlay.html
DEFAULTS = {"overlay_enabled": False, "overlay_locked": False, "overlay_x": 40, "overlay_y": 120,
            "overlay_w": 330, "overlay_h": 230, "overlay_opacity": 80}

_state = {"webview": None, "window": None, "base_url": None}
_lock = threading.Lock()


def _cfg():
    from .server import app_config
    return {**DEFAULTS, **{k: v for k, v in app_config().items() if k in DEFAULTS}}


def _save(**changes):
    from .server import set_app_config
    set_app_config(**changes)


def setup(webview_module, base_url):
    """Chiamata da main.py quando la finestra principale è pronta."""
    _state.update(webview=webview_module, base_url=base_url)
    if _cfg()["overlay_enabled"]:
        show()


def available():
    return _state["webview"] is not None


def status():
    cfg = _cfg()
    return {"available": available(), "enabled": _state["window"] is not None,
            "locked": cfg["overlay_locked"], "opacity": cfg["overlay_opacity"]}


def _on_ui(win, fn):
    """Esegue fn(form) nel thread della finestra (WinForms non accetta modifiche da altri thread)."""
    from System import Action
    form = win.native
    form.Invoke(Action(lambda: fn(form)))


def _apply(win, locked, opacity):
    """Opacità e "trasparenza ai clic" (WS_EX_TRANSPARENT); niente barra delle applicazioni e niente focus."""
    def fn(form):
        form.Opacity = max(0.3, min(1.0, opacity / 100))
        user32 = ctypes.windll.user32
        get, put = user32.GetWindowLongPtrW, user32.SetWindowLongPtrW
        get.restype = put.restype = ctypes.c_ssize_t
        get.argtypes = [ctypes.c_void_p, ctypes.c_int]
        put.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
        hwnd = ctypes.c_void_p(form.Handle.ToInt64())
        style = get(hwnd, -20) | 0x80 | 0x08000000 | 0x80000  # TOOLWINDOW | NOACTIVATE | LAYERED
        put(hwnd, -20, style | 0x20 if locked else style & ~0x20)  # WS_EX_TRANSPARENT
    try:
        _on_ui(win, fn)
        win.evaluate_js(f"document.body.classList.toggle('unlocked', {'false' if locked else 'true'})")
    except Exception as exc:
        print(f"[Overlay] {exc!r}")


def show():
    with _lock:
        webview = _state["webview"]
        if not webview or _state["window"]:
            return status()
        cfg = _cfg()
        locked = cfg["overlay_locked"]
        win = webview.create_window(
            TITLE, f"{_state['base_url']}overlay.html?locked={int(locked)}",
            width=cfg["overlay_w"], height=cfg["overlay_h"], x=cfg["overlay_x"], y=cfg["overlay_y"],
            frameless=True, easy_drag=True, on_top=True, focus=False, shadow=False,
            resizable=True, min_size=(220, 100), background_color="#0c0500")
        _state["window"] = win
        # I gestori degli eventi di pywebview non devono restituire valori.
        def moved(x, y):
            _save(overlay_x=x, overlay_y=y)

        def resized(w, h):
            _save(overlay_w=w, overlay_h=h)

        win.events.moved += moved
        win.events.resized += resized
        win.events.closed += lambda: _state.update(window=None)
        win.events.loaded += lambda: _apply(win, _cfg()["overlay_locked"], _cfg()["overlay_opacity"])
    _save(overlay_enabled=True)
    return status()


def hide(remember=True):
    with _lock:
        win = _state["window"]
        _state["window"] = None
    if win:
        try:
            win.destroy()
        except Exception:
            pass
    if remember:
        _save(overlay_enabled=False)
    return status()


def configure(body):
    """POST /api/overlay: {"enabled": bool, "locked": bool, "opacity": 30-100}"""
    body = body or {}
    if "locked" in body:
        _save(overlay_locked=bool(body["locked"]))
    if "opacity" in body:
        try:
            _save(overlay_opacity=max(30, min(100, int(body["opacity"]))))
        except (TypeError, ValueError):
            raise ValueError(pick("Opacità non valida", "Invalid opacity"))
    if "enabled" in body:
        show() if body["enabled"] else hide()
    win = _state["window"]
    if win and ("locked" in body or "opacity" in body):
        _apply(win, _cfg()["overlay_locked"], _cfg()["overlay_opacity"])
    return status()
