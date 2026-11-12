import { describe, expect, it } from 'bun:test';
import { parseGoBuildCommand, tokenize } from './go';

describe('parseGoBuildCommand', () => {
  it('reads the default command', () => {
    expect(parseGoBuildCommand('go build -o app .')).toEqual({ output: 'app', package: '.' });
  });

  it('handles cmd/ layouts, inline flags and quoted ldflags', () => {
    expect(
      parseGoBuildCommand('go build -trimpath -ldflags="-s -w" -o=bin/server ./cmd/server'),
    ).toEqual({ output: 'bin/server', package: './cmd/server' });
    expect(parseGoBuildCommand("go build -tags netgo -ldflags '-s -w' ./cmd/api")).toEqual({
      output: undefined,
      package: './cmd/api',
    });
  });

  it('finds go build inside a chain', () => {
    expect(parseGoBuildCommand('go generate ./... && go build -o out/app ./cmd/web')).toEqual({
      output: 'out/app',
      package: './cmd/web',
    });
  });

  it('falls back to the current package', () => {
    expect(parseGoBuildCommand('go build')).toEqual({ output: undefined, package: '.' });
    expect(parseGoBuildCommand('bun run build')).toEqual({ package: '.' });
  });
});

describe('tokenize', () => {
  it('keeps quoted segments together', () => {
    expect(tokenize(`a "b c" 'd e' f=""`)).toEqual(['a', 'b c', 'd e', 'f=']);
  });
});
