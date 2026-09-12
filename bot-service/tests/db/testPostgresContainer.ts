import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";

const execFileAsync = promisify(execFile);

export interface TestPostgres {
  connectionString: string;
  stop: () => Promise<void>;
}

/**
 * Gate para saltar la suite de integración cuando no hay un daemon Docker
 * alcanzable (p. ej. este sandbox, donde el CLI existe pero el daemon no
 * corre) — sin esto, `docker run` colgaría o fallaría de forma confusa en
 * vez de saltarse limpiamente.
 */
export function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Levanta un Postgres efímero (`--rm`, puerto host aleatorio) puramente para
 * esta suite de tests — NO es infra/docker-compose.yml del proyecto (esa
 * regla de "nunca correr/testear el compose de Firefly localmente" es sobre
 * ese archivo, no sobre un contenedor descartable para test doubles).
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const { stdout } = await execFileAsync("docker", [
    "run",
    "--rm",
    "-d",
    "-e",
    "POSTGRES_PASSWORD=test",
    "-e",
    "POSTGRES_DB=test",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  const containerId = stdout.trim();

  const { stdout: portOutput } = await execFileAsync("docker", ["port", containerId, "5432/tcp"]);
  const port = portOutput.trim().split(":").pop();
  const connectionString = `postgres://postgres:test@127.0.0.1:${port}/test`;

  await waitForPostgres(connectionString);

  return {
    connectionString,
    stop: async () => {
      await execFileAsync("docker", ["stop", containerId]);
    },
  };
}

async function waitForPostgres(connectionString: string, retries = 30): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("Postgres de prueba no respondió a tiempo");
}
