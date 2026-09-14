-- Optimizacion de costo (context caching de tools de Gemini, ver
-- decision-log.md): columna nueva para poder auditar cuantos de los tokens de
-- entrada vinieron del cache de tools en vez del catalogo completo -- prueba
-- directa de que el caching esta funcionando.
-- IF NOT EXISTS: seguro correr este archivo mas de una vez (idempotente).
ALTER TABLE log_uso_tokens_gemini
    ADD COLUMN IF NOT EXISTS cached_tokens INTEGER NOT NULL DEFAULT 0;
