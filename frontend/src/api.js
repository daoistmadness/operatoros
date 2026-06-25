import { API_BASE_URL, apiRequest } from './lib/api/client';

function normalizeConfig(config = {}) {
  return {
    params: config.params,
    headers: config.headers,
    timeout: config.timeout,
    responseType: config.responseType === 'blob' ? 'blob' : 'json',
  };
}

const api = {
  defaults: {
    baseURL: API_BASE_URL,
  },
  get(path, config = {}) {
    const normalized = normalizeConfig(config);
    return apiRequest({ path, method: 'GET', ...normalized });
  },
  post(path, data, config = {}) {
    const normalized = normalizeConfig(config);
    return apiRequest({ path, method: 'POST', body: data, ...normalized });
  },
  put(path, data, config = {}) {
    const normalized = normalizeConfig(config);
    return apiRequest({ path, method: 'PUT', body: data, ...normalized });
  },
  patch(path, data, config = {}) {
    const normalized = normalizeConfig(config);
    return apiRequest({ path, method: 'PATCH', body: data, ...normalized });
  },
  delete(path, config = {}) {
    const normalized = normalizeConfig(config);
    return apiRequest({ path, method: 'DELETE', body: config.data, ...normalized });
  },
};

export default api;
