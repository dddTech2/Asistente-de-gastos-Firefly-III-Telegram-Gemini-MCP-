# Spike — Provisionamiento de PAT (¿API admin o login manual?)

**Historia:** [1.2.spike-provisionamiento-pat](../../bmad-output/stories/1.2.spike-provisionamiento-pat.story.md)
**Fecha:** 2026-09-11
**Estado del hallazgo:** Conclusivo (evidencia de código fuente, no requiere prueba en vivo adicional)

## Pregunta original

> ¿Se puede generar el Personal Access Token (PAT) de un usuario nuevo vía el
> endpoint admin (`POST /api/v1/users`), o requiere que el usuario inicie
> sesión manualmente en `/profile`?

[Source: system-design-v2-multiusuario.md#5-aprovisionamiento-de-usuarios-nuevo-en-v2]

## Evidencia recolectada

No se ejecutó la prueba en vivo contra `firefly.nyoholding.com`: hacerlo habría requerido pegar el PAT owner en este chat, algo que ya se descartó explícitamente por seguridad en esta misma sesión. En su lugar se auditó directamente el **código fuente oficial** de Firefly III (rama `main`, github.com/firefly-iii/firefly-iii), que es evidencia más fuerte que un único request de prueba porque describe el comportamiento determinista de cualquier instancia corriendo ese código — no depende de configuración particular del servidor.

1. **`POST /api/v1/users` no devuelve ni puede devolver un token.**
   El método `store()` en `app/Api/V1/Controllers/System/UserController.php` crea el usuario y serializa la respuesta con `UserTransformer`. Los únicos campos que este transformer expone son: `id`, `created_at`, `updated_at`, `email`, `blocked`, `blocked_code`, `role`, `links`. No existe ningún campo `token`, `access_token` ni `personal_access_token` en la respuesta, y el controlador no tiene ningún método relacionado con tokens.
   [Source: github.com/firefly-iii/firefly-iii — app/Api/V1/Controllers/System/UserController.php, app/Transformers/UserTransformer.php]

2. **No existe ningún endpoint dentro de la API (`routes/api.php`) para generar o listar tokens en nombre de otro usuario.**
   Se revisó el archivo completo de rutas de la API: no hay ninguna ruta con `token`, `personal-access-token` ni `oauth`. La gestión de OAuth clients y Personal Access Tokens vive exclusivamente en `routes/web.php`, bajo el prefijo `/oauth`, agrupada con el middleware **`user-full-auth`** (sesión web autenticada, no autenticación API):
   - `POST /oauth/personal-access-tokens` → `OAuthController@storePersonalAccessToken`
   - `GET /oauth/personal-access-tokens` → `OAuthController@listPersonalAccessTokens`
   - `DELETE /oauth/personal-access-tokens/{token_id}` → `OAuthController@destroyPersonalAccessToken`

   [Source: github.com/firefly-iii/firefly-iii — routes/api.php, routes/web.php]

3. **`storePersonalAccessToken()` genera el token únicamente para el usuario de la sesión actual, sin parámetro de impersonación:**

   ```php
   public function storePersonalAccessToken(Request $request): JsonResponse
   {
       $this->validation->make($request->only(['name']), [
           'name' => ['required', 'max:255'],
       ])->validate();

       return response()->json($request->user()->createToken($request->name));
   }
   ```

   Usa `$request->user()` (el usuario autenticado por sesión web en ese request), no un `user_id` de otro usuario. No hay forma de que un owner autenticado por API genere un token para otro usuario a través de este endpoint, porque el endpoint mismo exige sesión web del propio usuario destinatario.
   [Source: github.com/firefly-iii/firefly-iii — app/Http/Controllers/Profile/OAuthController.php]

**Nota sobre versión:** esta auditoría es sobre la rama `main` (evolución continua de Firefly III). No se confirmó el número de versión exacto desplegado en `firefly.nyoholding.com`, pero el patrón (PAT ligado a sesión web, ausente de la API) es estructural — viene de Laravel Passport `createToken()` atado al usuario autenticado — y no ha cambiado en las versiones recientes según los hilos de la comunidad revisados (GitHub Discussion #4595, docs.firefly-iii.org/how-to/firefly-iii/features/api/).

## Conclusión

**Respuesta a AC #1:** No. `POST /api/v1/users` crea el usuario pero jamás incluye un PAT en la respuesta, ni en esa llamada ni en ninguna de seguimiento con ese mismo mecanismo.

**Respuesta a AC #2:** No existe ningún endpoint administrativo — ni en la API REST ni en OAuth clients — que permita a un owner generar un PAT en nombre de otro usuario. El único camino es que **ese usuario, autenticado con su propia sesión web, entre a `/profile` → OAuth → Personal Access Tokens y lo genere él mismo**.

## Recomendación para la historia 1.3

**Variante aplicable:** la **(b) semi-manual** descrita en `system-design-v2-multiusuario.md §5`: el admin crea la cuenta (puede automatizarse vía `POST /api/v1/users`), pero el usuario debe entrar una vez a la web de Firefly III a generar su propio PAT y entregárselo al admin/bot para completar el alta.

[Source: system-design-v2-multiusuario.md#5-aprovisionamiento-de-usuarios-nuevo-en-v2]

**Implicación de diseño para 1.3:** el flujo `/registrar` del bot puede automatizar la creación del usuario (paso 1), pero necesita un paso explícito de "pega acá tu Personal Access Token" con instrucciones de dónde generarlo (`/profile` → OAuth → Personal Access Tokens), en vez de intentar obtenerlo automáticamente. Esto es aceptable a la escala actual (~10-50 usuarios) según la arquitectura, que ya contemplaba el alta manual como válida para este rango.

## Riesgo abierto

Ninguno de bloqueo — el hallazgo es conclusivo por evidencia de código fuente, no queda pendiente de una prueba en vivo. Riesgo menor, no bloqueante: si en el futuro se actualiza Firefly III a una versión con un mecanismo distinto de gestión de tokens, esta conclusión debería revalidarse (bajo costo: repetir la búsqueda de rutas `oauth`/`token` en `routes/api.php` tras cada actualización mayor).
