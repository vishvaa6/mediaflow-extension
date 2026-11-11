// These responses commonly reject an expired/signed media URL. A refreshed
// page can provide a new URL, but the cached media must still be validated.
export const needsSourceRefresh = error => error?.code === 'INVALID_MEDIA_RESPONSE' || [401,403,404,410,472,474].includes(error?.status);

// A temporary missing source after a 474 is still retryable. Do not mask a
// different HTTP error or a safety error such as a changed playlist.
export function retain474OnMissingSource(original,refreshError) {
  if(original?.status===474 && !refreshError?.code && refreshError?.status==null && /no supported video stream found|original video quality\/format is unavailable|original hls format is unavailable|media link was rejected after refresh/i.test(refreshError?.message || '')){
    return Object.assign(refreshError,{status:474,code:'HTTP'});
  }
  return refreshError;
}

export function httpError(status, resource = 'video') {
  const error = Error(`HTTP ${status}: unable to fetch ${resource}`);
  error.status = status;
  return error;
}
