# Agent Map — Manual

Agent Map es una aplicación de escritorio para Windows (estilo Windows XP) que reúne todas tus sesiones de Claude Code en un solo lugar: las ves, las buscas, las retomas con un click y trabajas en terminales reales dentro de la misma ventana.

---

## 1. Instalación

1. Descarga `Agent-Map-Setup-x.y.z.exe` desde [Releases](https://github.com/TyronQuezada/agent-map/releases/latest) (o genéralo con `npm run dist`, queda en `dist\`) y ejecútalo.
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

- **Antes de desinstalar**, quita el hook de cada proyecto donde lo instalaste (click derecho en el proyecto → 🪝 Hook de Claude Code… → **Quitar el hook**). Si borras `.agent-map` sin quitarlo, Claude Code seguirá intentando ejecutar un script que ya no existe.
- Borra la carpeta `C:\Users\<tú>\.agent-map`.
- Quita el prefijo `node "C:\Users\<tú>\.agent-map\statusline-tap.mjs" ` de la línea `statusLine` en `~/.claude/settings.json` (ver sección 6).

---

## 2. La ventana

```
┌ Agent Map ─────────────────────────────────────────── _ □ × ┐
│ [Buscar…] [Todas|Activas|Hoy|Esta semana] [📊 Uso] [⚙ Opciones]  [⛶] [⟳] │
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
- **Pantalla completa:** Agent Map abre en pantalla completa, como si apretaras F11. **F11** (o el botón ⛶) la activa o desactiva; en pantalla completa, `❐` vuelve a ventana normal. Se puede desactivar en ⚙ Opciones.
- **⚙ Opciones:**
  - **Tema:** Windows XP, **Matrix** (letras verdes sobre negro, también en la terminal) o **Noche** (oscuro azulado). Los tres mantienen los 3 paneles y la barra de tareas.
  - **Tamaño de letra** de la terminal.
  - **Abrir en pantalla completa** sí o no.
  - **Sonidos:** volumen y un sonido para cada aviso (respuesta nueva, Claude terminó, otros avisos), con **▶ Probar**. La app trae tres sonidos propios (`agentmap-mensaje.wav`, `agentmap-fin.wav`, `agentmap-aviso.wav`) que suenan desde la instalación. Para usar los tuyos, copia archivos mp3, wav u ogg a `~/.agent-map/sounds` (botón **📂 Abrir carpeta de sonidos**) y elígelos en la lista.
  - **📖 Cómo funciona Agent Map:** una guía de 10 diapositivas con capturas, como la intro de un videojuego. Avanza con ◀ ▶ o las flechas del teclado; click en el texto lo muestra completo.
- **Ancho de los paneles:** pasa el mouse por la línea que separa dos paneles (el cursor cambia a ↔), mantén apretado y arrastra. La terminal se reacomoda en vivo mientras arrastras. Doble click en la línea vuelve al ancho original. También se mueve con las flechas ← → si la línea tiene el foco. Agent Map recuerda el ancho la próxima vez.

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

**Click derecho en una sesión** → menú con:
- **✏️ Cambiar nombre…:** un nombre propio para reconocerla. Solo cambia en Agent Map; la conversación de Claude no se toca. Vacío = nombre original.
- **🎨 Color:** 8 colores (o ninguno). La sesión se marca con una franja y el nombre de ese color; sirve para agrupar por cliente, urgencia, etc.
- **📌 Fijar arriba:** la sesión aparece en la sección **Fijadas**, al principio del árbol.
- **📋 Copiar ID de la sesión:** para usar `claude --resume <id>` en otra terminal.
- **🙈 Ocultar sesión:** deja de aparecer en el árbol (también al buscar) y no da avisos ni sonidos. La conversación sigue intacta.
- **↺ Restablecer:** quita nombre, color y fijado.
- **🧹 Borrar datos de Agent Map…:** después de confirmar, borra lo que Agent Map guarda de la sesión: nombre, color, fijado y las marcas de leído/no leído (las respuestas quedan como leídas). No toca nada de Claude Code: ni la conversación, ni `~/.claude`, ni la carpeta del proyecto.

**Click derecho en un proyecto** → **🙈 Ocultar proyecto** (con todas sus sesiones) o **🧹 Borrar datos de Agent Map del proyecto…** (lo mismo que arriba, para todas sus sesiones).

**Recuperar lo oculto:** ⚙ Opciones → **Ocultos** (o el aviso "🙈 N ocultos" al pie del árbol) → **👁 Mostrar**. Vuelve igual que estaba, sin avisos de lo que llegó mientras estuvo oculto. Lo oculto se guarda en `~/.agent-map/prefs.json` y se mantiene al reiniciar.

El menú también se usa con el teclado: ↑ ↓ para moverse, Enter para elegir, Esc para cerrar.

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
- **Copiar y pegar** como en Windows Terminal:
  - **Ctrl+V** (o Ctrl+Shift+V) pega el texto del portapapeles. Si el portapapeles no tiene texto (por ejemplo, una captura), se manda Ctrl+V a Claude para que pegue la imagen.
  - **Ctrl+C** con texto seleccionado lo copia; sin selección, interrumpe a Claude como siempre.
  - **Click derecho:** copia la selección o, si no hay selección, pega.
- **✕ Cerrar terminal** (arriba o en la barra de tareas) pide confirmación con un popup.
- Al cerrar una terminal se detiene Claude **y todo lo que lanzó** (servidores MCP, comandos). La conversación queda guardada.

### 👥 Equipo de agentes

Un **jefe** (orquestador) y **2 agentes** con nombre, cargo e instrucciones propias. Tú le hablas al jefe; él divide el trabajo y se lo encarga a los agentes, que pueden trabajar **al mismo tiempo** si sus tareas no se cruzan.

**Crear un equipo**
1. En Inicio, elige la carpeta (o crea una nueva con 📁 Elegir carpeta… → ＋ Crear aquí).
2. Pulsa **👥 Iniciar con equipo…**.
3. Elige una plantilla y cambia lo que quieras: nombre del jefe, nombre y cargo de cada agente, instrucciones.
4. **Crear equipo e iniciar** abre la terminal del jefe, que ya sabe con quién trabaja.

Plantillas (todas pensadas para que los 2 agentes puedan avanzar a la vez sin pisarse):

| Plantilla | Agente 1 | Agente 2 |
|---|---|---|
| 🎮 Videojuego | Programador | Artista (sprites) |
| 🌐 Página o app web | Frontend | Backend |
| 🔍 Ingeniería inversa (entender un programa propio o con permiso) | Analista: lee y desarma el código módulo por módulo | Documentador: documenta y escribe pruebas que confirman lo analizado |
| 🔄 Migración o modernización | Migrador: actualiza un módulo a la vez | Verificador: fija el comportamiento con pruebas antes y después |
| 📚 Investigación y redacción | Investigador: busca y verifica fuentes | Redactor: escribe con esas notas |
| 📊 Análisis de datos | Ingeniero de datos: limpia y prepara | Analista: gráficos y conclusiones |
| 🛡 Revisión de seguridad del propio código | Auditor: busca fallas | Reparador: las corrige con pruebas |
| ✏️ En blanco | — | — |

> **Elige la carpeta de un solo proyecto.** Claude lee el `CLAUDE.md` de las carpetas de arriba, así que un equipo creado en una carpeta que contiene otros proyectos (por ejemplo `D:\Proyectos`) aparece en todos ellos. Agent Map te avisa y te pide confirmar si pasa.

**Qué se crea en la carpeta del proyecto**

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Reglas del proyecto. Agent Map agrega (o reemplaza) solo su sección del equipo; lo demás que tengas ahí se conserva. |
| `.claude/agents/<nombre>.md` | Un archivo por agente, con su cargo e instrucciones. Son subagentes normales de Claude Code. |
| `TAREAS.md` | Pizarra compartida: Pendiente / En curso / Listo. El jefe la mantiene al día. |
| `.claude/agent-map-team.json` | Le dice a Agent Map quién es quién (para la oficina y las fichas). |

Si ya tienes un agente propio con el mismo nombre, Agent Map no lo pisa: te pide otro nombre.

**Mientras trabajan**
- **Panel izquierdo → 👥 Equipo:** las 3 fichas con su estado ("💻 Edita player.gd", "😴 Terminó hace 2 min"). Click en una ficha muestra **lo que está haciendo**, paso a paso. Es **solo lectura**: a los agentes no se les interrumpe; si quieres cambiar algo, díselo al jefe.
- **Centro:** una sola terminal, la del jefe. Ahí escribes.
- **Panel derecho → 🏢 Oficina:** la oficina en pixel art.
  - Sin trabajo, los 3 duermen (zzz): el jefe en su sillón y los agentes en su escritorio.
  - Cuando el jefe trabaja, va a su escritorio; cuando le encarga algo a un agente, ese agente despierta y se pone a teclear (su monitor se enciende).
  - A veces se levantan a la **impresora** (más seguido cuando acaban de escribir un archivo) o a la **máquina de café**. Eso es decorativo.
  - Mientras trabajan teclean, hacen pausas, miran a un lado o se estiran, y tienen un globito "…" sobre la cabeza. Durmiendo, respiran.
  - **Pasa el mouse sobre alguien** y aparece su pensamiento con lo que hace en pocas palabras y cuánto lleva: "💭 Programador Codeando player.gd ⏱ 2:15", "💭 Artista Dibujando un sprite", "💭 Jefe Supervisando a Programador y Artista". El mismo resumen y el tiempo aparecen en las fichas de la izquierda y bajo la oficina.
  - **⛶ Pantalla completa:** la oficina ocupa toda la pantalla y muestra los globos de todos. Esc (o "✕ Salir") vuelve al panel.
  - **⧉ Separar:** abre la oficina en su propia ventana, que puedes llevar a otro monitor y poner en pantalla completa (F11 o su botón ⛶). **📌 Anclar** (en esa ventana o en el panel) la devuelve al panel; cerrar esa ventana hace lo mismo.
  - También puedes arrastrar el divisor del panel derecho para verla más grande.
  - Al caminar esquivan los muebles, y pasan casi todo el tiempo sentados: se levantan cada 15 a 30 segundos, y no siempre.
  - **Sin tokens:** si tu plan llega al 100 %, se apaga la luz de la oficina (de noche, con luna en la ventana), los 3 duermen y un cartel muestra la cuenta regresiva hasta que se renueven los tokens.

> **Ojo con el plan:** cada agente trabajando gasta del mismo límite de uso. Con 2 agentes a la vez el límite de 5 horas se consume más rápido. Míralo abajo, en la barra de tareas.

---

## 5. Panel derecho: detalle de la sesión

Sin sesión seleccionada muestra un resumen general. Con una sesión seleccionada:

Cada sección se **pliega o despliega** con un click en su título (botón ▲/▼). Agent Map recuerda cuáles dejaste plegadas, también en la ventana 📊 Uso.

- **Datos:** proyecto, rama, estado, inicio, última actividad, duración.
- **💬 Qué pasó:** primer y último prompt resumidos en 4 líneas. **Click** abre el texto completo en una ventana. Se quitan los recordatorios internos que agrega Claude Code.
- **🗨 Conversación (estilo MSN):** globos redondeados con punta: tú a la derecha (azul, "Tú dice:") y Claude a la izquierda (blanco, "Claude dice:"), en orden y resumidos en 3 líneas. Al abrir una sesión se ve lo más reciente abajo. **Click** en un mensaje abre el texto completo en un popup. Solo muestra texto: no las llamadas a herramientas, el razonamiento interno ni lo que hicieron los subagentes.
- **🔴 Mensajes nuevos, como en Messenger:** cuando Claude responde algo que todavía no abriste aparece un globito rojo con el número: en la sesión y en la carpeta del proyecto (izquierda) y junto a "Conversación (N) +2" (derecha). Cada respuesta nueva llega en celeste, **parpadea 3 veces** y queda marcada con "NUEVO". Click en el globito rojo te lleva a la primera; **abrir una respuesta nueva la da por leída** (y las anteriores). Tus propios mensajes no cuentan. Se recuerda entre aperturas de la app: si Claude respondió con Agent Map cerrado, lo ves al abrir.
- **📋 Copiar un mensaje:** cada globo tiene su botón 📋, que copia ese mensaje completo y con su formato original (aunque en pantalla se vea recortado). Confirma con ✓ junto al botón; si el portapapeles falla, lo avisa.
- **🔔 Avisos en vivo:** cuando Claude responde, termina o espera tu intervención, y cuando una sesión se abre o se cierra, aparece un aviso abajo a la derecha en uno o dos segundos, aunque estés mirando otra sesión. Se ven hasta 3 a la vez y el resto espera su turno; se cierran solos y **click en un aviso abre su sesión**. Si hay un popup abierto, esperan a que lo cierres. Al abrir la app no se avisa nada de lo que pasó antes, y las sesiones o proyectos ocultos no avisan. Cada aviso puede sonar (ver ⚙ Opciones → Sonidos).
- **🤖 Agentes usados:** cada agente es un link `↗`:
  - agentes de plugins (`plugin:agente`) → repositorio de GitHub del plugin;
  - agentes integrados (`Explore`, `Plan`, `general-purpose`, `web-fetch`…) → documentación oficial de subagentes.

---

## 6. 📊 Uso

**En la barra de tareas** (abajo a la derecha) siempre ves la sesión de 5 horas: "⏳ Sesión: 63 % usado · quedan 37 % · se reinicia en 2 h 2 min". Se pone naranja desde 70 % y roja desde 90 %. Si llegaste al límite cambia a "🌙 Sin tokens · se renuevan en 1:22:04", con cuenta regresiva. Click en ella abre el detalle.

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

- **Electron:** la app lleva su propio motor y arranca internamente un servidor en `127.0.0.1`, en el **puerto 47317** (así la ventana conserva sus preferencias entre reinicios). Si ese puerto está ocupado usa uno libre y lo anota en el log; en ese arranque no se recuerdan paneles ni secciones plegadas. No tienes que abrir el navegador ni ejecutar comandos: el servidor nace y muere con la ventana.
- **Datos:** lee `~/.claude/projects/**/*.jsonl` y `~/.claude/sessions/*.json` **solo en modo lectura**. La lista de proyectos sale del `cwd` guardado en cada sesión. La lectura es incremental: después de la primera vez solo se procesan las líneas nuevas de cada sesión.
- **En vivo:** mientras la ventana está abierta, el servidor mira el estado de las sesiones cada segundo y avisa a la página por *server-sent events* solo cuando algo cambia. Además, la página recarga todo cada 15 s.
- **Terminales:** `node-pty` (ConPTY de Windows) ejecuta `claude --resume <id>` o `claude` en la carpeta elegida.
- **Archivos propios:** todo lo que escribe Agent Map va a `C:\Users\<tú>\.agent-map\`:
  - `usage.json`: último uso del plan;
  - `prefs.json`: tema, letra, pantalla completa y los nombres, colores y fijados de tus sesiones;
  - `statusline-tap.mjs`: copia del intermediario de la statusline;
  - `agentmap-hook.mjs` y `events/`: el hook oficial de Claude Code y sus registros (ver abajo);
  - `sounds/`: tus sonidos propios (los tres predeterminados vienen dentro de la app);
  - `agent-map.log`: registro de arranque, cierre, errores y avisos del monitor de bloqueos (cuánto se trabó la app y qué hacía: solo duraciones y contadores, nunca contenido).

### 🪝 Hook de Claude Code (opcional, por proyecto)

Sin el hook, Agent Map deduce el estado de cada sesión de `~/.claude/sessions/*.json`. Con el hook, Claude Code le **avisa** cada evento oficial: más exacto, al instante, y con la herramienta que está usando.

- **Instalar:** click derecho en un proyecto → **🪝 Hook de Claude Code…**. La ventana explica qué cambia y muestra el archivo tal como quedaría; nada se escribe hasta que aprietas **Instalar en este proyecto**.
- **Qué cambia:** solo `<proyecto>/.claude/settings.local.json` (tu configuración personal de Claude Code para esa carpeta; no se sube a git). Se agrega un comando `node "~/.agent-map/agentmap-hook.mjs"` en 12 eventos, en segundo plano (`async`): nunca demora ni bloquea a Claude. Si el archivo ya existía, antes se guarda una copia en `settings.local.json.agentmap-backup`. Nunca se toca `~/.claude/settings.json` ni otros proyectos, y no se puede instalar en tu carpeta de usuario ni en una raíz.
- **Quitar:** la misma ventana → **Quitar el hook**. Se borran solo los comandos de Agent Map; si el archivo lo había creado Agent Map y queda vacío, se borra.
- **Eventos:** SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, Stop, StopFailure, SubagentStart y SubagentStop.
- **Qué se guarda** (en `~/.agent-map/events/<sesión>.jsonl`, una línea por evento): tipo de evento, sesión, carpeta, modo de permisos, nombre de la herramienta, id de la llamada, duración, tipo de aviso, id y tipo de subagente y la ruta de los archivos editados. **Nunca** tus prompts, las respuestas, los comandos, el contenido de archivos, la salida de las herramientas ni el texto de los avisos. Los registros sin actividad en 30 días se borran solos.
- **Diagnóstico:** ⚙ Opciones → **🪝 Hook de Claude Code** dice si el script está listo, si hay `node` en el PATH (el hook lo necesita) y cuándo llegó el último evento. La ventana de cada proyecto dice si está instalado y si llegan eventos de esa carpeta.
- Requiere Claude Code con hooks (probado con la 2.1.322). Las sesiones que ya estaban abiertas al instalar empiezan a enviar eventos al reiniciarlas.

### Seguridad

- Escucha solo en `127.0.0.1`.
- Rechaza peticiones con un `Host` distinto de `127.0.0.1`/`localhost` (protección contra DNS rebinding).
- Abrir terminales y crear carpetas exige que la petición venga de la propia app (`Origin`).
- Los links externos se abren en tu navegador, nunca dentro de la app.
- La página no tiene acceso a Node: solo a los botones de ventana (`contextIsolation`, `sandbox`).
- Las páginas tienen una *Content Security Policy*: solo cargan scripts, imágenes, sonidos y conexiones del propio servidor local.

---

## 8. Para desarrolladores

```
npm install        # dependencias
npm start          # app de escritorio en modo desarrollo
npm run web        # modo navegador en http://localhost:4317 (PORT para cambiarlo)
npm test           # pruebas unitarias e integración
npm run test:e2e   # E2E con la app real (AGENT_MAP_EXE=<ruta al .exe> prueba la empaquetada)
npm run dist       # genera el icono y el instalador en dist/
node scripts/make-sounds.js   # regenera los sonidos incluidos en assets/sounds
```

Las E2E abren Agent Map con datos de prueba en carpetas temporales y un `claude` falso: nunca tocan tu `~/.claude` ni ejecutan el Claude real. `port.e2e` necesita el puerto 47317 libre: se omite (sin fallar) si Agent Map está abierto.

| Archivo | Qué hace |
|---|---|
| `electron/main.js` | ventana, botones, confirmación de cierre, instancia única, log |
| `electron/preload.cjs` | puente mínimo página ↔ ventana |
| `server.js` | API, eventos en vivo, terminales, sonidos y archivos de la interfaz |
| `lib/scan.js`, `lib/jsonl.js` | lectura incremental de sesiones, conversación, plan y repos de plugins |
| `lib/hooks.js`, `lib/agentmap-hook.js` | hook oficial: instalación por proyecto, registros y estado |
| `lib/claude.js` | detección de `claude` en el PATH y de la carpeta de datos |
| `lib/diag.js`, `lib/termbuf.js` | monitor de bloqueos; búfer de terminal por trozos |
| `lib/folders.js` | explorador y creación de carpetas |
| `lib/prefs.js` | preferencias (tema, letra, pantalla completa, sonidos, ocultos) y nombres/colores de sesiones |
| `lib/team.js` | equipo de agentes: crea sus archivos y lee su estado en vivo |
| `public/office.js` | oficina pixel art del equipo (canvas, sin imágenes), globos de pensamiento |
| `public/office.html`, `office-page.js` | la oficina en ventana aparte |
| `statusline-tap.js` | intermediario de la statusline (uso del plan) |
| `public/` | interfaz (HTML, CSS, JS sin frameworks); avisos en `toast.js` y `events.js`, sonidos en `sounds.js` |
| `assets/sounds/` | los tres sonidos incluidos |
| `scripts/make-icon.js`, `make-sounds.js` | generan el icono y los sonidos incluidos, sin dependencias |

---

## 9. Problemas conocidos

- **"Claude Code no está disponible":** Agent Map no encontró el comando `claude` en el PATH. Puedes seguir viendo tus sesiones, pero no abrirlas ni iniciar nuevas. Instala Claude Code ([code.claude.com/docs](https://code.claude.com/docs)), comprueba en una terminal nueva que `claude --version` funcione y **reinicia Agent Map** (lee el PATH al arrancar).
- **"No se encontró la carpeta de Claude Code" / "Todavía no hay sesiones":** la primera significa que no existe `~/.claude` (Claude Code nunca se usó con tu usuario); la segunda, que existe pero sin conversaciones. En ambos casos, abre una sesión con **＋ Iniciar Claude** y aparece sola en el árbol. Si dice **"No se pudo leer la carpeta"**, revisa los permisos de `~/.claude`.
- **"La carpeta de esta sesión ya no existe":** Claude Code retoma cada sesión en su carpeta original. Restáurala o vuelve a crearla en la misma ruta y abre la sesión de nuevo.
- **Procesos que quedan tras un cierre forzado:** el cierre normal detiene cada terminal con todo lo que lanzó. Si Agent Map se cierra a la fuerza (Administrador de tareas) o se cae, pueden quedar vivos procesos con consola propia que lanzó Claude, como servidores MCP. Ciérralos desde el Administrador de tareas.
- **Ventana en blanco:** si la página de Agent Map se cae, la ventana queda en blanco hasta reiniciar la app (queda anotado en el log). Las terminales siguen vivas mientras tanto.
- **Uso de GPU con sesiones trabajando:** mientras haya sesiones trabajando a la vista, su indicador animado mantiene ocupada la GPU (sin repintar la página). Sin sesiones trabajando, la app en reposo casi no usa CPU.
- **"Failed to fetch" en modo navegador:** el servidor no está corriendo. Ejecuta `npm run web`. La app de escritorio no tiene este problema.
- **Lentitud en carpetas dentro de tu usuario:** si `C:\Users\<tú>` es un repositorio git, Claude Code escanea todo tu perfil con `git ls-files` al trabajar en cualquier subcarpeta. Ese proceso puede seguir corriendo un rato después de cerrar la terminal; no es de Agent Map.
- **Statusline vacía después de borrar `.agent-map`:** vuelve a abrir Agent Map (recrea el tap) o quita el prefijo de `settings.json`.
- **Aviso de Windows SmartScreen:** el instalador no está firmado (ver sección 1).
