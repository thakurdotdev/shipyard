import { describe, expect, it } from 'bun:test';
import { looksLikeEnvContent, parseEnv, stringifyEnv } from './env-parser';

const entries = (text: string) => parseEnv(text).entries;

describe('parseEnv', () => {
  it('reads plain, exported, spaced and empty assignments', () => {
    expect(entries('A=1\nexport B=two\nC = three\nD=\n')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: 'two' },
      { key: 'C', value: 'three' },
      { key: 'D', value: '' },
    ]);
  });

  it('keeps = inside values such as URLs and base64', () => {
    expect(entries('DATABASE_URL=postgres://u:p@h/db?sslmode=require\nKEY=abc==')).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://u:p@h/db?sslmode=require' },
      { key: 'KEY', value: 'abc==' },
    ]);
  });

  it('handles comments, inline comments, CRLF and a BOM', () => {
    expect(
      entries(
        '\uFEFF# header\r\nA=1 # one\r\nB=x#not-a-comment\r\n  # indented\r\nC="quoted # kept"',
      ),
    ).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: 'x#not-a-comment' },
      { key: 'C', value: 'quoted # kept' },
    ]);
  });

  it('unescapes double quotes but keeps single quotes literal', () => {
    expect(entries(`A="line1\\nline2 \\"q\\""\nB='raw\\n $HOME'`)).toEqual([
      { key: 'A', value: 'line1\nline2 "q"' },
      { key: 'B', value: 'raw\\n $HOME' },
    ]);
  });

  it('reads multi-line quoted values such as private keys', () => {
    const pem = '-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----';
    expect(entries(`PRIVATE_KEY="${pem}"\nNEXT=1`)).toEqual([
      { key: 'PRIVATE_KEY', value: pem },
      { key: 'NEXT', value: '1' },
    ]);
  });

  it('accepts YAML / compose style KEY: value lines', () => {
    expect(entries('NODE_ENV: production\nPORT: "3000"')).toEqual([
      { key: 'NODE_ENV', value: 'production' },
      { key: 'PORT', value: '3000' },
    ]);
  });

  it('reads JSON objects from secret managers', () => {
    expect(entries('{ "A": "1", "B": 2, "C": true, "D": null, "E": {"x":1} }')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
      { key: 'C', value: 'true' },
      { key: 'D', value: '' },
      { key: 'E', value: '{"x":1}' },
    ]);
  });

  it('reports bad lines with their line numbers and keeps going', () => {
    const r = parseEnv('GOOD=1\njust some words\n1BAD=x\nOPEN="never closed\nLAST=ok');
    expect(r.entries.map((e) => e.key)).toEqual(['GOOD', 'LAST']);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.errors[1].message).toContain('"1BAD" is not a valid name');
    expect(r.errors[2].message).toContain('no closing');
  });

  it('warns about duplicates and keeps the last value in the first position', () => {
    const r = parseEnv('A=1\nB=2\nA=3');
    expect(r.entries).toEqual([
      { key: 'A', value: '3' },
      { key: 'B', value: '2' },
    ]);
    expect(r.warnings[0]).toEqual({
      line: 3,
      message: '"A" is also set on line 1; this later value is used',
    });
  });
});

describe('stringifyEnv', () => {
  it('round-trips awkward values', () => {
    const original = [
      { key: 'PLAIN', value: 'abc' },
      { key: 'URL', value: 'https://x.dev/?a=1&b=2' },
      { key: 'SPACES', value: '  padded  ' },
      { key: 'HASH', value: 'a #b' },
      { key: 'QUOTES', value: `it's "quoted"` },
      { key: 'MULTI', value: 'one\ntwo\n\tthree' },
      { key: 'BACKSLASH', value: 'C:\\path\\n' },
      { key: 'EMPTY', value: '' },
    ];
    const text = stringifyEnv(original);
    expect(text.split('\n')[0]).toBe('PLAIN=abc');
    expect(parseEnv(text)).toEqual({ entries: original, errors: [], warnings: [] });
  });
});

describe('looksLikeEnvContent', () => {
  it('splits multi-line pastes and JSON, but not single values unless allowed', () => {
    expect(looksLikeEnvContent('A=1\nB=2')).toBe(true);
    expect(looksLikeEnvContent('{"A":"1"}')).toBe(true);
    expect(looksLikeEnvContent('abc==')).toBe(false);
    expect(looksLikeEnvContent('A=1')).toBe(false);
    expect(looksLikeEnvContent('A=1', { singleLine: true })).toBe(true);
    expect(looksLikeEnvContent('hello world\nsecond line')).toBe(false);
  });
});
