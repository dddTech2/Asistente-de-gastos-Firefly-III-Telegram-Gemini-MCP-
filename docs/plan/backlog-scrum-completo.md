# Backlog Scrum — Asistente de gastos (Firefly III + Telegram + Gemini + MCP)

Actualizado para la arquitectura multi-usuario (50+) definida en `system-design-v2-multiusuario.md`.

---

## 1. Visión del producto

> Para personas que quieren registrar y consultar sus gastos personales sin fricción, este es un asistente conversacional que permite gestionar transacciones por Telegram usando lenguaje natural, respaldado por Firefly III como motor financiero self-hosted. A diferencia de una app de gastos tradicional, ofrece control total sobre los datos (self-hosted, sin depender de un tercero), una experiencia conversacional con IA en vez de formularios, y soporte para múltiples usuarios con aislamiento total entre sus datos.

---

## 2. Roles

En un equipo de una sola persona, vos cubrís los tres roles de Scrum. Igual vale la pena separarlos mentalmente:

- **Product Owner** (vos): decide qué entra al backlog y en qué orden.
- **Scrum Master** (vos): cuida el proceso — que los sprints tengan una meta clara y que no se metan historias a mitad de sprint sin criterio.
- **Dev Team** (vos): construye.
- **Beta testers** *(recomendado)*: conseguite 1-2 personas del grupo de 50 usuarios que prueben cada Sprint Review — un backlog sin feedback real de usuario es solo una lista de tareas técnicas.

---

## 3. Definition of Ready (DoR)

Una historia puede entrar a un sprint solo si:
- Tiene criterios de aceptación claros (no ambiguos).
- Está estimada en story points.
- No depende de otra historia que todavía no está hecha.
- Vos entendés el "para qué" sin tener que releer el contexto tres veces.

## 4. Definition of Done (DoD)

Una historia se considera terminada solo si:
- El código está desplegado en el entorno correspondiente (no "funciona en mi máquina").
- Se probó manualmente el camino feliz y al menos un caso de error.
- No rompe nada que ya funcionaba (regresión).
- Si toca datos sensibles (PAT, credenciales), quedaron cifrados/fuera de logs.
- Quedó documentado en al menos una línea (README o comentario) para tu propio yo futuro.

---

## 5. Product Backlog

Prioridad: 🔴 Alta · 🟡 Media · 🟢 Baja. Estimación en story points (Fibonacci: 1-2-3-5-8-13).

### Épica 0 — Infraestructura base

**HU-01** — Como desarrollador, quiero desplegar Firefly III + Postgres/MariaDB con Docker Compose, para tener el backend financiero corriendo.
- Dado el servidor limpio, cuando corro `docker compose up`, entonces Firefly III responde en el navegador.
- 🔴 · 3 pts

**HU-02** — Como desarrollador, quiero un reverse proxy con HTTPS automático, para exponer los servicios de forma segura.
- Dado un dominio propio, cuando accedo por HTTPS, entonces el certificado es válido y renueva solo.
- 🔴 · 2 pts

**HU-03** — Como desarrollador, quiero desplegar Redis y Postgres como servicios separados del bot, para soportar estado compartido y colas.
- Dado el docker-compose, cuando levanto los servicios, entonces el bot puede conectarse a ambos por variables de entorno.
- 🔴 · 3 pts

**HU-04** — Como administrador, quiero backups automáticos diarios de toda la base de datos, para no perder información financiera.
- Dado un cron configurado, cuando pasa la medianoche, entonces aparece un backup nuevo en almacenamiento externo.
- 🔴 · 5 pts

**HU-05** — Como administrador, quiero haber probado una restauración completa desde backup al menos una vez, para confiar en que funciona cuando lo necesite.
- Dado un backup reciente, cuando lo restauro en un entorno de prueba, entonces los datos coinciden con el original.
- 🔴 · 3 pts

### Épica 1 — Autenticación y multi-tenancy

**HU-06** — Como administrador, quiero crear cuentas de usuario en Firefly III desde un flujo controlado, para dar de alta nuevos usuarios del bot.
- Dado un usuario nuevo, cuando ejecuto el flujo de alta, entonces existe una cuenta Firefly III separada para él.
- 🔴 · 5 pts

**HU-07** — Como desarrollador, quiero un spike que confirme si el PAT de un usuario nuevo se puede generar vía API o requiere login manual, para diseñar el flujo de alta definitivo.
- Entregable: documento corto con la conclusión y el flujo recomendado.
- 🔴 · 3 pts

**HU-08** — Como desarrollador, quiero guardar el PAT de cada usuario cifrado en Postgres vinculado a su `chat_id` de Telegram, para que ningún dato sensible quede en texto plano.
- Dado un PAT nuevo, cuando se guarda, entonces en la base de datos aparece cifrado, no en texto plano.
- 🔴 · 5 pts

