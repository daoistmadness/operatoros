export function stripLeadingApiPrefix(pathname) {
  if (!pathname) {
    return '/';
  }

  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;

  if (normalizedPath === '/api') {
    return '/';
  }

  if (normalizedPath.startsWith('/api/')) {
    return normalizedPath.slice(4) || '/';
  }

  return normalizedPath;
}
