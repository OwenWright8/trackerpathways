import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isDevelopment = process.env.NODE_ENV !== "production";

const createNonce = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
};

function buildCsp(nonce: string | undefined, isHttps: boolean) {
  const scriptSrc = isDevelopment
    ? `'self' 'unsafe-eval' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}'`;
  const styleSrc = isDevelopment
    ? `'self' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only force HTTPS sub-requests when the page itself came over HTTPS;
    // otherwise a plain-HTTP LAN install (http://192.168.x.x:3000) breaks.
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const isHttpsRequest = (request: NextRequest) => {
  if (request.nextUrl.protocol === "https:") return true;
  if (process.env.TRUSTED_PROXY_HEADERS === "true") {
    return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  }
  return false;
};

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const isHttps = isHttpsRequest(request);
  const csp = buildCsp(nonce, isHttps);
  const requestHeaders = new Headers(request.headers);

  if (nonce) {
    requestHeaders.set("x-nonce", nonce);
  }
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", csp);
  if (isHttps) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
