import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicAddress } from './networkSecurity.ts';

test('rejects IPv4 private, loopback, link-local and special-use ranges', () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.10.20',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.2.10',
    '192.168.1.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.20',
    '203.0.113.8',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('accepts representative public IPv4 addresses', () => {
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '208.67.222.222']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test('rejects IPv6 local, mapped and documentation ranges', () => {
  for (const address of [
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:192.0.2.1',
    '2001:db8::1',
    '2001:0000::1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('accepts representative global IPv6 addresses', () => {
  for (const address of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test('rejects malformed and non-IP input', () => {
  for (const address of ['', 'localhost', '999.1.1.1', 'example.com']) {
    assert.equal(isPublicAddress(address), false, address);
  }
});
