import type { Pool } from "pg";
import { cifrarPat, descifrarPat } from "../auth/pat-crypto.js";

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

export function createUsuariosRepository(db: QueryableDb, encryptionKey: Buffer) {
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

    /**
     * Cifra el PAT (AES-256-GCM) y lo guarda en la fila del chat_id dado
     * (historia 1.4, AC #2). Falla si el chat_id no existe todavía en la
     * whitelist -- guardar un PAT "huérfano" sin usuario asociado sería un
     * error de uso, no un caso a tolerar en silencio.
     */
    async guardarPatCifrado(chatId: number, pat: string): Promise<void> {
      const patCifrado = cifrarPat(pat, encryptionKey);
      const resultado = await db.query(
        "UPDATE usuarios_autorizados SET pat_cifrado = $1 WHERE chat_id = $2",
        [patCifrado, chatId],
      );
      if (resultado.rowCount === 0) {
        throw new Error(`No existe el chat_id ${chatId} en la whitelist -- no se guardó ningún PAT`);
      }
    },

    /**
     * Devuelve el PAT en texto plano, únicamente en memoria (AC #3). `null`
     * si el chat_id no existe o todavía no tiene un PAT entregado (usuario
     * dado de alta en Firefly por 1.3 pero el paso `completar-pat` no corrió
     * todavía).
     */
    async obtenerPatDescifrado(chatId: number): Promise<string | null> {
      const resultado = await db.query<{ pat_cifrado: string | null }>(
        "SELECT pat_cifrado FROM usuarios_autorizados WHERE chat_id = $1",
        [chatId],
      );
      const fila = resultado.rows[0];
      if (!fila || fila.pat_cifrado === null) {
        return null;
      }
      return descifrarPat(fila.pat_cifrado, encryptionKey);
    },
  };
}

export type UsuariosRepository = ReturnType<typeof createUsuariosRepository>;
