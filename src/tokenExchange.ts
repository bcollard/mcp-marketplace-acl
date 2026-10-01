// src/tokenExchange.ts
// OAuth 2.0 Token Exchange (RFC 8693) support.
// Exchanges an incoming Bearer token for a new one carrying this MCP server's identity,
// using the configured OAuth authorization server.

import { AsyncLocalStorage } from "node:async_hooks";

// -------------------- Startup configuration --------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// -------------------- Logger --------------------

type LogLevel = "DEBUG" | "INFO";
const LOG_LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1 };

const _rawLevel = process.env.LOG_LEVEL?.toUpperCase() ?? "INFO";
const activeLevel: LogLevel = _rawLevel in LOG_LEVEL_ORDER ? (_rawLevel as LogLevel) : "INFO";

export const logger = {
  info(message: string): void {
    if (LOG_LEVEL_ORDER[activeLevel] <= LOG_LEVEL_ORDER.INFO) {
      console.log(`[INFO]  ${new Date().toISOString()} ${message}`);
    }
  },
  debug(message: string): void {
    if (LOG_LEVEL_ORDER[activeLevel] <= LOG_LEVEL_ORDER.DEBUG) {
      console.log(`[DEBUG] ${new Date().toISOString()} ${message}`);
    }
  }
};

export const tokenExchangeConfig = {
  /** Token endpoint of the OAuth authorization server (e.g. https://as.example.com/oauth2/token) */
  tokenEndpointUrl: requireEnv("TOKEN_EXCHANGE_URL"),
  /** Client ID registered for this MCP server (RFC 8693 same-domain) */
  clientId: requireEnv("CLIENT_ID_TE_SAME_DOMAIN"),
  /** Client Secret registered for this MCP server (RFC 8693 same-domain) */
  clientSecret: requireEnv("CLIENT_SECRET_TE_SAME_DOMAIN"),
  /** Target resource / audience for the exchanged token (aud claim) */
  targetResource: process.env.TOKEN_EXCHANGE_TARGET_RESOURCE ?? "https://api.runlocal.dev/httpbin",
  /** Space-separated list of scopes requested for the exchanged token */
  targetScopes: process.env.TOKEN_EXCHANGE_TARGET_SCOPES ?? "httpbin:read httpbin:write"
};

export const jwtBearerConfig = {
  /** Token endpoint for the JWT Bearer grant (defaults to TOKEN_EXCHANGE_URL) */
  tokenEndpointUrl: process.env.JWT_BEARER_TOKEN_EXCHANGE_URL ?? requireEnv("TOKEN_EXCHANGE_URL"),
  /** Client ID for the JWT Bearer grant (RFC 7523 other-domain) */
  clientId: requireEnv("CLIENT_ID_JWT_OTHER_DOMAIN"),
  /** Client Secret for signing the JWT assertion (HS256) */
  clientSecret: requireEnv("CLIENT_SECRET_JWT_OTHER_DOMAIN"),
  /** Target resource / audience for the issued token (aud claim) */
  targetResource: process.env.JWT_BEARER_TARGET_RESOURCE ?? process.env.TOKEN_EXCHANGE_TARGET_RESOURCE ?? "https://api.runlocal.dev/httpbin",
  /** Space-separated list of scopes requested for the issued token */
  targetScopes: process.env.JWT_BEARER_TARGET_SCOPES ?? process.env.TOKEN_EXCHANGE_TARGET_SCOPES ?? "httpbin:read httpbin:write"
};

// -------------------- Async context storage --------------------

/**
 * Stores the raw incoming Bearer token for the duration of a request.
 * Tool handlers that need a downstream token should call `exchangeToken(rawTokenStorage.getStore()!)`.
 */
export const rawTokenStorage = new AsyncLocalStorage<string>();

// -------------------- Error type --------------------

export class TokenExchangeError extends Error {
  constructor(
    /** 'unreachable' — network failure; 'rejected' — AS returned an error; 'invalid_response' — unexpected AS response */
    public readonly kind: "unreachable" | "rejected" | "invalid_response",
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TokenExchangeError";
  }
}

// -------------------- RFC 8693 Token Exchange --------------------

