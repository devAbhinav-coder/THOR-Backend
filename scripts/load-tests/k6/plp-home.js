import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";

export const options = {
  vus: Number(__ENV.VUS || 200),
  duration: __ENV.DURATION || "2m",
};

export default function () {
  const res = http.get(`${BASE_URL}/api/products?page=1&limit=24`);
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(0.3);
}
