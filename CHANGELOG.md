# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las fechas son las de los commits.

## [Sin publicar] — Etapa de mejoras 2.0

Cambios en `main` desde la versión 0.8.0. Todavía no hay un instalador publicado con ellos.

### Agregado
- **Estado en tiempo real** por *server-sent events* (`/api/events`): avisos en uno o dos segundos sin esperar la recarga de 15 s. Cada sesión expone cuándo cambió su estado.
- **Hook oficial de Claude Code**, opcional y por proyecto: se instala o quita desde el menú del proyecto, mostrando antes el archivo resultante; solo cambia `<proyecto>/.claude/settings.local.json` (con copia de respaldo). Registra solo metadatos en `~/.agent-map/events/` y Agent Map usa esos eventos para el estado y la herramienta en uso. Diagnóstico en ⚙ Opciones.
- **Avisos en vivo** (respuesta nueva, Claude terminó, espera tu intervención, sesión nueva o cerrada) con cola de hasta 3 visibles, y **sonidos** configurables por tipo con volumen y ▶ Probar.
- **Tres sonidos originales incluidos** (`assets/sounds/`, generados por `scripts/make-sounds.js`) como predeterminados; se pueden usar sonidos propios desde `~/.agent-map/sounds`.
- **Copiar cada mensaje** de la conversación con su texto completo y formato original.
- **Ocultar y recuperar** sesiones y proyectos (⚙ Opciones → Ocultos) y **🧹 Borrar datos de Agent Map** de una sesión o proyecto, sin tocar nada de Claude Code.
- **Secciones plegables** en el panel izquierdo, recordadas entre reinicios.
- **Detección de Claude Code:** aviso en Inicio si `claude` no está en el PATH y árbol vacío que distingue entre carpeta de Claude Code ausente, sin sesiones y error de lectura, con instrucciones (`/api/claude`).
- **Diagnóstico:** monitor de bloqueos del event loop con la actividad del tramo (terminales, ventanas, GC, memoria) y registro de errores en `~/.agent-map/agent-map.log`, sin contenido de sesiones.
- *Content Security Policy* en las páginas de la app.
- Pruebas E2E que abren la app real (también empaquetada): primera ejecución, avisos y sonidos, ocultar, hook, CSP, rendimiento, puerto fijo y respuestas obsoletas.

### Cambiado
- Los sonidos predeterminados son los incluidos. Una preferencia guardada que apunta a un mp3 de versiones anteriores que no está en el equipo usa el sonido incluido de ese tipo, sin reescribir `prefs.json`.
- **Puerto fijo 47317** para el servidor de la app de escritorio (la ventana conserva sus preferencias entre reinicios), con respaldo a un puerto libre si está ocupado.
- Retomar una sesión comprueba antes que exista `claude` y la carpeta de la sesión, y explica el problema en la terminal en lugar del error de `cmd.exe` o de node-pty.

### Rendimiento
- Lectura **incremental** de las sesiones JSONL: después de la primera vez solo se procesan las líneas nuevas.
- Escaneos recurrentes del disco **asíncronos**.
- Búfer de terminal por trozos (sin copiar todo el búfer por cada salida).
- Las líneas JSONL gigantes se unen una sola vez (una línea de 80 MB pasó de ~1,9 s a ~0,13 s de lectura).
- El indicador de sesiones trabajando anima `transform` y `opacity` en lugar de `box-shadow`: la página deja de repintarse 60 veces por segundo (CPU del renderer en reposo, con sesiones trabajando, ~79 % menor en las mediciones).

### Corregido
- Lector JSONL endurecido: detecta archivos truncados, reemplazados o reescritos y no pierde ni duplica registros.
- La página ignora respuestas viejas de `/api/tree` que llegan después de una más nueva.
- La prueba de rendimiento del monitor de bloqueos es determinista.
- El aviso de carpeta borrada al retomar una sesión muestra la ruta.

## [0.8.0]

Equipo de agentes con oficina pixel art, temas Windows XP, Matrix y Noche, conversación con avisos de mensajes nuevos, menú de click derecho (nombre, color, fijar), paneles redimensionables, pantalla completa y guía "Cómo funciona".

## [0.3.0]

Versión publicada anterior; detalle en su [release](https://github.com/TyronQuezada/agent-map/releases/tag/v0.3.0).
