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

    /**
     * Registra un chat_id nuevo en la whitelist (historia 1.3, alta de
     * usuario). Falla si el chat_id ya existe -- el llamador (el orquestador
     * de alta) decide qué hacer con eso, no se hace upsert silencioso acá.
     */
    async crear(usuario: UsuarioAutorizado): Promise<void> {
      await db.query("INSERT INTO usuarios_autorizados (chat_id, activo) VALUES ($1, $2)", [
        usuario.chatId,
        usuario.activo,
      ]);
    },
  };
}

export type UsuariosRepository = ReturnType<typeof createUsuariosRepository>;
