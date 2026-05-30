export function isDesktopUserAgent(userAgent = '') {
  return /\bElectron\//.test(String(userAgent)) || /\bLariatDesktop\//.test(String(userAgent));
}

export function isLoopbackHost(hostname = '') {
  const host = String(hostname).toLowerCase();
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * @param {{ protocol?: string, hostname?: string, port?: string }} locationLike
 */
export function lanInstallUrl(locationLike) {
  const protocol = locationLike?.protocol === 'https:' ? 'https:' : 'http:';
  const port = locationLike?.port || '3001';
  const hostname = isLoopbackHost(locationLike?.hostname)
    ? 'lariat.local'
    : locationLike?.hostname || 'lariat.local';
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}
