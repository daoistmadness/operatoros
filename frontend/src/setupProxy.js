const { createProxyMiddleware } = require('http-proxy-middleware');
const { stripLeadingApiPrefix } = require('./lib/api/routing');

const DEV_API_PROXY_TARGET = process.env.DEV_API_PROXY_TARGET || 'http://localhost:8000';

module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: DEV_API_PROXY_TARGET,
      changeOrigin: true,
      xfwd: true,
      pathRewrite: (path) => stripLeadingApiPrefix(path),
    })
  );
};
