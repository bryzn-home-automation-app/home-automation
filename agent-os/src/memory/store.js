'use strict';

const fs = require('fs');
const path = require('path');

/**
 * File-based record store. One JSON file per tier, written atomically
 * (temp file + rename) so a crash mid-write can never corrupt a tier.
 *
 * This is intentionally dependency-free and human-readable: the "physical
 * memory" is just inspectable JSON on disk, portable across machines and repos.
 */
class FileStore {
  constructor(memoryDir) {
    this.dir = memoryDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(tier) {
    return path.join(this.dir, `${tier}.json`);
  }

  read(tier) {
    const file = this._file(tier);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw new Error(`Corrupt memory tier "${tier}" at ${file}: ${err.message}`);
    }
  }

  write(tier, records) {
    const file = this._file(tier);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    fs.renameSync(tmp, file);
  }

  /** Append one record to a tier and persist. Returns the record. */
  append(tier, record) {
    const records = this.read(tier);
    records.push(record);
    this.write(tier, records);
    return record;
  }

  /** Replace the full record list for a tier (used by decay/compaction). */
  replace(tier, records) {
    this.write(tier, records);
  }
}

module.exports = { FileStore };
