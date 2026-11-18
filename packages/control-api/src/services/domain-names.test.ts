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

const BASE = 'thakur.dev';

describe('normalizeDomainInput', () => {
  it('turns a label into a subdomain of the base domain', () => {
    expect(normalizeDomainInput('Portfolio', BASE)).toBe('portfolio.thakur.dev');
  });

  it('accepts custom domains in the forms people paste', () => {
    for (const input of ['thakur.dev', 'https://Thakur.dev/', 'thakur.dev.', ' THAKUR.DEV ']) {
      expect(normalizeDomainInput(input, BASE)).toBe('thakur.dev');
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
    expect(() => normalizeDomainInput('api.thakur.dev', BASE)).toThrow('reserved');
  });
});

describe('site names', () => {
  it('keeps label names for subdomains and full names for custom domains', () => {
    expect(siteNameFor('portfolio.thakur.dev', BASE)).toBe('portfolio');
    expect(siteNameFor('thakur.dev', BASE)).toBe('thakur.dev');
    expect(siteNameFor('a.b.thakur.dev', BASE)).toBe('a.b.thakur.dev');
    expect(siteNameFor('example.com', BASE)).toBe('example.com');
    expect(isCustomDomain('portfolio.thakur.dev', BASE)).toBe(false);
    expect(isCustomDomain('thakur.dev', BASE)).toBe(true);
  });

  it('only custom domains get a www redirect', () => {
    expect(domainAliases({ domain: 'thakur.dev', www_redirect: true }, BASE)).toEqual([
      'www.thakur.dev',
    ]);
    expect(domainAliases({ domain: 'thakur.dev', www_redirect: false }, BASE)).toEqual([]);
    expect(domainAliases({ domain: 'app.thakur.dev', www_redirect: true }, BASE)).toEqual([]);
    expect(projectHosts({ domain: null })).toEqual([]);
  });

  it('maps engine site names back to hostnames', () => {
    expect(domainForSite('thakur.dev')).toBe('thakur.dev');
  });
});

describe('classifyHostRecords', () => {
  const ip = '140.245.15.112';
  const rec = (type: string, content: string, proxied = false) => ({
    id: `${type}-${content}`,
    type,
    content,
    proxied,
  });

  it('reuses records that already point here, proxied or not', () => {
    expect(classifyHostRecords([rec('A', ip, true), rec('MX', 'mx.zoho.in')], ip)).toEqual({
      state: 'ours',
      recordId: `A-${ip}`,
      proxied: true,
      via: 'A',
    });
  });

  it('ignores mail and text records when the name has no address yet', () => {
    expect(classifyHostRecords([rec('MX', 'mx.zoho.in'), rec('TXT', 'v=spf1')], ip)).toEqual({
      state: 'missing',
    });
  });

  it('never takes over a name that points elsewhere', () => {
    expect(classifyHostRecords([rec('A', '1.2.3.4')], ip).state).toBe('elsewhere');
    expect(classifyHostRecords([rec('A', ip), rec('AAAA', '2001:db8::1')], ip).state).toBe(
      'elsewhere',
    );
    expect(classifyHostRecords([rec('CNAME', 'other.host')], ip, 'thakur.dev').state).toBe(
      'elsewhere',
    );
  });

  it('accepts www as a CNAME to the domain itself', () => {
    expect(classifyHostRecords([rec('CNAME', 'thakur.dev.')], ip, 'thakur.dev').state).toBe('ours');
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
      provisionMatches(row('thakur.dev', ['www.thakur.dev']), 'thakur.dev', ['www.thakur.dev']),
    ).toBe(true);
    expect(provisionMatches(row('thakur.dev', []), 'thakur.dev', ['www.thakur.dev'])).toBe(false);
    expect(provisionMatches(row('portfolio.thakur.dev', []), 'thakur.dev', [])).toBe(false);
    expect(
      provisionMatches({ full_domain: 'a.thakur.dev', alias_records: null }, 'a.thakur.dev', []),
    ).toBe(true);
  });

  it('tolerates unreadable alias data', () => {
    expect(parseAliasRecords('not json')).toEqual([]);
  });
});
