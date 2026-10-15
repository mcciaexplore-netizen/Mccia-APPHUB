import net from "node:net";

/**
 * Whether an address is on the public internet. The application check fetches addresses an administrator typed in, so it must never be
 * steered at this server's own network (loopback, private ranges, cloud metadata at 169.254.169.254, and so on). Pure, so it is tested directly.
 */
export function isPublicAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 4) return publicV4(address);
  if (kind === 6) return publicV6(address.toLowerCase());
  return false;
}

function publicV4(a: string): boolean {
  const [p, q] = a.split(".").map(Number);
  if (p === 0 || p === 10 || p === 127) return false;
  if (p === 100 && q >= 64 && q <= 127) return false; // carrier-grade NAT
  if (p === 169 && q === 254) return false; // link-local, including cloud metadata
  if (p === 172 && q >= 16 && q <= 31) return false;
  if (p === 192 && q === 168) return false;
  if (p === 192 && q === 0 && a.startsWith("192.0.0.")) return false;
  if (p === 198 && (q === 18 || q === 19)) return false;
  if (p >= 224) return false; // multicast and reserved
  return true;
}

function publicV6(a: string): boolean {
  if (a === "::" || a === "::1") return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a) ?? /^0:0:0:0:0:ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return publicV4(mapped[1]);
  if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(a)) return false; // an IPv4 address written in hex: not worth decoding, refuse
  if (/^f[cd]/.test(a)) return false; // unique local fc00::/7
  if (/^fe[89ab]/.test(a)) return false; // link-local fe80::/10
  if (a.startsWith("ff")) return false; // multicast
  if (a.startsWith("64:ff9b:")) return false; // NAT64
  if (a.startsWith("2001:db8")) return false; // documentation
  return true;
}
