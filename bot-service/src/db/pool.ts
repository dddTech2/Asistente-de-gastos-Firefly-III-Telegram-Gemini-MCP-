import { Pool } from "pg";
import { env } from "../config/env.js";

/**
 * Un solo pool compartido por proceso — node-postgres ya maneja el ciclo de
 * vida de las conexiones internamente, no hace falta abrir/cerrar por request.
 */
export const pool = new Pool({ connectionString: env.databaseUrl });