/**
 * Exchanges `subjectToken` (the caller's incoming Bearer token) for a new access token
 * that carries this MCP server's identity, targeting the configured downstream resource.
 *
 * Token mapping (performed by the OAuth server):
 *   - sub  → copied from the incoming token
 *   - azp  → replaced with CLIENT_ID (this MCP server's client ID)
 *   - aud  → replaced with TOKEN_EXCHANGE_TARGET_RESOURCE
 *   - scope → set to TARGET_SCOPES
 *
 * @throws {TokenExchangeError} on network failure, AS rejection, or invalid response body.
 */
export async function exchangeToken(subjectToken: string): Promise<string> {
  const { tokenEndpointUrl, clientId, clientSecret, targetResource, targetScopes } =
    tokenExchangeConfig;

  logger.info(`[token-exchange] POST ${tokenEndpointUrl} | client: ${clientId} | resource: ${targetResource}`);
  logger.debug(`[token-exchange] incoming token: ${subjectToken} | claims: ${JSON.stringify(decodeJwtClaims(subjectToken))}`);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    // audience: targetResource,
    // audience not found?!
    scope: targetScopes
  });

  // Authenticate as this MCP server using HTTP Basic (client_id:client_secret)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(tokenEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`
      },
      body: body.toString()
    });
  } catch (cause) {
    throw new TokenExchangeError(
      "unreachable",
      `Authorization server unreachable: ${tokenEndpointUrl}`,
      cause
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore body-read errors
    }
    throw new TokenExchangeError(
      "rejected",
      `Token exchange rejected by authorization server (HTTP ${response.status})`,
      detail
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (cause) {
    throw new TokenExchangeError(
      "invalid_response",
      "Authorization server returned a non-JSON body",
      cause
    );
  }

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new TokenExchangeError(
      "invalid_response",
      "Authorization server response did not include a valid access_token"
    );
  }

  logger.debug(`[token-exchange] exchanged token: ${data.access_token} | claims: ${JSON.stringify(decodeJwtClaims(data.access_token))}`);

  return data.access_token;
}

// -------------------- JWT claim extraction --------------------

/**
 * Base64url-decodes the payload section of a JWT and returns its claims.
 * Does NOT verify the signature — only call this on tokens you already trust
 * (i.e. ones just issued by your own authorization server).
 *
 * Returns an empty object if the token is malformed.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// -------------------- RFC 7523 JWT Bearer grant --------------------

/**
 * Obtains an access token via the RFC 7523 JWT Bearer grant
 * (`urn:ietf:params:oauth:grant-type:jwt-bearer`).
 *
 * The caller's incoming Bearer token is used directly as the JWT assertion.
 *
 * @throws {TokenExchangeError} on network failure, AS rejection, or invalid response body.
 */
export async function exchangeJwtBearer(subjectToken: string): Promise<string> {
  const { tokenEndpointUrl, clientId, clientSecret, targetResource, targetScopes } = jwtBearerConfig;

  logger.info(`[jwt-bearer] POST ${tokenEndpointUrl} | client: ${clientId} | resource: ${targetResource}`);
  logger.debug(`[jwt-bearer] incoming token: ${subjectToken} | claims: ${JSON.stringify(decodeJwtClaims(subjectToken))}`);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: subjectToken,
    scope: targetScopes,
    resource: targetResource
  });

  // Authenticate as this MCP server using HTTP Basic (client_id:client_secret)
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(tokenEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`
      },
      body: body.toString()
    });
  } catch (cause) {
    throw new TokenExchangeError(
      "unreachable",
      `Authorization server unreachable: ${tokenEndpointUrl}`,
      cause
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore body-read errors
    }
    throw new TokenExchangeError(
      "rejected",
      `JWT Bearer grant rejected by authorization server (HTTP ${response.status})`,
      detail
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (cause) {
    throw new TokenExchangeError(
      "invalid_response",
      "Authorization server returned a non-JSON body",
      cause
    );
  }

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new TokenExchangeError(
      "invalid_response",
      "Authorization server response did not include a valid access_token"
    );
  }

  logger.debug(`[jwt-bearer] exchanged token: ${data.access_token} | claims: ${JSON.stringify(decodeJwtClaims(data.access_token))}`);

  return data.access_token;
}
