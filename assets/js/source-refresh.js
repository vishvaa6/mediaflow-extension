// These responses commonly reject an expired/signed media URL. A refreshed
// page can provide a new URL, but the cached media must still be validated.
export const needsSourceRefresh = error => [401,403,404,410,472].includes(error?.status);

export function httpError(status, resource = 'video') {
  const error = Error(`HTTP ${status}: unable to fetch ${resource}`);
  error.status = status;
  return error;
}
