import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN;

export const options = {
  vus: Number(__ENV.VUS || 100),
  duration: __ENV.DURATION || "3m",
};

export default function () {
  if (!AUTH_TOKEN) {
    throw new Error("Set AUTH_TOKEN (Bearer access JWT)");
  }
  const res = http.get(`${BASE_URL}/api/cart`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
