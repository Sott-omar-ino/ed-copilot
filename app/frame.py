"""Finestra principale senza la barra del titolo di Windows (come in Bottega).

La barra in alto dell'app fa da barra del titolo: si trascina per spostare la finestra, doppio clic per ingrandirla e
ha i suoi tasti riduci / ingrandisci / chiudi (web/index.html, #win-ctl). Si toglie solo lo stile WS_CAPTION, così
restano i bordi per ridimensionare, l'aggancio ai lati dello schermo (Snap) e il nome nella barra delle applicazioni.
Il trascinamento lo fa WebView2 con il CSS "app-region: drag" (CoreWebView2Settings.IsNonClientRegionSupportEnabled,
https://learn.microsoft.com/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2settings).
Solo Windows con pywebview su WinForms/WebView2: in ogni altro caso resta la finestra normale.
"""

import ctypes

from . import paths, storage

GWL_STYLE = -16
WS_CAPTION = 0x00C00000
# SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED: ricalcola il bordo senza spostare la finestra
SWP_FRAMECHANGED = 0x0001 | 0x0002 | 0x0004 | 0x0020

SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE = 3, 6, 9
WPF_RESTORETOMAXIMIZED = 2

STATE = {"window": None, "hwnd": None, "normal": None}
# Posizione e grandezza della finestra alla chiusura (pixel dello schermo), come in Bottega: alla riapertura torna lì.
GEOMETRY_FILE = paths.cache_file("finestra.json")


def saved_maximized():
    """La finestra va aperta ingrandita? Sì la prima volta e se era ingrandita quando è stata chiusa."""
    return (storage.load_json(GEOMETRY_FILE) or {}).get("maximized", True)


def _restore_geometry(form):
    from System.Drawing import Rectangle
    from System.Windows.Forms import FormStartPosition, FormWindowState, Screen
    g = storage.load_json(GEOMETRY_FILE) or {}
    try:
        rect = Rectangle(int(g["x"]), int(g["y"]), int(g["width"]), int(g["height"]))
    except (KeyError, TypeError, ValueError):
        return
    # Un monitor scollegato non deve lasciare la finestra fuori dallo schermo.
    if rect.Width < 400 or rect.Height < 300 or not any(s.WorkingArea.IntersectsWith(rect) for s in Screen.AllScreens):
        return
    maximized = form.WindowState == FormWindowState.Maximized
    form.WindowState = FormWindowState.Normal
    form.StartPosition = FormStartPosition.Manual
    form.Bounds = rect
    if maximized:
        form.WindowState = FormWindowState.Maximized


class _RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class _WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [("length", ctypes.c_uint), ("flags", ctypes.c_uint), ("showCmd", ctypes.c_uint),
                ("ptMinPosition", ctypes.c_long * 2), ("ptMaxPosition", ctypes.c_long * 2), ("rcNormalPosition", _RECT)]


# Lo stato si legge e si cambia con Win32 e non con WinForms: tolta la barra, WinForms non sa più se la finestra è
# ingrandita (il suo WindowState restava "Normal" e ripristina/ingrandisci non facevano niente).
def _zoomed():
    return bool(ctypes.windll.user32.IsZoomed(ctypes.c_void_p(STATE["hwnd"])))


def _remember_normal():
    """Posizione e grandezza della finestra quando non è né ingrandita né ridotta (quella da salvare)."""
    user32, hwnd = ctypes.windll.user32, ctypes.c_void_p(STATE["hwnd"])
    if user32.IsZoomed(hwnd) or user32.IsIconic(hwnd):
        return
    r = _RECT()
    if user32.GetWindowRect(hwnd, ctypes.byref(r)):
        STATE["normal"] = {"x": r.left, "y": r.top, "width": r.right - r.left, "height": r.bottom - r.top}


def _save_geometry():
    try:
        user32, hwnd = ctypes.windll.user32, ctypes.c_void_p(STATE["hwnd"])
        _remember_normal()
        maximized = bool(user32.IsZoomed(hwnd))
        if user32.IsIconic(hwnd):  # chiusa da ridotta a icona: conta com'era prima
            wp = _WINDOWPLACEMENT(length=ctypes.sizeof(_WINDOWPLACEMENT))
            maximized = bool(user32.GetWindowPlacement(hwnd, ctypes.byref(wp)) and wp.flags & WPF_RESTORETOMAXIMIZED)
        storage.save_json(GEOMETRY_FILE, {**(STATE["normal"] or {}), "maximized": maximized})
    except Exception as exc:
        print(f"Posizione della finestra non salvata ({exc}).")


def setup(window):
    """Da collegare a window.events.before_show: la finestra esiste ma non è ancora visibile."""
    try:
        _restore_geometry(window.native)
    except Exception as exc:
        print(f"Posizione della finestra non ripristinata ({exc}).")
    try:
        form = window.native
        hwnd = form.Handle.ToInt64()

        def ready(sender, args):
            if args.IsSuccess:
                sender.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = True

        form.webview.CoreWebView2InitializationCompleted += ready
    except Exception as exc:
        print(f"Barra del titolo personalizzata non disponibile ({exc}).")
        return
    STATE.update(window=window, hwnd=hwnd)
    window.events.closing += _save_geometry
    window.events.moved += _remember_normal
    window.events.resized += _remember_normal
    # La barra si toglie a finestra già mostrata: prima, WinForms non la apriva più ingrandita.
    window.events.shown += _strip_caption
    window.events.loaded += _mark_page


def _strip_caption():
    hwnd = ctypes.c_void_p(STATE["hwnd"])
    user32 = ctypes.windll.user32
    _remember_normal()
    user32.GetWindowLongW.restype = ctypes.c_long
    style = user32.GetWindowLongW(hwnd, GWL_STYLE)
    user32.SetWindowLongW(hwnd, GWL_STYLE, ctypes.c_long(style & ~WS_CAPTION))
    user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED)
    # Se WinForms non ha ancora applicato l'apertura ingrandita (capita a volte) la si rifà qui.
    if STATE["window"].maximized and not user32.IsZoomed(hwnd):
        user32.ShowWindow(hwnd, SW_MAXIMIZE)


def _mark_page():
    # La pagina mostra i tasti della finestra e rende trascinabile la barra solo con questa classe.
    STATE["window"].evaluate_js("document.body.classList.add('frameless')")


def control(action):
    """Tasti della barra: "min", "max" (ingrandisci o ripristina), "close"."""
    window, hwnd = STATE["window"], ctypes.c_void_p(STATE["hwnd"])
    if not window:
        return {"status": "no-window"}
    if action == "min":
        ctypes.windll.user32.ShowWindow(hwnd, SW_MINIMIZE)
    elif action == "max":
        ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE if _zoomed() else SW_MAXIMIZE)
    elif action == "close":
        window.destroy()
    return {"status": "ok"}