**HU-09** — Como usuario, quiero que el bot solo responda a personas registradas, para que nadie ajeno use mi instancia.
- Dado un `chat_id` no registrado, cuando escribe al bot, entonces recibe un mensaje de "no autorizado" y nada más pasa.
- 🔴 · 2 pts

**HU-10** — Como desarrollador, quiero que cada llamada al MCP use el PAT del usuario que escribió el mensaje, para garantizar aislamiento total de datos entre usuarios.
- Dado el usuario A y el usuario B, cuando ambos usan el bot en paralelo, entonces ninguno ve datos del otro bajo ninguna circunstancia.
- 🔴 · 5 pts — **crítica de seguridad, no negociable**

### Épica 2 — Bot de Telegram (esqueleto)

**HU-11** — Como administrador, quiero crear el bot en BotFather y configurar el webhook, para empezar a recibir mensajes.
- 🔴 · 1 pt

**HU-12** — Como usuario, quiero que el bot me responda algo cuando le escribo, para saber que está funcionando.
- 🔴 · 2 pts

**HU-13** — Como desarrollador, quiero que el bot confirme el webhook a Telegram inmediatamente y procese el mensaje de forma asíncrona, para evitar timeouts con múltiples usuarios simultáneos.
- Dado un pico de mensajes, cuando llegan al mismo tiempo, entonces Telegram nunca recibe un timeout.
- 🔴 · 5 pts

### Épica 3 — Integración directa con Firefly III (sin IA todavía)

**HU-14** — Como usuario, quiero poder registrar un gasto con un comando simple (`/gasto 20000 almuerzo`), para validar que el flujo básico funciona sin depender de la IA todavía.
- 🔴 · 5 pts

**HU-15** — Como usuario, quiero poder pedir un resumen de mis transacciones del mes con un comando, para verificar que la consulta también funciona.
- 🟡 · 3 pts

### Épica 4 — Servidor MCP

**HU-16** — Como desarrollador, quiero desplegar el MCP de Firefly III en modo multi-tenant (credenciales por request), para que sirva a los 50 usuarios desde un solo servicio.
- 🔴 · 5 pts

**HU-17** — Como desarrollador, quiero probar el MCP de forma aislada con MCP Inspector, para confirmar que las tools responden antes de conectarlo a Gemini.
- 🔴 · 2 pts

**HU-18** — Como administrador, quiero limitar el set de tools expuestas por el MCP, para que la IA no pueda ejecutar acciones destructivas (ej. borrar cuentas).
- 🟡 · 3 pts

### Épica 5 — Integración con Gemini (conversación en lenguaje natural)

**HU-19** — Como desarrollador, quiero que el Bot Service arme el prompt con historial + tools del MCP y llame a Gemini, para habilitar la conversación en lenguaje natural.
- 🔴 · 8 pts

**HU-20** — Como usuario, quiero poder escribir "gasté 20 mil en almuerzo" y que se registre correctamente, para no tener que usar comandos rígidos.
- Dado un mensaje en lenguaje natural con monto y concepto, cuando lo envío, entonces la transacción queda creada con los datos correctos.
- 🔴 · 8 pts

**HU-21** — Como usuario, quiero poder preguntar "¿cuánto llevo gastado en comida este mes?" y recibir una respuesta clara, para entender mis finanzas sin entrar a una app.
- 🔴 · 5 pts

**HU-22** — Como usuario, quiero que si el dato que doy es inválido (cuenta/categoría inexistente), el bot me pida aclaración en vez de fallar en seco, para no perder el registro del gasto.
- 🟡 · 5 pts

**HU-23** — Como usuario, quiero que el bot recuerde el contexto de los últimos mensajes, para no tener que repetir información en la misma conversación.
- 🟡 · 3 pts

### Épica 6 — Control de costos y concurrencia

**HU-24** — Como administrador, quiero una cola de procesamiento (BullMQ + Redis) para los mensajes entrantes, para absorber ráfagas de varios usuarios sin bloquear el bot.
- 🔴 · 8 pts

**HU-25** — Como administrador, quiero limitar cuántos mensajes por minuto puede enviar cada usuario, para controlar el gasto en la API de Gemini.
- 🔴 · 5 pts

**HU-26** — Como desarrollador, quiero reintentos automáticos con backoff ante fallos de Gemini o Firefly, para que errores temporales no se conviertan en errores para el usuario.
- 🟡 · 5 pts

**HU-27** — Como desarrollador, quiero descartar webhooks duplicados de Telegram usando el `update_id`, para no duplicar transacciones.
- 🔴 · 3 pts

### Épica 7 — App Android

