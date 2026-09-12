-- Historia 1.1: tabla base de autorizacion por chat_id de Telegram.
-- Sin columna de PAT todavia -- la agrega la historia 1.4 en una migracion
-- aparte (0002_...), sin modificar esta.
-- IF NOT EXISTS: seguro correr este archivo mas de una vez (idempotente).
CREATE TABLE IF NOT EXISTS usuarios_autorizados (
    chat_id BIGINT PRIMARY KEY,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
