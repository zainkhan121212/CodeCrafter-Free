// A small terminal screen model: enough of VT100/xterm to follow what a line editor (GNU readline,
// Node's readline, rustyline, …) draws — cursor movement, line erasing, carriage returns and the bell.
export class Screen {
  constructor(width = 200) {
    this.width = width;
    this.lines = [''];
    this.row = 0;
    this.col = 0;
    this.bells = 0;
    this.pending = '';
  }

  get line() { return this.lines[this.row]; }
  set line(v) { this.lines[this.row] = v; }

  putChar(ch) {
    if (this.col >= this.width) { this.newline(); }
    const l = this.line.padEnd(this.col, ' ');
    this.line = l.slice(0, this.col) + ch + l.slice(this.col + 1);
    this.col++;
  }

  newline() {
    this.row++;
    if (this.row >= this.lines.length) this.lines.push('');
    this.col = 0;
  }

  write(text) {
    const s = this.pending + text;
    this.pending = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\x1b') {
        const rest = s.slice(i);
        const m = /^\x1b\[([?>=]?)([0-9;]*)([A-Za-z@`])/.exec(rest) || /^\x1b\][^\x07]*(\x07|\x1b\\)/.exec(rest) || /^\x1b[()][0-9A-Za-z]/.exec(rest) || /^\x1b[=>78DEM]/.exec(rest);
        if (!m) {
          if (rest.length < 16) { this.pending = rest; return; } // incomplete escape sequence; wait for more
          continue;
        }
        if (m[3]) this.csi(m[1], m[2], m[3]);
        i += m[0].length - 1;
        continue;
      }
      if (ch === '\r') this.col = 0;
      else if (ch === '\n') this.newline();
      else if (ch === '\b') this.col = Math.max(0, this.col - 1);
      else if (ch === '\x07') this.bells++;
      else if (ch === '\t') this.col = Math.min(this.width - 1, (Math.floor(this.col / 8) + 1) * 8);
      else if (ch >= ' ' || ch > '\x7f') this.putChar(ch);
    }
  }

  csi(priv, params, final) {
    if (priv) return; // private modes (bracketed paste, cursor visibility, …)
    const nums = params.split(';').map(n => (n === '' ? NaN : Number(n)));
    const n = Number.isNaN(nums[0]) ? 1 : nums[0];
    switch (final) {
      case 'A': this.row = Math.max(0, this.row - n); break;
      case 'B': this.row += n; while (this.lines.length <= this.row) this.lines.push(''); break;
      case 'C': this.col += n; break;
      case 'D': this.col = Math.max(0, this.col - n); break;
      case 'G': this.col = Math.max(0, n - 1); break;
      case 'K': {
        const mode = Number.isNaN(nums[0]) ? 0 : nums[0];
        if (mode === 0) this.line = this.line.slice(0, this.col);
        else if (mode === 1) this.line = ' '.repeat(this.col) + this.line.slice(this.col);
        else this.line = '';
        break;
      }
      case 'J': {
        const mode = Number.isNaN(nums[0]) ? 0 : nums[0];
        if (mode === 0) { this.line = this.line.slice(0, this.col); this.lines.length = this.row + 1; }
        else if (mode === 2 || mode === 3) { this.lines = ['']; this.row = 0; this.col = 0; }
        break;
      }
      case 'P': this.line = this.line.slice(0, this.col) + this.line.slice(this.col + n); break;
      case '@': this.line = this.line.slice(0, this.col) + ' '.repeat(n) + this.line.slice(this.col); break;
      case 'X': this.line = (this.line.slice(0, this.col) + ' '.repeat(n) + this.line.slice(this.col + n)); break;
      case 'H': case 'f': {
        // Absolute positioning is rare in line editors; treat it relative to the visible "page" start.
        this.row = Math.max(0, (Number.isNaN(nums[0]) ? 1 : nums[0]) - 1);
        this.col = Math.max(0, (Number.isNaN(nums[1]) ? 1 : nums[1]) - 1);
        while (this.lines.length <= this.row) this.lines.push('');
        break;
      }
      default: break; // SGR colors (m) and others are ignored
    }
  }

  // Text of every line with trailing whitespace removed.
  text() { return this.lines.map(l => l.trimEnd()); }
  // The current line up to the cursor (keeps a trailing space typed or completed by the user).
  get beforeCursor() { return this.line.padEnd(this.col, ' ').slice(0, this.col); }
}
