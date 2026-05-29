import { describe, expect, it } from 'vitest';

import {
  areNameserversValid,
  isCidr,
  isHostnameLabel,
  isIpv4,
  isIpv6,
  isPlainIp,
  splitNameservers,
} from './validation';

describe('isHostnameLabel', () => {
  it('accepts a plain label and a hyphenated one', () => {
    expect(isHostnameLabel('glaon')).toBe(true);
    expect(isHostnameLabel('glaon-wall')).toBe(true);
    expect(isHostnameLabel('a')).toBe(true);
    expect(isHostnameLabel('a'.repeat(63))).toBe(true);
  });

  it('rejects leading/trailing hyphen, bad chars, and over-length', () => {
    expect(isHostnameLabel('-glaon')).toBe(false);
    expect(isHostnameLabel('glaon-')).toBe(false);
    expect(isHostnameLabel('glaon_wall')).toBe(false);
    expect(isHostnameLabel('glaon wall')).toBe(false);
    expect(isHostnameLabel('a'.repeat(64))).toBe(false);
    expect(isHostnameLabel('')).toBe(false);
  });
});

describe('isIpv4', () => {
  it('accepts well-formed addresses', () => {
    expect(isIpv4('192.168.1.50')).toBe(true);
    expect(isIpv4('0.0.0.0')).toBe(true);
    expect(isIpv4('255.255.255.255')).toBe(true);
  });

  it('rejects out-of-range octets, wrong arity, and leading zeros', () => {
    expect(isIpv4('256.1.1.1')).toBe(false);
    expect(isIpv4('192.168.1')).toBe(false);
    expect(isIpv4('192.168.1.1.1')).toBe(false);
    expect(isIpv4('192.168.01.1')).toBe(false);
    expect(isIpv4('192.168.1.x')).toBe(false);
    expect(isIpv4('')).toBe(false);
  });
});

describe('isIpv6', () => {
  it('accepts full, compressed, and all-zero forms', () => {
    expect(isIpv6('2001:db8:85a3:0:0:8a2e:370:7334')).toBe(true);
    expect(isIpv6('fd00::1')).toBe(true);
    expect(isIpv6('::')).toBe(true);
    expect(isIpv6('::1')).toBe(true);
    expect(isIpv6('fe80::5c7d:aeff:fec1:7ff8')).toBe(true);
  });

  it('rejects double compression, bad groups, and wrong length', () => {
    expect(isIpv6('2001::db8::1')).toBe(false);
    expect(isIpv6('gggg::1')).toBe(false);
    expect(isIpv6('2001:db8:85a3:0:0:8a2e:370')).toBe(false);
    expect(isIpv6('12345::1')).toBe(false);
    expect(isIpv6('')).toBe(false);
  });
});

describe('isPlainIp', () => {
  it('dispatches on family', () => {
    expect(isPlainIp('10.0.0.1', 'ipv4')).toBe(true);
    expect(isPlainIp('fd00::1', 'ipv4')).toBe(false);
    expect(isPlainIp('fd00::1', 'ipv6')).toBe(true);
    expect(isPlainIp('10.0.0.1', 'ipv6')).toBe(false);
  });
});

describe('isCidr', () => {
  it('accepts addresses with and without a valid prefix', () => {
    expect(isCidr('192.168.1.50/24', 'ipv4')).toBe(true);
    expect(isCidr('192.168.1.50', 'ipv4')).toBe(true);
    expect(isCidr('fd00::1/64', 'ipv6')).toBe(true);
    expect(isCidr('fd00::1', 'ipv6')).toBe(true);
  });

  it('rejects out-of-range or malformed prefixes', () => {
    expect(isCidr('192.168.1.50/33', 'ipv4')).toBe(false);
    expect(isCidr('fd00::1/129', 'ipv6')).toBe(false);
    expect(isCidr('192.168.1.50/', 'ipv4')).toBe(false);
    expect(isCidr('192.168.1.50/aa', 'ipv4')).toBe(false);
    expect(isCidr('not-an-ip/24', 'ipv4')).toBe(false);
  });
});

describe('splitNameservers', () => {
  it('splits on commas and whitespace, trimming empties', () => {
    expect(splitNameservers('1.1.1.1, 8.8.8.8')).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(splitNameservers('1.1.1.1   8.8.8.8')).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(splitNameservers('  ')).toEqual([]);
    expect(splitNameservers('')).toEqual([]);
  });
});

describe('areNameserversValid', () => {
  it('accepts a list of valid addresses and an empty field', () => {
    expect(areNameserversValid('1.1.1.1, 8.8.8.8', 'ipv4')).toBe(true);
    expect(areNameserversValid('', 'ipv4')).toBe(true);
    expect(areNameserversValid('fd00::1 2606:4700:4700::1111', 'ipv6')).toBe(true);
  });

  it('rejects when any entry is invalid for the family', () => {
    expect(areNameserversValid('1.1.1.1, nope', 'ipv4')).toBe(false);
    expect(areNameserversValid('1.1.1.1', 'ipv6')).toBe(false);
  });
});
