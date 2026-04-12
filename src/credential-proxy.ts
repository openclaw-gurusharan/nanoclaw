/**
 * Credential proxy for container isolation.
 * Containers talk to this proxy instead of holding real Anthropic creds.
 */
import { createServer, Server } from 'http';
import { request as httpRequest, RequestOptions } from 'http';
import { request as httpsRequest } from 'https';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
  ]);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}

export function startCredentialProxy(
  port: number,
  host: string,
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;
  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const makeRequest =
    upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        delete headers.connection;
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else if (headers.authorization) {
          delete headers.authorization;
          if (oauthToken) {
            headers.authorization = `Bearer ${oauthToken}`;
          }
        }

        const basePath = upstreamUrl.pathname.replace(/\/$/, '');
        const forwardPath = basePath + (req.url || '/');
        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port:
              upstreamUrl.port ||
              (upstreamUrl.protocol === 'https:' ? 443 : 80),
            path: forwardPath,
            method: req.method,
            headers,
          } as RequestOptions,
          (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
            upstreamRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });
    server.on('error', reject);
  });
}
