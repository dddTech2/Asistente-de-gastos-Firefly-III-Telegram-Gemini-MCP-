# System Design v2 — Escalar a 50+ usuarios

> Esto cambia varias decisiones del diseño anterior (`system-design-asistente-gastos.md`, pensado para 1 persona/hogar). Marco explícitamente qué cambia y por qué. Donde no tengo el dato, lo dejo como **supuesto**.

**Supuestos que estoy asumiendo:** los 50 usuarios son independientes entre sí (no comparten cuentas), no es un producto comercial con SLA contractual, y "escalable" significa "que pueda crecer más de 50 sin reescribir todo", no "arquitectura para millones de usuarios".

---

## 1. Requisitos actualizados

**Lo que se agrega/cambia respecto a v1:**
- **Aislamiento estricto**: el usuario A jamás debe poder ver ni un byte de los datos del usuario B. Esto pasa de "no aplica" a **el requisito no funcional más importante del sistema**.
- **Concurrencia real**: picos de varios usuarios escribiéndole al bot al mismo tiempo (ej. todos después de almorzar).
- **Costo a escala**: 50 usuarios activos pueden multiplicar por 50 el gasto en tokens de Gemini vs. v1. Ahora sí hace falta control activo, no solo "usar el modelo barato".
- **Aprovisionamiento**: no puedes seguir creando cuentas a mano indefinidamente — necesitas un flujo de alta.
- Lo que **no** cambia: sigue sin ser un sistema que necesite 99.99% de disponibilidad ni multi-región.

---

## 2. Decisión de arquitectura clave: ¿un Firefly III por usuario, o uno solo para todos?

| Opción | A favor | En contra |
|---|---|---|
| **A. Una instancia de Firefly III por usuario** (50 contenedores) | Aislamiento físico total, cero riesgo de fuga de datos entre usuarios | 50x el consumo de RAM/CPU/disco, 50 bases de datos que respaldar y actualizar, orquestación mucho más compleja |
| **B. Una instancia de Firefly III, 50 cuentas de usuario dentro de ella** | Firefly III ya aísla datos por `user_id` en cada endpoint de su API — la separación no es algo que tengas que programar vos, ya viene del backend. Un solo servicio que mantener, actualizar y respaldar | Firefly III está pensado y probado como app personal/hogar, no como producto SaaS multi-tenant masivo — 50 usuarios en un servidor bien dimensionado está lejos de ser un problema, pero no es el caso de uso que sus creadores optimizan |

**Recomendación: Opción B.** Con 50 usuarios, la eficiencia de recursos y la simplicidad operativa (un solo lugar para actualizar/respaldar) pesan más que el riesgo, que además queda mitigado porque el aislamiento lo hace Firefly III mismo a nivel de API, no tu código. Igual lo trataría como algo a **validar con una prueba de carga** antes de confiar en él al 100%, no como un hecho asumido.

---

## 3. La pieza que hace viable la Opción B: credenciales por-request en el MCP

Este es el detalle técnico que cambia todo: el MCP `@firefly-iii-mcp/server` que recomendé antes soporta recibir el **PAT y la URL de Firefly III como headers en cada request** (`Authorization: Bearer <PAT>`), en vez de tener un único PAT fijo por variable de entorno.

Esto significa que **el Bot Service, al procesar el mensaje del usuario X, le pasa al MCP el PAT propio del usuario X** — nunca un token compartido. El propio Firefly III, al recibir esa llamada, solo devuelve/modifica los datos de ese usuario. La barrera de seguridad entre usuarios queda en el lugar correcto: adentro de Firefly III, no en lógica custom tuya que podrías implementar mal.

**Importante:** si en algún momento cambias de MCP server, verifica que soporte este patrón (credenciales por request). Los que fijan un solo PAT vía variable de entorno al arrancar (como algunas implementaciones en Python que vimos) son de un solo tenant — servirían para la Opción A, no para la B.

---

## 4. Cambios en el Bot Service

| Aspecto | v1 (1 usuario) | v2 (50 usuarios) |
|---|---|---|
| Estado (proceso) | Puede ser un solo proceso | Debe ser **stateless** — así podés correr 2+ réplicas si hace falta |
| Historial de conversación | SQLite | **Redis** (TTL corto, soporta escritura concurrente sin bloquear) |
| Usuarios + PAT | Tabla simple en SQLite | **Postgres**, con el PAT **cifrado en reposo** (no en texto plano) |
| Procesamiento del webhook | Síncrono (recibe → responde) | **Ack inmediato a Telegram + cola** (BullMQ + Redis). Si procesás todo síncrono con 50 usuarios en ráfaga, arriesgás el timeout del webhook de Telegram |
| Control de costos | No hacía falta | **Rate limiting por `chat_id`** en la cola (ej. máx. N mensajes/minuto por usuario) |

---

## 5. Aprovisionamiento de usuarios (nuevo en v2)

Confirmé algo importante en la documentación de la API: **sí existe `POST /api/v1/users`** para crear usuarios nuevos, pero requiere rol "owner" (es decir, lo ejecutás vos como admin, no cada usuario).

Lo que **no** pude confirmar con la misma certeza es si ese mismo endpoint te permite generar de una vez el PAT de ese usuario nuevo, o si el PAT solo se puede generar estando logueado como ese usuario desde `/profile`. Esto lo marco como **spike técnico pendiente** antes de comprometerte a un flujo 100% automatizado:

- Si se puede todo vía API admin → flujo de alta: `/registrar` en el bot → crea usuario en Firefly → genera PAT → lo guarda cifrado vinculado al `chat_id`. Todo automático.
- Si el PAT requiere que el usuario lo genere él mismo → el flujo de alta queda semi-manual (vos creás la cuenta, el usuario entra una vez a la web de Firefly a generar su token y te lo pasa). Sigue siendo manejable para 50, pero no es "un clic".

Para el inicio (primeros ~10 usuarios) hacerlo a mano es razonable. Vale la pena resolver el spike antes de llegar a los 50.

---

## 6. Infraestructura actualizada

- Sigue siendo **un solo host** — 50 usuarios no justifica multi-nodo todavía — pero ahora con Postgres y Redis como piezas separadas (no embebidas en el proceso del bot), para poder mover servicios a hosts distintos después **sin rediseño**, solo cambiando variables de conexión.
- Tamaño de VPS: subo la recomendación de v1 a **4 vCPU / 8GB** como piso, por la carga concurrente extra de PHP-FPM (Firefly) + Node (bot) + Postgres + Redis + workers de la cola.
- La cola de trabajo (BullMQ) también te da, gratis, el mecanismo de reintentos que ya querías para errores de Gemini/Firefly (Épica de hardening en el backlog).

---

## 7. Qué revisaría si esto crece bastante más allá de 50

- Separar Firefly III y el Bot Service en hosts distintos (ya quedaron desacoplados por diseño, así que es un cambio de configuración, no de arquitectura).
- Si los reportes/consultas empiezan a pesar, evaluar una réplica de lectura de Postgres.
- Firefly III está construyendo soporte para **"multiple financial administrations"** en sus endpoints v2 (lo vi en su changelog) — vale la pena revisar esa función cuando madure, porque es justo el concepto de "workspace por usuario" que hoy estás simulando con cuentas separadas en una sola instancia.
- Si algún día necesitás aislamiento *físico* garantizado por contrato/legal (no solo lógico), ahí sí volvería a evaluar la Opción A (una instancia por usuario o por grupo de usuarios).
