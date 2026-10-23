function createCorsMiddleware(origins) {
  const allowedOrigins = new Set(origins);

  return (req, res, next) => {
    const origin = req.get('Origin');
    if (!origin) {
      next();
      return;
    }

    res.vary('Origin');
    if (!allowedOrigins.has(origin)) {
      next();
      return;
    }

    res.set('Access-Control-Allow-Origin', origin);

    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.status(204).end();
      return;
    }

    next();
  };
}

module.exports = createCorsMiddleware;
