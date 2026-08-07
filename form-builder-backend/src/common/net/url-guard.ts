import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import ipaddr from 'ipaddr.js';

/**
 * SSRF protection for user-supplied outbound URLs (webhooks, integrations).
 *
 * THREAT: a customer registers `http://169.254.169.254/latest/meta-data/iam/...`
 * (cloud instance metadata) or `http://postgres:5432` as a webhook. The worker
 * fetches it from INSIDE the private network and — because delivery responses
 * were stored verbatim in WebhookDelivery.responseBody and readable through the
 * API — hands the caller a full read primitive against internal services.
 *
 * DEFENCE (layered, because any single layer is bypassable):
 *  1. Scheme allowlist: HTTPS only in production.
 *  2. Reject credentials in the URL and non-standard ports.
 *  3. Resolve DNS and reject any non-public address, re-checked at delivery
 *     time as well as at registration (defeats DNS rebinding, where a hostname
 *     resolves publicly when validated and privately when fetched).
 *  4. Callers must follow redirects manually and re-validate each hop.
 */

/** Hostnames that must never be reachable regardless of what they resolve to. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Ports commonly fronting internal services. */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 111, 135, 139, 445, 1433, 1521, 2049, 2375, 2376, 3306, 3389, 4444, 5432, 5433,
  5984, 6379, 6380, 7001, 8020, 8086, 9000, 9001, 9042, 9200, 9300, 11211, 27017, 27018,
]);

export interface ValidatedUrl {
  url: URL;
  /** The resolved public IP. Pass to the HTTP client to pin the connection. */
  address: string;
  family: 4 | 6;
}

export async function assertSafeOutboundUrl(
  raw: string,
  opts: { allowHttp?: boolean } = {},
): Promise<ValidatedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Webhook URL is not a valid URL.');
  }

  const allowHttp = opts.allowHttp ?? process.env.NODE_ENV !== 'production';

  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new BadRequestException('Webhook URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new BadRequestException('Webhook URL must not contain embedded credentials.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new BadRequestException('Webhook URL host is not allowed.');
  }

  // `.internal`, `.local`, and single-label hosts are internal by convention.
  if (hostname.endsWith('.internal') || hostname.endsWith('.local') || !hostname.includes('.')) {
    throw new BadRequestException('Webhook URL must point to a public hostname.');
  }

  if (url.port && BLOCKED_PORTS.has(Number(url.port))) {
    throw new BadRequestException(`Port ${url.port} is not allowed for webhooks.`);
  }

  // A literal IP in the URL still has to pass the range check below.
  const resolved = await resolveFirst(hostname);
  assertPublicAddress(resolved.address);

  return { url, address: resolved.address, family: resolved.family };
}

/** Throws unless the address is a globally-routable unicast address. */
export function assertPublicAddress(address: string): void {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    throw new BadRequestException('Webhook host resolved to an invalid address.');
  }

  // Several IPv6 ranges EMBED an IPv4 address. Judging them by their v6 range
  // alone is wrong in both directions: ::ffff:127.0.0.1 would pass as "unicast"
  // (loopback bypass), while on a DNS64/NAT64 network every legitimate public
  // host resolves into 64:ff9b::/96 and would be blocked. Unwrap to the
  // embedded IPv4 and judge that instead.
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;

    if (v6.isIPv4MappedAddress()) {
      parsed = v6.toIPv4Address();
    } else if (v6.range() === 'rfc6052') {
      // NAT64 well-known prefix: the last 32 bits are the real IPv4 target.
      const bytes = v6.toByteArray();
      parsed = new ipaddr.IPv4(bytes.slice(12, 16) as any);
    }
  }

  const range = parsed.range();
  if (range !== 'unicast') {
    throw new BadRequestException(
      `Webhook host resolves to a ${range} address, which is not permitted.`,
    );
  }
}

async function resolveFirst(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  // A bare IP literal needs no DNS lookup.
  if (ipaddr.isValid(hostname)) {
    return { address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 };
  }

  try {
    const result = await dns.lookup(hostname, { all: true });
    if (!result.length) throw new Error('empty');

    // EVERY address must be public — a hostname with both a public and a
    // private A record would otherwise be exploitable on retry.
    for (const entry of result) {
      assertPublicAddress(entry.address);
    }
    return { address: result[0].address, family: result[0].family as 4 | 6 };
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('Webhook host could not be resolved.');
  }
}
