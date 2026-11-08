"""Tasti che dipendono dal layout della tastiera (lettere e simboli).

Elite Dangerous dà ai tasti il nome del carattere che producono nel layout scelto (nei file .binds con layout it-IT
compaiono per esempio "Key_à" e "Key_ì"), mentre i tasti funzione, il tastierino e i tasti di navigazione hanno lo
stesso nome in ogni layout. Per premere il tasto giusto si chiede quindi a Windows quale tasto fisico (scan code)
produce quel carattere nel layout della finestra del gioco: VkKeyScanExW + MapVirtualKeyExW
(https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-vkkeyscanexw).
Un carattere che richiede Maiusc, Ctrl o AltGr (es. il punto e virgola sulla tastiera italiana) non corrisponde a
nessun tasto singolo: il comando va considerato senza tasto.
"""

import ctypes
from ctypes import wintypes

# Token dell'app (keys.SCAN_CODES) che sono caratteri e quindi dipendono dal layout.
PUNCT = {"SEMICOLON": ";", "COMMA": ",", "PERIOD": ".", "MINUS": "-", "EQUALS": "=", "APOSTROPHE": "'",
         "SLASH": "/", "BACKSLASH": "\\", "LBRACKET": "[", "RBRACKET": "]", "GRAVE": "`"}
_user32 = ctypes.windll.user32
_user32.VkKeyScanExW.argtypes = [wintypes.WCHAR, wintypes.HKL]
_user32.VkKeyScanExW.restype = ctypes.c_short
_user32.MapVirtualKeyExW.argtypes = [wintypes.UINT, wintypes.UINT, wintypes.HKL]
_user32.MapVirtualKeyExW.restype = wintypes.UINT
_user32.GetKeyboardLayout.argtypes = [wintypes.DWORD]
_user32.GetKeyboardLayout.restype = wintypes.HKL


def char_of(token):
    """Carattere rappresentato da un token, o None se il tasto non dipende dal layout."""
    t = str(token).upper()
    if t in PUNCT:
        return PUNCT[t]
    if t.startswith("CHR_") and len(token) == 5:
        return token[4]
    if len(t) == 1 and t.isalpha():
        return t.lower()
    return None


def _layout(hwnd=None):
    """Layout della tastiera della finestra del gioco (se aperta), altrimenti quello attivo."""
    thread = 0
    if hwnd:
        thread = _user32.GetWindowThreadProcessId(hwnd, None)
    return _user32.GetKeyboardLayout(thread)


def scan_for(ch, hwnd=None):
    """Scan code (e se è esteso) del tasto che produce `ch` senza modificatori, o None se non esiste."""
    try:
        hkl = _layout(hwnd)
        res = _user32.VkKeyScanExW(ch, hkl)
        if res == -1:
            return None
        vk, shift = res & 0xFF, (res >> 8) & 0xFF
        if shift & 0x07:  # serve Maiusc, Ctrl o Alt (AltGr = Ctrl+Alt)
            return None
        scan = _user32.MapVirtualKeyExW(vk, 0, hkl)  # MAPVK_VK_TO_VSC
        return (scan, False) if scan else None
    except Exception:
        return None


def reachable(token, hwnd=None):
    """Vero se il token si può premere con un solo tasto nel layout attuale (i tasti non legati al layout sì)."""
    ch = char_of(token)
    return True if ch is None else scan_for(ch, hwnd) is not None
