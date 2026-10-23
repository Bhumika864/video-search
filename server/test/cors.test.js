const test = require('node:test');
const assert = require('node:assert/strict');
const createCorsMiddleware = require('../middleware/cors');

function runMiddleware(middleware, { origin, method = 'GET' }) {
  const headers = {};
  let statusCode;
  let ended = false;
  let nextCalled = false;
  const req = { get: () => origin, method };
  const res = {
    vary: (value) => { headers.Vary = value; },
    set: (name, value) => { headers[name] = value; },
    status: (value) => {
      statusCode = value;
      return res;
    },
    end: () => { ended = true; },
  };

  middleware(req, res, () => { nextCalled = true; });
  return { headers, statusCode, ended, nextCalled };
}

test('CORS allows configured origins and answers preflight requests', () => {
  const middleware = createCorsMiddleware(['https://video-search.vercel.app']);
  const result = runMiddleware(middleware, {
    origin: 'https://video-search.vercel.app',
    method: 'OPTIONS',
  });

  assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://video-search.vercel.app');
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'GET, POST, DELETE, OPTIONS');
  assert.equal(result.headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type');
  assert.equal(result.headers.Vary, 'Origin');
  assert.equal(result.statusCode, 204);
  assert.equal(result.ended, true);
  assert.equal(result.nextCalled, false);
});

test('CORS does not grant access to unconfigured origins', () => {
  const middleware = createCorsMiddleware(['https://video-search.vercel.app']);
  const result = runMiddleware(middleware, { origin: 'https://untrusted.example' });

  assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(result.headers.Vary, 'Origin');
  assert.equal(result.nextCalled, true);
});
