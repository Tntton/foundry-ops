export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function optionalEnv(key: string): string | undefined {
  return process.env[key];
}
