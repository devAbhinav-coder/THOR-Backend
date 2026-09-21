import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const SLUG = __ENV.PDP_SLUG || "sample-product";

export const options = {
  vus: Number(__ENV.VUS || 500),
  duration: __ENV.DURATION || "2m",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

/** Fail fast if API is not listening (avoids 90% "connection refused" noise). */
export function setup() {
  const res = http.get(`${BASE_URL}/api/health/live`);
  check(res, {
    "api live before load test": (r) => r.status === 200,
  });
  if (res.status !== 200) {
    throw new Error(
      `API not up at ${BASE_URL} - start npm run dev in another terminal first`,
    );
  }
}

export default function () {
  const res = http.get(`${BASE_URL}/api/products/${SLUG}`);
  check(res, {
    "status 200": (r) => r.status === 200,
    "not rate limited (429)": (r) => r.status !== 429,
  });
  sleep(0.2);
}
