import type { Pool } from "pg";

export interface UsuarioAutorizado {
  chatId: number;
  activo: boolean;
}

/**
 * Subconjunto de `Pool` que este repositorio realmente necesita — permite
 * pasarle también un `Client` suelto (p. ej. en el test de integración con
 * un Postgres efímero) sin pelear con el tipado completo de `Pool`.
 */
export interface QueryableDb {
  query: Pool["query"];
}

interface UsuarioAutorizadoRow {
  chat_id: string;
  activo: boolean;
}

export function createUsuariosRepository(db: QueryableDb) {
  return {
    async findByChatId(chatId: number): Promise<UsuarioAutorizado | null> {
      const result = await db.query<UsuarioAutorizadoRow>(
        "SELECT chat_id, activo FROM usuarios_autorizados WHERE chat_id = $1",
        [chatId],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return { chatId: Number(row.chat_id), activo: row.activo };
    },
  };
}

export type UsuariosRepository = ReturnType<typeof createUsuariosRepository>;
