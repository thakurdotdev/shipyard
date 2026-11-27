import { describe, expect, it } from 'bun:test';
import {
  classifyHostRecords,
  domainAliases,
  domainForSite,
  isCustomDomain,
  normalizeDomainInput,
  parseAliasRecords,
  projectHosts,
  provisionMatches,
  siteNameFor,
} from './domain-names';

const BASE = 'example.com';

describe('normalizeDomainInput', () => {
  it('turns a label into a subdomain of the base domain', () => {
    expect(normalizeDomainInput('Portfolio', BASE)).toBe('portfolio.example.com');
  });

  it('accepts custom domains in the forms people paste', () => {
    for (const input of ['example.com', 'https://Example.com/', 'example.com.', ' EXAMPLE.COM ']) {
      expect(normalizeDomainInput(input, BASE)).toBe('example.com');
    }
    expect(normalizeDomainInput('shop.example.co.uk', BASE)).toBe('shop.example.co.uk');
  });

  it('rejects junk, reserved names, www and ports', () => {
    for (const bad of [
      '',
      'a_b',
      'deploy',
      'www',
      'www.example.com',
      'example.com:8080',
      'x..com',
    ]) {
      expect(() => normalizeDomainInput(bad, BASE)).toThrow();
    }
    expect(() => normalizeDomainInput('api.example.com', BASE)).toThrow('reserved');
  });
});

describe('site names', () => {
  it('keeps label names for subdomains and full names for custom domains', () => {
    expect(siteNameFor('portfolio.example.com', BASE)).toBe('portfolio');
    expect(siteNameFor('example.com', BASE)).toBe('example.com');
    expect(siteNameFor('a.b.example.com', BASE)).toBe('a.b.example.com');
    expect(siteNameFor('example.com', BASE)).toBe('example.com');
    expect(isCustomDomain('portfolio.example.com', BASE)).toBe(false);
    expect(isCustomDomain('example.com', BASE)).toBe(true);
  });

  it('only custom domains get a www redirect', () => {
    expect(domainAliases({ domain: 'example.com', www_redirect: true }, BASE)).toEqual([
      'www.example.com',
    ]);
    expect(domainAliases({ domain: 'example.com', www_redirect: false }, BASE)).toEqual([]);
    expect(domainAliases({ domain: 'app.example.com', www_redirect: true }, BASE)).toEqual([]);
    expect(projectHosts({ domain: null })).toEqual([]);
  });

  it('maps engine site names back to hostnames', () => {
    expect(domainForSite('example.com')).toBe('example.com');
  });
});

describe('classifyHostRecords', () => {
  const ip = '203.0.113.10';
  const rec = (type: string, content: string, proxied = false) => ({
    id: `${type}-${content}`,
    type,
    content,
    proxied,
  });

  it('reuses records that already point here, proxied or not', () => {
    expect(classifyHostRecords([rec('A', ip, true), rec('MX', 'mx.example.net')], ip)).toEqual({
      state: 'ours',
      recordId: `A-${ip}`,
      proxied: true,
      via: 'A',
    });
  });

  it('ignores mail and text records when the name has no address yet', () => {
    expect(classifyHostRecords([rec('MX', 'mx.example.net'), rec('TXT', 'v=spf1')], ip)).toEqual({
      state: 'missing',
    });
  });

  it('never takes over a name that points elsewhere', () => {
    expect(classifyHostRecords([rec('A', '1.2.3.4')], ip).state).toBe('elsewhere');
    expect(classifyHostRecords([rec('A', ip), rec('AAAA', '2001:db8::1')], ip).state).toBe(
      'elsewhere',
    );
    expect(classifyHostRecords([rec('CNAME', 'other.host')], ip, 'example.com').state).toBe(
      'elsewhere',
    );
  });

  it('accepts www as a CNAME to the domain itself', () => {
    expect(classifyHostRecords([rec('CNAME', 'example.com.')], ip, 'example.com').state).toBe(
      'ours',
    );
  });
});

describe('provisionMatches', () => {
  const row = (full_domain: string, aliases: string[]) => ({
    full_domain,
    alias_records: JSON.stringify(
      aliases.map((name) => ({ name, id: null, zoneId: null, owned: false })),
    ),
  });

  it('matches only the same domain and the same www setting', () => {
    expect(
      provisionMatches(row('example.com', ['www.example.com']), 'example.com', ['www.example.com']),
    ).toBe(true);
    expect(provisionMatches(row('example.com', []), 'example.com', ['www.example.com'])).toBe(
      false,
    );
    expect(provisionMatches(row('portfolio.example.com', []), 'example.com', [])).toBe(false);
    expect(
      provisionMatches({ full_domain: 'a.example.com', alias_records: null }, 'a.example.com', []),
    ).toBe(true);
  });

  it('tolerates unreadable alias data', () => {
    expect(parseAliasRecords('not json')).toEqual([]);
  });
});
