-- Historia 8.7: auditoria de consumo de tokens de Gemini por llamada real al
-- modelo (una fila por cada ronda del ciclo de tool-calling, no solo la
-- respuesta final). Sin purga automatica -- registro de auditoria de largo
-- plazo, igual criterio que log_auditoria_ia (8.2, todavia backlog).
-- IF NOT EXISTS: seguro correr este archivo mas de una vez (idempotente).
CREATE TABLE IF NOT EXISTS log_uso_tokens_gemini (
    id BIGSERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    candidates_tokens INTEGER NOT NULL DEFAULT 0,
    thoughts_tokens INTEGER NOT NULL DEFAULT 0,
    tool_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Soporta el resumen por chat_id + rango de fechas (AC #4).
CREATE INDEX IF NOT EXISTS idx_log_uso_tokens_gemini_chat_id_creado_en
    ON log_uso_tokens_gemini (chat_id, creado_en);

-- Soporta el resumen agregado por mes calendario, sin filtrar por chat_id (AC #4).
CREATE INDEX IF NOT EXISTS idx_log_uso_tokens_gemini_creado_en
    ON log_uso_tokens_gemini (creado_en);
