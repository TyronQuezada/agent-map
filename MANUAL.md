# Agent Map — Manual

Agent Map es una aplicación de escritorio para Windows (estilo Windows XP) que reúne todas tus sesiones de Claude Code en un solo lugar: las ves, las buscas, las retomas con un click y trabajas en terminales reales dentro de la misma ventana.

---

## 1. Instalación

1. Descarga `Agent Map Setup x.y.z.exe` desde [Releases](https://github.com/TyronQuezada/agent-map/releases/latest) (o genéralo con `npm run dist`, queda en `dist\`) y ejecútalo.
2. Elige la carpeta de instalación. Por defecto es `C:\Users\<tú>\AppData\Local\Programs\Agent Map` y no necesita permisos de administrador.
3. El instalador crea accesos directos en el **Escritorio** y en el **menú Inicio**, y abre la app al terminar.

> Windows puede mostrar "Windows protegió su PC" porque el instalador no está firmado con un certificado. Pulsa **Más información → Ejecutar de todas formas**.

### Anclar a la barra de tareas

- Con la app abierta: click derecho en su icono de la barra de tareas → **Anclar a la barra de tareas**.
- O desde el menú Inicio: click derecho en **Agent Map** → **Anclar a la barra de tareas**.

### Requisitos

- Windows 10 u 11 (x64).
- Claude Code instalado y disponible como `claude` en el PATH.
- Node.js en el PATH (solo para el registro de uso del plan, ver sección 6).

### Desinstalar

**Configuración → Aplicaciones → Agent Map → Desinstalar.** Tus sesiones de Claude no se tocan. Si quieres borrar todo rastro:

- Borra la carpeta `C:\Users\<tú>\.agent-map`.
- Quita el prefijo `node "C:\Users\<tú>\.agent-map\statusline-tap.mjs" ` de la línea `statusLine` en `~/.claude/settings.json` (ver sección 6).

---

## 2. La ventana

```
┌ Agent Map ─────────────────────────────────────────── _ □ × ┐
│ [Buscar…]  [Todas|Activas|Hoy|Esta semana] [📊 Uso]  [⟳ Actualizar] │
├──────────────┬──────────────────────────────┬──────────────┤
│ Sesiones     │  Inicio / Terminal           │ Estadísticas │
│ (árbol)      │                              │              │
├──────────────┴──────────────────────────────┴──────────────┤
│ ▶ Inicio   [💻 terminal 1] [💻 terminal 2]            18:20 │
└─────────────────────────────────────────────────────────────┘
```

- **Barra de título:** arrástrala para mover la ventana y haz doble click para maximizar. Los botones `_` (minimizar), `□`/`❐` (maximizar/restaurar) y `×` (cerrar) funcionan como en cualquier programa.
- **Cerrar** (con `×`, Alt+F4 o desde la barra de tareas) pregunta **"¿Seguro que quieres cerrar Agent Map?"** y avisa cuántas terminales se van a detener. Las conversaciones quedan guardadas y puedes retomarlas después.
- Si abres Agent Map cuando ya está abierto, se enfoca la ventana existente en vez de abrir otra.

---

## 3. Panel izquierdo: sesiones

- **Activas ahora:** sesiones con Claude corriendo en este momento.
- **Proyectos:** árbol proyecto → sesión → subagentes.
- **Puntos de estado** en sesiones y también en la carpeta del proyecto (muestra el estado más activo de sus sesiones):
  - 🟠 abierta en Agent Map
  - 🟢 trabajando en otra terminal
  - 🔵 abierta en otra terminal, en espera
  - ⚪ cerrada
- **Buscador:** filtra por título, prompt, proyecto, rama o agente.
- **Filtros:** Todas, Activas, Hoy, Esta semana.

**Click en una sesión** → se abre en el centro con `claude --resume`. Si ya está abierta en otra terminal, Agent Map te avisa antes, porque dos ventanas escribiendo en la misma conversación pueden pisarse.

---

## 4. Centro: inicio y terminales

### Inicio

- **Carpeta + 📁 Elegir carpeta… + ＋ Iniciar Claude:** inicia una sesión nueva en la carpeta que quieras. El explorador permite:
  - partir de tu carpeta personal, de los discos o de los proyectos donde ya usaste Claude;
  - entrar en subcarpetas, **⬆ Subir** o pegar una ruta y pulsar **Ir**;
  - **＋ Crear aquí** una carpeta nueva (por ejemplo, para un proyecto nuevo);
  - **Usar esta carpeta**.

  El explorador oculta las carpetas que empiezan con `.` o `$`; si necesitas una, pega su ruta.
- **Recientes:** las 9 sesiones con actividad más reciente.

### Terminales

- Son terminales reales con Claude Code.
- Siguen vivas al cambiar de sesión: las encuentras abajo, en la **barra de tareas**.
- **✕ Cerrar terminal** (arriba o en la barra de tareas) pide confirmación con un popup.
- Al cerrar una terminal se detiene Claude **y todo lo que lanzó** (servidores MCP, comandos). La conversación queda guardada.

---

## 5. Panel derecho: detalle de la sesión

Sin sesión seleccionada muestra un resumen general. Con una sesión seleccionada:

- **Datos:** proyecto, rama, estado, inicio, última actividad, duración.
- **💬 Qué pasó:** primer y último prompt resumidos en 4 líneas. **Click** abre el texto completo en una ventana. Se quitan los recordatorios internos que agrega Claude Code.
- **🗨 Conversación:** tus prompts (azul, a la derecha) y las respuestas de Claude (blanco, a la izquierda), en orden, resumidos en 3 líneas. Al abrir una sesión se ve lo más reciente abajo. **Click** en un mensaje abre el texto completo en un popup. Solo muestra texto: no las llamadas a herramientas, el razonamiento interno ni lo que hicieron los subagentes.
- **🤖 Agentes usados:** cada agente es un link `↗`:
  - agentes de plugins (`plugin:agente`) → repositorio de GitHub del plugin;
  - agentes integrados (`Explore`, `Plan`, `general-purpose`, `web-fetch`…) → documentación oficial de subagentes.

---

## 6. 📊 Uso

El botón **📊 Uso** (junto a los filtros) abre una ventana con:

- **💳 Tu plan de Claude:**
  - nombre del plan (Pro, Max…) y si tienes uso extra activado;
  - **Sesión (5 horas)** y **Semana (7 días)**: % usado, % que queda, cuándo se reinicia y cuánto falta. La barra se pone naranja desde 70 % y roja desde 90 %.
- **Agentes (llamadas), Herramientas, Tokens y modelos:** de la sesión seleccionada o de todas.

### De dónde sale el % de uso

Claude Code solo entrega el uso del plan al comando de la **statusline**. Agent Map instala un pequeño intermediario:

- Al abrirse, la app copia `statusline-tap.mjs` a `C:\Users\<tú>\.agent-map\`.
- `~/.claude/settings.json` lo ejecuta delante de tu statusline de siempre:

  ```json
  "statusLine": {
    "type": "command",
    "command": "node \"C:\\Users\\<tú>\\.agent-map\\statusline-tap.mjs\" <tu statusline de siempre>"
  }
  ```

- El tap guarda **solo** los límites (`rate_limits`) en `~/.agent-map/usage.json` y ejecuta tu statusline con la misma entrada, así que ves lo mismo que antes.

Condiciones (de Claude Code): solo con plan Pro/Max de claude.ai, y los datos aparecen después de la primera respuesta en una sesión. Se actualizan mientras usas Claude; con todo cerrado se ven los últimos guardados, con su antigüedad.

El nombre del plan se lee de `~/.claude.json` (datos de la cuenta). Agent Map **no lee tus credenciales**.

---

## 7. Cómo funciona por dentro

- **Electron:** la app lleva su propio motor y arranca internamente un servidor en `127.0.0.1` con un **puerto al azar**. No tienes que abrir el navegador ni ejecutar comandos: el servidor nace y muere con la ventana.
- **Datos:** lee `~/.claude/projects/**/*.jsonl` y `~/.claude/sessions/*.json` **solo en modo lectura**. La lista de proyectos sale del `cwd` guardado en cada sesión.
- **Terminales:** `node-pty` (ConPTY de Windows) ejecuta `claude --resume <id>` o `claude` en la carpeta elegida.
- **Archivos propios:** todo lo que escribe Agent Map va a `C:\Users\<tú>\.agent-map\`:
  - `usage.json`: último uso del plan;
  - `statusline-tap.mjs`: copia del intermediario de la statusline;
  - `agent-map.log`: registro de arranque, cierre y errores.

### Seguridad

- Escucha solo en `127.0.0.1`.
- Rechaza peticiones con un `Host` distinto de `127.0.0.1`/`localhost` (protección contra DNS rebinding).
- Abrir terminales y crear carpetas exige que la petición venga de la propia app (`Origin`).
- Los links externos se abren en tu navegador, nunca dentro de la app.
- La página no tiene acceso a Node: solo a los botones de ventana (`contextIsolation`, `sandbox`).

---

## 8. Para desarrolladores

```
npm install        # dependencias
npm start          # app de escritorio en modo desarrollo
npm run web        # modo navegador en http://localhost:4317 (PORT para cambiarlo)
npm test           # pruebas
npm run dist       # genera el icono y el instalador en dist/
```

| Archivo | Qué hace |
|---|---|
| `electron/main.js` | ventana, botones, confirmación de cierre, instancia única, log |
| `electron/preload.cjs` | puente mínimo página ↔ ventana |
| `server.js` | API, terminales y archivos de la interfaz |
| `lib/scan.js` | lectura de sesiones, conversación, plan y repos de plugins |
| `lib/folders.js` | explorador y creación de carpetas |
| `statusline-tap.js` | intermediario de la statusline (uso del plan) |
| `public/` | interfaz (HTML, CSS, JS sin frameworks) |
| `scripts/make-icon.js` | genera `build/icon.ico` y `public/icon.png` |

---

## 9. Problemas conocidos

- **"Failed to fetch" en modo navegador:** el servidor no está corriendo. Ejecuta `npm run web`. La app de escritorio no tiene este problema.
- **Lentitud en carpetas dentro de tu usuario:** si `C:\Users\<tú>` es un repositorio git, Claude Code escanea todo tu perfil con `git ls-files` al trabajar en cualquier subcarpeta. Ese proceso puede seguir corriendo un rato después de cerrar la terminal; no es de Agent Map.
- **Statusline vacía después de borrar `.agent-map`:** vuelve a abrir Agent Map (recrea el tap) o quita el prefijo de `settings.json`.
- **Aviso de Windows SmartScreen:** el instalador no está firmado (ver sección 1).