**HU-28** — Como usuario, quiero conectar la app Waterfly III a mi cuenta de Firefly III con mi propio PAT, para registrar gastos también desde el celular sin pasar por Telegram.
- 🟡 · 2 pts

**HU-29** — Como administrador, quiero evaluar si vale la pena una app Android propia más adelante, para decidir si Waterfly III es suficiente a largo plazo.
- 🟢 · 3 pts

### Épica 8 — Observabilidad y hardening

**HU-30** — Como administrador, quiero logs estructurados de todo lo que hace el bot, para poder depurar problemas rápido.
- 🟡 · 3 pts

**HU-31** — Como administrador, quiero una tabla de auditoría que registre qué escribió cada usuario y qué tool ejecutó la IA, para poder revisar qué pasó ante cualquier duda.
- 🔴 · 5 pts

**HU-32** — Como administrador, quiero alertas si el bot o Firefly III se caen, para enterarme antes que los usuarios.
- 🟡 · 3 pts

**HU-33** — Como administrador, quiero rotar y proteger todos los secretos fuera del control de versiones, para reducir el riesgo de una fuga.
- 🔴 · 2 pts

**HU-34** — Como administrador, quiero hacer una prueba de carga simulando 50 usuarios concurrentes, para validar que la arquitectura de instancia única de Firefly III aguanta antes de confiar en ella en producción.
- 🔴 · 8 pts

### Épica 9 — Captura por notificaciones (backlog futuro, no planificado aún)

**HU-35** — Como usuario, quiero que la app Android capture automáticamente las notificaciones de Nequi/Bancolombia y me sugiera crear la transacción, para no tener que escribirla a mano.
- 🟢 · 13 pts — exploratorio

**HU-36** — Como usuario, quiero confirmar o descartar cada gasto detectado automáticamente antes de que se guarde, para evitar falsos positivos.
- 🟢 · 5 pts

---

## 6. Sprints (2 semanas cada uno — recalibrar velocity después del Sprint 1)

| Sprint | Meta | Historias | Pts |
|---|---|---|---|
| **0 — Fundaciones** | Infra base corriendo y accesible | HU-01, HU-02, HU-03, HU-11 | 9 |
| **1 — Validación end-to-end** | Crear/consultar transacción real desde Telegram, sin IA | HU-09, HU-12, HU-13, HU-14, HU-15, HU-27 | 20 |
| **2 — Multi-tenancy** | Más de un usuario con aislamiento real | HU-06, HU-07, HU-08, HU-10 | 18 |
| **3 — MCP conectado** | MCP desplegado y probado en modo multi-tenant | HU-16, HU-17, HU-18 | 10 |
| **4 — Conversación natural** | Primera conversación en lenguaje natural de punta a punta | HU-19, HU-20, HU-21 | 21 |
| **5 — Resiliencia + costos** | El bot no se cae ni se dispara en costo con varios usuarios | HU-22, HU-23, HU-24, HU-25 | 21 |
| **6 — Confiabilidad** | Backups probados, auditoría, secretos protegidos | HU-04, HU-05, HU-26, HU-31, HU-33 | 20 |
| **7 — Canal móvil + monitoreo** | Waterfly III conectado, alertas activas | HU-28, HU-29, HU-30, HU-32 | 11 |
| **8 — Gate de escala** | Confirmar que aguanta 50 usuarios antes de invitarlos a todos | HU-34 | 8 |

**Backlog futuro (sin sprint):** Épica 9 (HU-35, HU-36) — se prioriza después de tener los 50 usuarios estables, no antes.

~16 semanas (4 meses) a este ritmo, asumiendo dedicación part-time. Es una estimación de arranque — ajustala con la velocity real después del Sprint 1.

---

## 7. Ceremonias (adaptadas a equipo de una persona)

- **Sprint Planning**: al inicio de cada sprint, tomar historias del backlog priorizado hasta llenar la capacidad (usa el Sprint 1 como referencia de tu velocity real).
- **Daily (auto-checkpoint)**: 3 líneas por día — qué hice, qué sigue, qué me bloquea. Sirve más de lo que parece incluso en solitario.
- **Sprint Review**: al final de cada sprint, probar en vivo lo construido — idealmente con al menos un beta tester real, no solo vos.
- **Retro**: qué funcionó, qué no, qué ajustar en la próxima estimación.

## 8. Métricas mínimas a trackear

- **Velocity** (pts completados por sprint) — para dejar de adivinar cuánto entra en cada sprint.
- **Bugs encontrados en producción vs. en review** — te dice si el DoD es suficiente o hay que endurecerlo.
- **Costo real de Gemini por usuario/mes** — clave para saber si el rate limiting de HU-25 está bien calibrado.
