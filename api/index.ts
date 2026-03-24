import worker from "../src/index";
import type { Env } from "../src/types";

export const config = {
  runtime: "edge",
};

function readEnv(key: string): string | undefined {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env?.[key];
}

const env: Env = {
  K2_API_KEY: readEnv("K2_API_KEY") ?? "",
  K2_BASE_URL: readEnv("K2_BASE_URL") ?? "https://api.k2think.ai/v1",
};

export default async function handler(request: Request): Promise<Response> {
  return worker.fetch(request, env);
}
