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
}

export const clientConfig = raw as ClientConfig;
export const brand = clientConfig.client;
