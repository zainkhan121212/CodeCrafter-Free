// Reference SQLite reader used to verify the SQLite tester. Spoilers!
import { openSync, readSync } from 'node:fs';

const [file, command] = process.argv.slice(2);
const fd = openSync(file, 'r');
const header = Buffer.alloc(100);
readSync(fd, header, 0, 100, 0);
let pageSize = header.readUInt16BE(16);
if (pageSize === 1) pageSize = 65536;
const textEncoding = header.readUInt32BE(56);

const pageCache = new Map();
function page(n) {
  if (!pageCache.has(n)) {
    const buf = Buffer.alloc(pageSize);
    readSync(fd, buf, 0, pageSize, (n - 1) * pageSize);
    pageCache.set(n, buf);
  }
  return pageCache.get(n);
}

function varint(buf, pos) {
  let v = 0n;
  for (let i = 0; i < 9; i++) {
    const b = buf[pos + i];
    if (i === 8) return [(v << 8n) | BigInt(b), pos + 9];
    v = (v << 7n) | BigInt(b & 0x7f);
    if (!(b & 0x80)) return [v, pos + i + 1];
  }
}
const vnum = (buf, pos) => { const [v, p] = varint(buf, pos); return [Number(v), p]; };

function parseRecord(buf, pos) {
  const [headerSize, afterHeaderSize] = vnum(buf, pos);
  const types = [];
  let p = afterHeaderSize;
  while (p < pos + headerSize) { const [t, np] = vnum(buf, p); types.push(t); p = np; }
  let d = pos + headerSize;
  return types.map(t => {
    let v;
    if (t === 0) v = null;
    else if (t >= 1 && t <= 6) {
      const size = [0, 1, 2, 3, 4, 6, 8][t];
      let n = 0n;
      for (let i = 0; i < size; i++) n = (n << 8n) | BigInt(buf[d + i]);
      const bits = BigInt(size * 8);
      if (n >= 1n << (bits - 1n)) n -= 1n << bits;
      v = Number(n);
      d += size;
    } else if (t === 7) { v = buf.readDoubleBE(d); d += 8; }
    else if (t === 8) v = 0;
    else if (t === 9) v = 1;
    else if (t >= 12 && t % 2 === 0) { const n = (t - 12) / 2; v = buf.subarray(d, d + n); d += n; }
    else { const n = (t - 13) / 2; v = buf.toString(textEncoding === 2 ? 'utf16le' : 'utf8', d, d + n); d += n; }
    return v;
  });
}

function pageHeader(n) {
  const buf = page(n);
  const off = n === 1 ? 100 : 0;
  const type = buf[off];
  const cellCount = buf.readUInt16BE(off + 3);
  const interior = type === 0x02 || type === 0x05;
  const rightMost = interior ? buf.readUInt32BE(off + 8) : null;
  const cellsAt = off + (interior ? 12 : 8);
  const cells = [];
  for (let i = 0; i < cellCount; i++) cells.push(buf.readUInt16BE(cellsAt + i * 2));
  return { buf, type, cells, rightMost };
}

// Calls fn(rowid, values) for every row of the table b-tree rooted at `root`.
function scanTable(root, fn) {
  const { buf, type, cells, rightMost } = pageHeader(root);
  if (type === 0x05) {
    for (const c of cells) scanTable(buf.readUInt32BE(c), fn);
    scanTable(rightMost, fn);
  } else if (type === 0x0d) {
    for (const c of cells) {
      const [, p1] = vnum(buf, c);
      const [rowid, p2] = vnum(buf, p1);
      fn(rowid, parseRecord(buf, p2));
    }
  }
}

function findRow(root, rowid) {
  const { buf, type, cells, rightMost } = pageHeader(root);
  if (type === 0x05) {
    for (const c of cells) {
      const [key] = vnum(buf, c + 4);
      if (rowid <= key) return findRow(buf.readUInt32BE(c), rowid);
    }
    return findRow(rightMost, rowid);
  }
  for (const c of cells) {
    const [, p1] = vnum(buf, c);
    const [id, p2] = vnum(buf, p1);
    if (id === rowid) return parseRecord(buf, p2);
  }
  return null;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Collects rowids whose first index column equals `value`.
function searchIndex(root, value, out) {
  const { buf, type, cells, rightMost } = pageHeader(root);
  const interior = type === 0x02;
  for (const c of cells) {
    let p = interior ? c + 4 : c;
    const [, rp] = vnum(buf, p);
    const rec = parseRecord(buf, rp);
    const order = cmp(value, rec[0]);
    if (interior && order <= 0) searchIndex(buf.readUInt32BE(c), value, out);
    if (order === 0) out.push(rec[rec.length - 1]);
    if (order < 0) return out;
  }
  if (interior) searchIndex(rightMost, value, out);
  return out;
}

function schema() {
  const rows = [];
  scanTable(1, (rowid, [type, name, tblName, rootpage, sql]) => rows.push({ type, name, tblName, rootpage, sql }));
  return rows;
}

function columnsOf(sql) {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  return body.split(',').map(s => s.trim()).map(def => {
    const m = def.match(/^("([^"]+)"|\[([^\]]+)\]|(\S+))\s*(.*)$/s);
    const name = m[2] || m[3] || m[4];
    return { name: name.toLowerCase(), rowidAlias: /^integer\s+primary\s+key/i.test(m[5]) };
  });
}

const s = schema();
if (command === '.dbinfo') {
  console.log(`database page size: ${pageSize}`);
  console.log(`number of tables: ${s.filter(r => r.type === 'table').length}`);
} else if (command === '.tables') {
  console.log(s.filter(r => r.type === 'table' && !r.name.startsWith('sqlite_')).map(r => r.name).join(' '));
} else {
  const m = command.match(/^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(\w+)\s*=\s*'([^']*)')?\s*$/i);
  if (!m) { console.error('Unsupported query'); process.exit(1); }
  const [, colList, tableName, whereCol, whereVal] = m;
  const table = s.find(r => r.type === 'table' && r.name.toLowerCase() === tableName.toLowerCase());
  const cols = columnsOf(table.sql);
  const value = (row, rowid, name) => {
    const i = cols.findIndex(c => c.name === name.toLowerCase());
    return cols[i].rowidAlias ? rowid : row[i];
  };
  const out = [];
  if (/^count\(\*\)$/i.test(colList.trim())) {
    let n = 0;
    scanTable(table.rootpage, () => { n++; });
    out.push(String(n));
  } else {
    const wanted = colList.split(',').map(c => c.trim());
    const emit = (rowid, row) => out.push(wanted.map(c => { const v = value(row, rowid, c); return v === null ? '' : String(v); }).join('|'));
    const index = whereCol && s.find(r => r.type === 'index' && r.tblName.toLowerCase() === tableName.toLowerCase() && columnsOf(r.sql.replace(/^.*?\bon\s+\w+\s*/i, 'x'))[0]?.name === whereCol.toLowerCase());
    if (index) {
      for (const rowid of searchIndex(index.rootpage, whereVal, [])) emit(rowid, findRow(table.rootpage, rowid));
    } else {
      scanTable(table.rootpage, (rowid, row) => { if (!whereCol || String(value(row, rowid, whereCol)) === whereVal) emit(rowid, row); });
    }
  }
  if (out.length) console.log(out.join('\n'));
}
