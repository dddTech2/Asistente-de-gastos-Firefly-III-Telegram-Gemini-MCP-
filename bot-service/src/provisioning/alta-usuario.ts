import type { UsuariosRepository } from "../db/usuarios.repository.js";
import { logger } from "../lib/logger.js";
import type { FireflyAdminClient } from "./firefly-admin-client.js";

export interface AltaUsuarioInput {
  nombre: string;
  email: string;
  chatId: number;
}

export interface AltaUsuarioResult {
  fireflyUserId: string;
  instrucciones: string;
}

export interface AltaUsuarioDeps {
  fireflyAdminClient: FireflyAdminClient;
  usuariosRepository: UsuariosRepository;
  fireflyBaseUrl: string;
}

/**
 * Variante semi-manual (confirmada por el spike 1.2: Firefly III no tiene
 * forma de generar un PAT en nombre de otro usuario vía API admin)
 * [Source: docs/plan/spike-provisionamiento-pat-findings.md#recomendación-para-la-historia-13].
 * El texto no debe pegarse tal cual en un mensaje de Telegram permanente --
 * es para que el administrador se lo transmita al usuario por el canal que
 * prefiera (llamada, mensaje que luego borra, etc.), no como registro fijo.
 */
function construirInstruccionesPat(baseUrl: string): string {
  return (
    `Cuenta creada en Firefly III. Pedile al usuario que entre a ${baseUrl.replace(/\/$/, "")}/profile, ` +
    "pestaña OAuth, y genere un Personal Access Token nuevo (\"Create New Token\"). " +
    "Cuando te lo entregue, completá el alta con ese token usando el paso 'completar-pat' -- " +
    "no lo dejes pegado como texto plano en el chat de Telegram."
  );
}

/**
 * Paso 1 del flujo de alta (AC #1, #3, #4): crea la cuenta en Firefly III y,
 * solo si eso tuvo éxito, registra el chat_id en la whitelist de 1.1 con
 * `activo = true`. Ese orden es intencional (Dev Notes): si el alta en
 * Firefly falla, nunca llega a tocar la whitelist. Si en cambio Firefly tiene
 * éxito pero el registro en la whitelist falla (ej. Postgres caído en ese
 * instante), queda una cuenta huérfana en Firefly sin chat_id asociado; a la
 * escala de esta historia (alta manual, ~10-50 usuarios) el administrador la
 * repara a mano revisando el log de auditoría de este mismo paso -- no se
 * construye un mecanismo de rollback automático para un caso borde de este
 * volumen [Inference, ver Dev Notes de la historia sobre mantener el scope de
 * un dev-day].
 */
export async function ejecutarAltaUsuario(
  input: AltaUsuarioInput,
  deps: AltaUsuarioDeps,
  administrador: string,
): Promise<AltaUsuarioResult> {
  const existente = await deps.usuariosRepository.findByChatId(input.chatId);
  if (existente) {
    throw new Error(`El chat_id ${input.chatId} ya esta registrado en la whitelist`);
  }

  const usuarioFirefly = await deps.fireflyAdminClient.crearUsuario({ email: input.email });

  await deps.usuariosRepository.crear({ chatId: input.chatId, activo: true });

  logger.info(
    { administrador, chat_id: input.chatId, firefly_user_id: usuarioFirefly.id },
    "Alta de usuario ejecutada: cuenta creada en Firefly III y chat_id habilitado en la whitelist",
  );

  return {
    fireflyUserId: usuarioFirefly.id,
    instrucciones: construirInstruccionesPat(deps.fireflyBaseUrl),
  };
}

/**
 * El PAT que el usuario le entrega al administrador (variante semi-manual)
 * nunca lo persiste esta función -- se lo pasa directo al `sink` que la
 * historia 1.4 (cifrado + persistencia en Postgres) proveerá. Hasta que 1.4
 * exista, el llamador (script de admin) debe pasar un sink explícito; no hay
 * un default que escriba a ningún lado (AC #5).
 */
export type PatSink = (chatId: number, pat: string) => Promise<void>;

export async function entregarPatUsuario(
  chatId: number,
  pat: string,
  administrador: string,
  sink: PatSink,
): Promise<void> {
  await sink(chatId, pat);
  // No incluir `pat` en el log bajo ningún nombre de campo (AC #5/#6): el
  // logger redacta la clave "pat" [Source: src/lib/logger.ts], pero acá ni
  // siquiera se intenta pasarla -- doble barrera.
  logger.info(
    { administrador, chat_id: chatId },
    "PAT recibido del usuario y entregado a la capa de cifrado/persistencia",
  );
}
