#!/usr/bin/env node
/**
 * One-time Gmail OAuth authorization for the water bill sync.
 *
 * Run this manually (NOT by the scheduler) on any machine with a browser —
 * it doesn't have to be the NUC. Opens a consent screen, captures the
 * authorization code via a local loopback redirect (the standard flow for a
 * Google Cloud "Desktop app" OAuth client — no redirect URI needs to be
 * registered, Google allows any http://localhost:* / http://127.0.0.1:* for
 * that client type), then exchanges it for a refresh token.
 *
 * Paste the printed GMAIL_REFRESH_TOKEN into the .env on whichever host runs
 * scripts/sync-water-bill.js (the NUC, per this project's deploy topology).
 *
 * Usage:
 *   node scripts/gmail-authorize.js
 * Requires GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET already set in .env.
 */
'use strict';

const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');
const { loadSecrets } = require('./sync');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

async function main() {
  const secrets = loadSecrets();
  if (!secrets.GMAIL_CLIENT_ID || !secrets.GMAIL_CLIENT_SECRET) {
    console.error('❌  Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(
    secrets.GMAIL_CLIENT_ID,
    secrets.GMAIL_CLIENT_SECRET,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-authorization
    scope: SCOPES,
  });

  console.log('🔑  Open this URL in a browser and grant access:\n');
  console.log(`    ${authUrl}\n`);
  console.log('Waiting for the redirect back to this script…\n');

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const authCode = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(err
        ? `<h1>Authorization failed</h1><p>${err}</p>`
        : '<h1>Authorized</h1><p>You can close this tab and return to the terminal.</p>');
      server.close();
      if (err) reject(new Error(err));
      else resolve(authCode);
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error('❌  No refresh_token returned. Revoke prior access at');
    console.error('    https://myaccount.google.com/permissions and re-run this script.');
    process.exit(1);
  }

  console.log('✅  Authorized. Add this to .env:\n');
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌  Authorization failed:', e.message);
    process.exit(1);
  });
}
