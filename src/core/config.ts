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
    /** Opcional: título de la pestaña y de la app instalada (si no, `name`) */
    title?: string;
    /** Opcional: logo del cliente (fondo claro), p. ej. "/brand/logo.png" */
    logo?: string;
    /** Opcional: símbolo cuadrado del cliente para la barra lateral */
    mark?: string;
  };
  modules: Record<string, boolean>;
  /** Opcional: limita el dashboard a estos widgets (por id), en este orden */
  dashboard?: { widgets?: string[] };
}

export const clientConfig = raw as ClientConfig;
export const brand = clientConfig.client;
