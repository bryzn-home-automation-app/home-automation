/**
 * Shared bill-PDF storage helper — used by every sync script that downloads
 * a bill PDF (CoServ, water) so the webapp can serve it back for viewing.
 *
 * This runs inside the backend container (see the *SyncScheduler classes'
 * ProcessBuilder), where /scripts and the uploads volume are two independent
 * bind mounts — NOT siblings on disk. So the target dir must NOT be derived
 * from a script's own __dirname; it has to match the backend's actual mount
 * point, the same one StaticResourceConfig serves from
 * (uploads_data:/app/uploads in docker-compose.yml).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const UPLOADS_BILLS_DIR = '/app/uploads/bills';

/**
 * Save a bill PDF under uploads/bills/. The filename is built only from
 * server-known-safe values (account number, a date) passed in by the
 * caller — never from anything scraped off a page or email, to keep this
 * safe from path traversal without needing to sanitize free-form input.
 * Returns the relative path stored in the DB, e.g. "bills/123_2026-09-08.pdf".
 */
function saveBillPdf(buffer, accountNumber, dateSuffix) {
  fs.mkdirSync(UPLOADS_BILLS_DIR, { recursive: true });
  const filename = `${accountNumber}_${dateSuffix}.pdf`;
  const target = path.join(UPLOADS_BILLS_DIR, filename);
  if (!target.startsWith(UPLOADS_BILLS_DIR)) {
    throw new Error('Refusing to write outside uploads/bills/');
  }
  fs.writeFileSync(target, buffer);
  return `bills/${filename}`;
}

module.exports = { UPLOADS_BILLS_DIR, saveBillPdf };
