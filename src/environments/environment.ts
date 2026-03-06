export interface FilestackEnvironmentConfig {
  /**
   * Public Filestack API key.
   * Replace the placeholder value with your real key.
   */
  apiKey: string;
}

export interface GoogleEnvironmentConfig {
  /**
   * Google Picker API key.
   * Create one in Google Cloud Console → Credentials → API Keys.
   * Restrict it to the Google Picker API.
   */
  apiKey: string;
  /**
   * Google OAuth 2.0 Client ID.
   * Create one in Google Cloud Console → Credentials → OAuth 2.0 Client IDs.
   * Type: Web application. Add your dev origin (e.g. http://localhost:4200)
   * to "Authorized JavaScript origins".
   */
  clientId: string;
}

export interface Environment {
  production: boolean;
  /** Filestack-related configuration shared across the app. */
  filestack: FilestackEnvironmentConfig;
  /** Google Drive / Picker API credentials. */
  google: GoogleEnvironmentConfig;
}

export const environment: Environment = {
  production: false,
  filestack: {
    apiKey: 'A7NglhsrSb65sehJJWDkLz'
  },
  google: {
    apiKey: 'AIzaSyAKULkEIU8LIqYCl4LdL7u5O0l3SUWsMSU',
    clientId: '509901772679-nau8hm25c4em1nnlfbvdfcaesa5bqo2a.apps.googleusercontent.com'
  }
};

