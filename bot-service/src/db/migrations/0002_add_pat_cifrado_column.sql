-- Historia 1.4: columna para el PAT cifrado en reposo (AES-256-GCM).
-- Extiende la tabla de 1.1 (0001_create_usuarios_autorizados.sql) sin
-- modificarla ni recrearla.
--
-- Formato almacenado en pat_cifrado: "<iv-b64>.<authTag-b64>.<ciphertext-b64>"
-- -- un unico campo de texto alcanza para los metadatos de cifrado que exige
-- GCM (nonce + tag de autenticacion), sin sumar columnas extra. NULL significa
-- "usuario dado de alta pero sin PAT entregado todavia" (flujo de 1.3 en curso).
-- IF NOT EXISTS: seguro correr este archivo mas de una vez (idempotente).
ALTER TABLE usuarios_autorizados
    ADD COLUMN IF NOT EXISTS pat_cifrado TEXT;
