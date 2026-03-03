export interface FilestackEnvironmentConfig {
  /**
   * Public Filestack API key.
   * Replace the placeholder value with your real key.
   */
  apiKey: string;
}

export interface Environment {
  production: boolean;
  /**
   * Filestack-related configuration shared across the app.
   */
  filestack: FilestackEnvironmentConfig;
}

export const environment: Environment = {
  production: false,
  filestack: {
    apiKey: 'A7NglhsrSb65sehJJWDkLz'
  }
};

