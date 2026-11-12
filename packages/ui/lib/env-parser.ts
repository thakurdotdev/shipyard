/**
 * Parsing and printing of `.env` content, shared by every env editor.
 *
 * Accepts what people actually paste: dotenv files (comments, `export`, quotes,
 * escapes, multi-line values, inline comments, CRLF), `KEY: value` lines from
 * YAML/compose, and JSON objects from secret managers.
 */

export interface EnvEntry {
  key: string;
  value: string;
}

export interface EnvParseIssue {
  /** 1-based line where the problem starts. */
  line: number;
  message: string;
}

export interface EnvParseResult {
  /** In file order; for duplicate keys the last value wins and keeps the first position. */
  entries: EnvEntry[];
  /** Lines that could not be read and were skipped. */
  errors: EnvParseIssue[];
  /** Things that were read but deserve a look, e.g. a key defined twice. */
  warnings: EnvParseIssue[];
}

/** Keys the platform accepts: shell-safe names. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

/** Turns what someone typed into a usable key: trims, and swaps spaces and dashes in the middle for `_`. */
export function normalizeEnvKey(key: string): string {
  return key
    .trim()
    .replace(/^export\s+/, '')
    .replace(/\s+/g, '_');
}

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
  $: '$',
  '`': '`',
};

function unescapeDouble(value: string): string {
  return value.replace(/\\(.)/g, (match, ch: string) => DOUBLE_QUOTE_ESCAPES[ch] ?? match);
}

/** Index of the closing quote in `text` from `start`, honouring backslash escapes for `"`. */
function findClosingQuote(text: string, start: number, quote: string): number {
  for (let i = start; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return -1;
}

function tryParseJson(text: string): EnvParseResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const entries: EnvEntry[] = [];
  const errors: EnvParseIssue[] = [];
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    if (!isValidEnvKey(key)) {
      errors.push({ line: 1, message: `"${key}" is not a valid variable name` });
      continue;
    }
    const value =
      raw === null || raw === undefined
        ? ''
        : typeof raw === 'string'
          ? raw
          : typeof raw === 'object'
            ? JSON.stringify(raw)
            : String(raw);
    entries.push({ key, value });
  }
  return { entries, errors, warnings: [] };
}

export function parseEnv(input: string): EnvParseResult {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const json = tryParseJson(text);
  if (json) return json;

  const byKey = new Map<string, { value: string; line: number }>();
  const order: string[] = [];
  const errors: EnvParseIssue[] = [];
  const warnings: EnvParseIssue[] = [];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // KEY=value, export KEY=value, KEY = value, KEY: value (YAML / compose style)
    const match =
      line.match(/^(?:export\s+)?([^\s=:#]+)\s*(=|:\s)\s*(.*)$/) ??
      line.match(/^(?:export\s+)?([^\s=:#]+)\s*(=|:)()$/);
    if (!match) {
      errors.push({
        line: lineNo,
        message: line.includes('=')
          ? 'Could not read this line'
          : `Missing "=" after "${line.length > 40 ? `${line.slice(0, 40)}…` : line}"`,
      });
      continue;
    }

    const key = match[1];
    let rest = match[3];
    if (!isValidEnvKey(key)) {
      errors.push({
        line: lineNo,
        message: `"${key}" is not a valid name (use letters, digits and _; don't start with a digit)`,
      });
      continue;
    }

    let value: string;
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      // The value may continue over following lines until the closing quote.
      let body = rest.slice(1);
      let close = findClosingQuote(body, 0, quote);
      let j = i;
      while (close === -1 && j + 1 < lines.length) {
        j++;
        body += `\n${lines[j]}`;
        close = findClosingQuote(body, 0, quote);
      }
      if (close === -1) {
        errors.push({
          line: lineNo,
          message: `"${key}" has an opening ${quote} with no closing ${quote}`,
        });
        continue;
      }
      const raw = body.slice(0, close);
      const after = body.slice(close + 1).trim();
      if (after && !after.startsWith('#')) {
        warnings.push({
          line: lineNo,
          message: `Ignored text after the closing quote of "${key}"`,
        });
      }
      value = quote === '"' ? unescapeDouble(raw) : raw;
      i = j;
    } else {
      // Unquoted: an inline comment starts at " #".
      const hash = rest.search(/\s#/);
      if (hash !== -1) rest = rest.slice(0, hash);
      value = rest.trim();
    }

    if (byKey.has(key)) {
      warnings.push({
        line: lineNo,
        message: `"${key}" is also set on line ${byKey.get(key)!.line}; this later value is used`,
      });
    } else {
      order.push(key);
    }
    byKey.set(key, { value, line: lineNo });
  }

  return {
    entries: order.map((key) => ({ key, value: byKey.get(key)!.value })),
    errors,
    warnings,
  };
}

/** Quotes a value only when it would not survive unquoted. */
export function formatEnvValue(value: string): string {
  if (value === '') return '';
  const needsQuotes = /[\n\r\t"'`\\#]/.test(value) || /^\s|\s$/.test(value) || value.includes(' #');
  if (!needsQuotes) return value;
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Prints entries as a `.env` file that `parseEnv` reads back identically. */
export function stringifyEnv(entries: EnvEntry[]): string {
  return entries
    .filter((e) => e.key.trim())
    .map((e) => `${e.key.trim()}=${formatEnvValue(e.value)}`)
    .join('\n');
}

const ENV_LINE = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/;

/**
 * Whether pasted text should be split into variables rather than kept as-is.
 * A single line only counts when `singleLine` is allowed (pasting into a name
 * field): a value such as `abc==` pasted into a value field must stay a value.
 */
export function looksLikeEnvContent(text: string, { singleLine = false } = {}): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return tryParseJson(trimmed) !== null;
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length > 1) return lines.some((l) => ENV_LINE.test(l.trim()));
  return singleLine && ENV_LINE.test(trimmed);
}
