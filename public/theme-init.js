// Pinta el último tema elegido antes del primer cuadro (evita un destello del tema XP). Va en <head>, sin defer:
// es un archivo aparte (y no un <script> en línea) para que la CSP no necesite 'unsafe-inline' en script-src.
try { document.documentElement.dataset.theme = JSON.parse(localStorage.getItem('agentmap.theme')) || 'xp'; } catch { }
