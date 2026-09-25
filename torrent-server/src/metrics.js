// Count connected TCP/uTP addresses across all active torrents. IPs are a
// peer approximation, not individual people, and unidentified wires are
// intentionally omitted rather than counted as unique people.
export function distinctPeerAddresses(torrents) {
  const addresses = new Set();
  for (const torrent of torrents) {
    for (const wire of torrent.wires) {
      if (wire.remoteAddress) addresses.add(wire.remoteAddress);
    }
  }
  return addresses.size;
}
