import raw from '@client-config';

export interface ClientConfig {
  client: {
    name: string;
    shortName: string;
    company: string;
    primaryColor: string;
    locale: string;
    currency: string;
    timezone: string;
  };
  modules: Record<string, boolean>;
  /** Opcional: limita el dashboard a estos widgets (por id), en este orden */
  dashboard?: { widgets?: string[] };
}

export const clientConfig = raw as ClientConfig;
export const brand = clientConfig.client;
