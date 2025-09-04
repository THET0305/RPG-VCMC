export interface AppConfig {
  firebase: { apiKey: string; authDomain: string; projectId: string; databaseURL: string; };
  livekit: { host: string; tokenEndpoint: string; };
  music: { baseUrl: string; };
}

let cfg: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cfg) {
    console.log('[config] using cached cfg');
    return cfg;
  }
  const url = new URL(`${import.meta.env.BASE_URL}config.json`, location.href).toString();
  console.log('[config] fetching', url);
  const res = await fetch(url, { cache: 'no-store' });
  console.log('[config] status', res.status);
  if (!res.ok) throw new Error(`Missing config.json at ${url} (status ${res.status})`);
  cfg = await res.json();
  return cfg!;
}
