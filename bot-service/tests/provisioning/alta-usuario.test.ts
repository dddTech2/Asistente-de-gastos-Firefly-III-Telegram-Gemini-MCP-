import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsuariosRepository } from "../../src/db/usuarios.repository.js";
import { logger } from "../../src/lib/logger.js";
import { ejecutarAltaUsuario, entregarPatUsuario, type AltaUsuarioDeps } from "../../src/provisioning/alta-usuario.js";
import type { FireflyAdminClient } from "../../src/provisioning/firefly-admin-client.js";

function buildDeps(overrides?: {
  findByChatId?: UsuariosRepository["findByChatId"];
  crear?: UsuariosRepository["crear"];
  crearUsuario?: FireflyAdminClient["crearUsuario"];
}): AltaUsuarioDeps {
  const usuariosRepository: UsuariosRepository = {
    findByChatId: overrides?.findByChatId ?? vi.fn().mockResolvedValue(null),
    crear: overrides?.crear ?? vi.fn().mockResolvedValue(undefined),
  };
  const fireflyAdminClient: FireflyAdminClient = {
    crearUsuario:
      overrides?.crearUsuario ?? vi.fn().mockResolvedValue({ id: "1", email: "usuario@ejemplo.com" }),
  };
  return { usuariosRepository, fireflyAdminClient, fireflyBaseUrl: "https://firefly.ejemplo.com" };
}

describe("ejecutarAltaUsuario", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crea la cuenta en Firefly y registra el chat_id activo en la whitelist (AC #1, #4)", async () => {
    const deps = buildDeps();

    const resultado = await ejecutarAltaUsuario(
      { nombre: "Juan", email: "usuario@ejemplo.com", chatId: 555 },
      deps,
      "admin-test",
    );

    expect(deps.fireflyAdminClient.crearUsuario).toHaveBeenCalledWith({ email: "usuario@ejemplo.com" });
    expect(deps.usuariosRepository.crear).toHaveBeenCalledWith({ chatId: 555, activo: true });
    expect(resultado.fireflyUserId).toBe("1");
  });

  it("devuelve instrucciones para la variante semi-manual, sin intentar leer un PAT de la respuesta (AC #3)", async () => {
    const deps = buildDeps();

    const resultado = await ejecutarAltaUsuario(
      { nombre: "Juan", email: "usuario@ejemplo.com", chatId: 555 },
      deps,
      "admin-test",
    );

    expect(resultado.instrucciones).toContain("/profile");
    expect(resultado).not.toHaveProperty("pat");
  });

  it("rechaza el alta si el chat_id ya existe, sin llegar a llamar a Firefly (AC edge case: chat_id duplicado)", async () => {
    const deps = buildDeps({ findByChatId: vi.fn().mockResolvedValue({ chatId: 555, activo: true }) });

    await expect(
      ejecutarAltaUsuario({ nombre: "Juan", email: "usuario@ejemplo.com", chatId: 555 }, deps, "admin-test"),
    ).rejects.toThrow(/ya esta registrado/);

    expect(deps.fireflyAdminClient.crearUsuario).not.toHaveBeenCalled();
  });

  it("no registra el chat_id en la whitelist si la creación en Firefly falla (orden de operaciones)", async () => {
    const deps = buildDeps({ crearUsuario: vi.fn().mockRejectedValue(new Error("Firefly caído")) });

    await expect(
      ejecutarAltaUsuario({ nombre: "Juan", email: "usuario@ejemplo.com", chatId: 555 }, deps, "admin-test"),
    ).rejects.toThrow("Firefly caído");

    expect(deps.usuariosRepository.crear).not.toHaveBeenCalled();
  });

  it("propaga el error si falla el registro en la whitelist tras un alta exitosa en Firefly (edge case: cuenta huérfana)", async () => {
    const deps = buildDeps({ crear: vi.fn().mockRejectedValue(new Error("Postgres caído")) });

    await expect(
      ejecutarAltaUsuario({ nombre: "Juan", email: "usuario@ejemplo.com", chatId: 555 }, deps, "admin-test"),
    ).rejects.toThrow("Postgres caído");

    expect(deps.fireflyAdminClient.crearUsuario).toHaveBeenCalledTimes(1);
  });

  it("loggea administrador, chat_id y firefly_user_id sin exponer ningun PAT (AC #6)", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const deps = buildDeps();

    await ejecutarAltaUsuario({ nombre: "Juan", email: "usuario@ejemplo.com", chatId: 555 }, deps, "admin-test");

    const call = infoSpy.mock.calls.find(([, message]) => message === "Alta de usuario ejecutada: cuenta creada en Firefly III y chat_id habilitado en la whitelist");
    expect(call).toBeDefined();
    const [context] = call!;
    expect(context).toEqual({ administrador: "admin-test", chat_id: 555, firefly_user_id: "1" });
  });
});

describe("entregarPatUsuario", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("entrega el PAT al sink sin persistirlo ni loggearlo (AC #5, #6)", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const sink = vi.fn().mockResolvedValue(undefined);

    await entregarPatUsuario(555, "pat-secreto-de-prueba", "admin-test", sink);

    expect(sink).toHaveBeenCalledWith(555, "pat-secreto-de-prueba");
    const call = infoSpy.mock.calls.find(
      ([, message]) => message === "PAT recibido del usuario y entregado a la capa de cifrado/persistencia",
    );
    expect(call).toBeDefined();
    const [context] = call!;
    expect(JSON.stringify(context)).not.toContain("pat-secreto-de-prueba");
  });
});
