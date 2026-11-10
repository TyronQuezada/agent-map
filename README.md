# Agent Map

**Todas tus sesiones de Claude Code en una sola ventana, con terminales reales y estilo Windows XP.**

Agent Map es una app de escritorio para Windows. Lee las conversaciones que Claude Code guarda en tu equipo, las ordena por proyecto y te deja retomar cualquiera con un click, en una terminal real dentro de la misma ventana. También muestra qué dijiste, qué respondió Claude, qué agentes usó y cuánto te queda del plan.

![Agent Map con una sesión seleccionada](docs/screenshots/session.png)

**[⬇ Descargar el instalador para Windows (versión 0.8.0)](https://github.com/TyronQuezada/agent-map/releases/latest)** · [Manual completo](MANUAL.md)

---

## Novedades de la versión 0.8.0

- **👥 Equipo de agentes:** un jefe y 2 agentes con nombre, cargo e instrucciones propias, con **8 plantillas** (videojuego, web, ingeniería inversa, migración de código, investigación y redacción, análisis de datos, revisión de seguridad y en blanco).
- **🏢 Oficina pixel art estilo 16 bits** que muestra en vivo quién trabaja y quién duerme. Al pasar el mouse sobre alguien ves su pensamiento y cuánto lleva. Se puede separar a otra ventana o monitor y poner en pantalla completa.
- **🌙 Sin tokens, se apaga la luz:** cuenta regresiva hasta que se renueve tu plan, y abajo siempre ves el % usado de la sesión de 5 horas y cuándo se reinicia.
- **🗨 Conversación estilo MSN** con **avisos de mensajes nuevos como Messenger**: globito rojo con el número, y las respuestas nuevas parpadean 3 veces.
- **🎨 Temas** Windows XP, Matrix y Noche; **click derecho** en una sesión para cambiarle el nombre, el color o fijarla; **paneles redimensionables**; **copiar y pegar** en la terminal; abre en **pantalla completa** (F11).
- **📖 Guía "Cómo funciona"** en diapositivas estilo videojuego, en ⚙ Opciones.

---

## Características

### 🗂 Todas tus sesiones, ordenadas
- Árbol **proyecto → sesión → subagentes**, con las sesiones más recientes arriba.
- Sección **Activas ahora** con las sesiones que tienen Claude corriendo en este momento.
- **Puntos de estado** en cada sesión y en la carpeta del proyecto:
  🟠 abierta en Agent Map · 🟢 trabajando · 🔵 en espera · ⚪ cerrada.
- **Buscador** por título, prompt, proyecto, rama o agente, y filtros **Todas / Activas / Hoy / Esta semana**.
- **Click derecho en una sesión:** cambiarle el nombre, marcarla con uno de 8 colores, **fijarla arriba** o copiar su ID. Tus archivos de Claude no se tocan.

![Menú de click derecho con nombre, colores y fijar](docs/screenshots/context-menu.png)

### 💻 Terminales reales dentro de la app
- Click en una sesión y se abre con `claude --resume`, en una terminal de verdad (ConPTY + xterm.js).
- Las terminales siguen vivas aunque cambies de sesión. Las encuentras en la **barra de tareas** de abajo, como en Windows.
- **Copiar y pegar** como en Windows Terminal: Ctrl+V pega, Ctrl+C copia la selección y el click derecho copia o pega. Si el portapapeles tiene una imagen, Claude la recibe.
- **Iniciar Claude en cualquier carpeta**, con un explorador que también crea carpetas nuevas para empezar un proyecto desde cero.
- Al cerrar una terminal se detiene Claude **y todo lo que lanzó** (servidores MCP, comandos). La conversación queda guardada.

![Terminal de Claude Code dentro de Agent Map](docs/screenshots/terminal.png)

### 🗨 La conversación, lista para leer
- El panel derecho muestra **tus prompts y las respuestas de Claude** de la sesión elegida como un **chat estilo MSN**: globos con punta, tú a la derecha y Claude a la izquierda.
- **Avisos de mensajes nuevos como Messenger:** un globito rojo con el número en la sesión, en su proyecto y junto a la conversación. Las respuestas nuevas parpadean 3 veces en celeste y quedan marcadas hasta que las abres.
- **Click en cualquier mensaje** y se abre completo en un popup.
- Primer y último prompt resumidos, para saber de qué iba la sesión de un vistazo.
- Se ocultan los recordatorios internos que agrega Claude Code, las llamadas a herramientas y el razonamiento interno.
- **Secciones plegables** (▲/▼): deja abierto solo lo que te interesa; Agent Map lo recuerda.

![Conversación estilo MSN con avisos de mensajes nuevos](docs/screenshots/chat.png)

### 📊 Uso del plan y estadísticas
- **Plan de Claude** (Pro, Max…), **% usado en la sesión de 5 horas y en la semana**, cuánto queda y cuándo se reinicia. La barra se pone naranja desde 70 % y roja desde 90 %.
- Agentes, herramientas, tokens y modelos usados, por sesión o en total.
- Cada agente tiene un link a su repositorio (plugins) o a la documentación oficial (agentes integrados).

![Ventana de uso con el plan y las estadísticas](docs/screenshots/usage.png)

### 🪟 App de escritorio de verdad
- Se instala, se ancla a la barra de tareas y abre sin navegador ni comandos.
- **Abre en pantalla completa** (F11 la activa o desactiva).
- Botones de minimizar, maximizar y cerrar propios del estilo XP.
- **Paneles redimensionables:** arrastra la línea entre dos paneles; la terminal se reacomoda en vivo.
- **Al cerrar pregunta si estás seguro** y avisa cuántas terminales se van a detener.
- Instancia única: si la abres dos veces, enfoca la ventana que ya está abierta.

![Confirmación al cerrar Agent Map](docs/screenshots/close.png)

### 👥 Equipo de agentes con oficina pixel art
- Al crear un proyecto, **👥 Iniciar con equipo**: un **jefe** y **2 agentes** con el nombre, cargo e instrucciones que tú quieras (hay plantillas de videojuego y web, o en blanco).
- Tú le hablas al jefe; él reparte el trabajo y los dos agentes pueden trabajar **al mismo tiempo**.
- A la izquierda, las fichas del equipo: click en una y ves **lo que está haciendo en vivo** (solo lectura, sin interrumpir).
- A la derecha, una **oficina pixel art estilo 16 bits** que refleja el estado real: duermen con zzz cuando no hay trabajo, despiertan y teclean cuando el jefe les encarga algo, y de vez en cuando van a la impresora o por un café.
- **Pasa el mouse sobre alguien** y ves su pensamiento: "💭 Codeando player.gd ⏱ 2:15", "💭 Dibujando un sprite", "💭 Supervisando a Programador y Artista".
- La oficina se puede **separar en su propia ventana** (para otro monitor), ponerse en **pantalla completa** y volver a **anclarse** al panel.
- **Sin tokens, se apaga la luz:** si tu plan llega al límite, la oficina queda de noche, el equipo duerme y ves la cuenta regresiva hasta que se renueven. Abajo, en la barra de tareas, siempre ves cuánto llevas de la sesión de 5 horas, cuánto queda y cuándo se reinicia.
- **8 plantillas de equipo:** videojuego, web, ingeniería inversa, migración de código, investigación y redacción, análisis de datos, revisión de seguridad o en blanco.
- Usa subagentes normales de Claude Code (`.claude/agents/`), `CLAUDE.md` y una pizarra `TAREAS.md`: nada raro ni propietario.

![Equipo trabajando: fichas, terminal del jefe y oficina](docs/screenshots/team.png)

![La oficina separada en su propia ventana, con los pensamientos de cada uno](docs/screenshots/office-window.png)

### 🎨 Temas
En **⚙ Opciones** eliges el tema, el tamaño de letra de la terminal y si abre en pantalla completa. Ahí también está **📖 Cómo funciona**, una guía en diapositivas estilo videojuego.
- **Windows XP:** el azul Luna de siempre.
- **Matrix:** letras verdes sobre negro, también en la terminal.
- **Noche:** oscuro azulado, suave para la vista.

Los tres mantienen los 3 paneles, la barra de tareas y las terminales.

![Tema Matrix](docs/screenshots/matrix.png)

![Guía "Cómo funciona" en diapositivas estilo videojuego](docs/screenshots/about.png)

> Las capturas usan datos de ejemplo, no sesiones reales.

---

## Instalación

1. Descarga **`Agent-Map-Setup-x.y.z.exe`** desde [Releases](https://github.com/TyronQuezada/agent-map/releases/latest).
2. Ejecútalo. Se instala para tu usuario, sin permisos de administrador, y puedes elegir la carpeta.
3. Crea accesos directos en el escritorio y en el menú Inicio. Para anclarla: con la app abierta, click derecho en su icono de la barra de tareas → **Anclar a la barra de tareas**.

> Windows puede mostrar **"Windows protegió su PC"** porque el instalador no está firmado con un certificado de pago. Pulsa **Más información → Ejecutar de todas formas**.

### Requisitos

- Windows 10 u 11 (x64).
- [Claude Code](https://code.claude.com) instalado y disponible como `claude` en el PATH.
- Node.js en el PATH, solo para ver el % de uso del plan (ver abajo).

### Ver el % de uso del plan

Claude Code entrega el uso del plan únicamente a tu comando de *statusline*. Agent Map copia un pequeño intermediario a `~/.agent-map/statusline-tap.mjs`. Para activarlo, antepón ese intermediario a tu statusline en `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node \"C:\\Users\\<tú>\\.agent-map\\statusline-tap.mjs\" <tu statusline de siempre>"
}
```

El intermediario guarda solo los límites de uso en `~/.agent-map/usage.json` y luego ejecuta tu statusline con la misma entrada, así que tu barra se ve igual. Detalles en el [manual](MANUAL.md#6--uso).

---

## Privacidad y seguridad

- **Todo es local.** Agent Map no envía nada a internet.
- Lee `~/.claude/projects/**/*.jsonl` y `~/.claude/sessions/*.json` **solo en modo lectura**. Nunca lee tus credenciales.
- El servidor interno escucha solo en `127.0.0.1`, en un puerto al azar, y rechaza peticiones con `Host` u `Origin` ajenos (protección contra DNS rebinding y otras webs).
- La interfaz corre con `contextIsolation` y `sandbox`: no tiene acceso a Node, solo a los botones de la ventana.
- Los links externos se abren en tu navegador, nunca dentro de la app.
- Lo único que escribe va a `~/.agent-map/` (uso del plan, preferencias y nombres/colores de sesiones, intermediario de statusline y un log de arranque y cierre).

---

## Desarrollo

```
npm install
npm start          # app de escritorio en modo desarrollo
npm run web        # modo navegador en http://localhost:4317
npm test           # pruebas (node --test)
npm run dist       # icono + instalador en dist/
```

Sin frameworks en la interfaz: HTML, CSS y JavaScript con `innerHTML` y delegación de eventos.

| Archivo | Qué hace |
|---|---|
| `electron/main.js` | ventana sin marco, botones, confirmación de cierre, instancia única, log |
| `electron/preload.cjs` | puente mínimo entre la página y la ventana |
| `server.js` | API local, terminales (`node-pty`) y archivos de la interfaz |
| `lib/scan.js` | lectura de sesiones, conversación, plan y repos de plugins |
| `lib/folders.js` | explorador y creación de carpetas |
| `lib/prefs.js` | preferencias (tema, letra, pantalla completa) y nombres/colores de sesiones |
| `lib/team.js` | equipo de agentes: crea sus archivos y lee su estado en vivo |
| `public/office.js` | oficina pixel art del equipo (canvas, sin imágenes), globos de pensamiento |
| `public/office.html`, `office-page.js` | la oficina en ventana aparte |
| `statusline-tap.js` | intermediario de la statusline (uso del plan) |
| `public/` | interfaz |
| `scripts/make-icon.js` | genera el icono (PNG e ICO) sin dependencias |

Hecho con [Electron](https://www.electronjs.org/), [node-pty](https://github.com/microsoft/node-pty), [xterm.js](https://xtermjs.org/) y [ws](https://github.com/websockets/ws).
