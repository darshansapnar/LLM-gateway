// Lightweight cookie-parsing middleware for Express.
// Parses the "Cookie" request header into req.cookies object.
export function cookieParser(req, res, next) {
  const cookieHeader = req.headers.cookie;
  req.cookies = {};

  if (cookieHeader) {
    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
      const idx = pair.indexOf("=");
      if (idx !== -1) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(val);
        } catch {
          req.cookies[key] = val;
        }
      }
    }
  }

  next();
}
