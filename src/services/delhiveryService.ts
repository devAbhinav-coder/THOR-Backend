import {
  delhiveryBaseUrl,
  delhiveryIsConfigured,
  delhiveryToken,
} from "../config/delhivery";
import logger from "../utils/logger";

const AUTH_HEADER = () => ({
  Authorization: `Token ${delhiveryToken()!}`,
  Accept: "application/json",
});

export class DelhiveryApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "DelhiveryApiError";
  }
}

async function delhiveryFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = delhiveryBaseUrl();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  return fetch(url, init);
}

/** GET /c/api/pin-codes/json/?filter_codes= */
export async function checkPincodeServiceability(pin: string): Promise<{
  raw: unknown;
  serviceable: boolean;
  remark?: string;
}> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const clean = pin.replace(/\D/g, "").slice(0, 6);
  if (clean.length !== 6) {
    throw new DelhiveryApiError("Invalid 6-digit pincode", 400);
  }
  const q = new URLSearchParams({ filter_codes: clean });
  const res = await delhiveryFetch(`/c/api/pin-codes/json/?${q}`, {
    headers: AUTH_HEADER(),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(
      `Pin serviceability: non-JSON response`,
      res.status,
      text,
    );
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Pin serviceability failed: ${res.status}`,
      res.status,
      json,
    );
  }

  const rows = extractPinRows(json);
  if (rows.length === 0) {
    return { raw: json, serviceable: false, remark: "NSZ (empty list)" };
  }
  const row = rows[0] as Record<string, unknown>;
  const remark =
    typeof row.remark === "string" ? row.remark : String(row.remark ?? "");
  const embargo = remark.toLowerCase().includes("embargo");
  const serviceable = !embargo && remark.trim().length === 0;
  return { raw: json, serviceable, remark: remark || undefined };
}

function extractPinRows(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.delivery_codes)) return o.delivery_codes;
    if (Array.isArray(o.pin_codes)) return o.pin_codes;
  }
  return [];
}

/** GET /waybill/api/fetch/json/?token= */
export async function fetchSingleWaybill(): Promise<string> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const token = delhiveryToken()!;
  const q = new URLSearchParams({ token });
  const res = await delhiveryFetch(`/waybill/api/fetch/json/?${q}`, {
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(
      `Waybill fetch: non-JSON`,
      res.status,
      text,
    );
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Waybill fetch failed: ${res.status}`,
      res.status,
      json,
    );
  }
  const wb = extractWaybill(json);
  if (!wb) {
    throw new DelhiveryApiError("Waybill not present in response", 500, json);
  }
  return wb;
}

/** GET /waybill/api/bulk/json/?token=&count= */
export async function fetchBulkWaybills(count: number): Promise<string[]> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const n = Math.min(50, Math.max(1, Math.floor(count)));
  const q = new URLSearchParams({
    token: delhiveryToken()!,
    count: String(n),
  });
  const res = await delhiveryFetch(`/waybill/api/bulk/json/?${q}`, {
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(
      `Bulk waybill: non-JSON`,
      res.status,
      text,
    );
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Bulk waybill failed: ${res.status}`,
      res.status,
      json,
    );
  }
  const list = extractWaybillList(json);
  if (list.length === 0) {
    throw new DelhiveryApiError("No waybills in bulk response", 500, json);
  }
  return list;
}

function extractWaybill(json: unknown): string | null {
  if (typeof json === "string" && /^\d+$/.test(json.trim())) return json.trim();
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const candidates = [
      o.waybill,
      o.airway_bill_number,
      o.AWB,
      o.packages,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    if (Array.isArray(o.packages) && o.packages[0]) {
      const first = o.packages[0];
      if (typeof first === "string") return first.trim();
      if (first && typeof first === "object") {
        const p = first as Record<string, unknown>;
        if (typeof p.waybill === "string") return p.waybill.trim();
      }
    }
  }
  return null;
}

function extractWaybillList(json: unknown): string[] {
  if (Array.isArray(json)) {
    return json
      .map((x) => (typeof x === "string" ? x : extractWaybill(x)))
      .filter((x): x is string => Boolean(x));
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.waybills)) {
      return o.waybills.map(String).filter(Boolean);
    }
  }
  return extractWaybill(json) ? [extractWaybill(json)!] : [];
}

export type DelhiveryManifestShipment = Record<string, string | number | null>;

export async function createCmuShipment(body: {
  shipments: DelhiveryManifestShipment[];
  pickup_location: { name: string };
}): Promise<unknown> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const dataStr = JSON.stringify(body);
  const form = new URLSearchParams();
  form.set("format", "json");
  form.set("data", dataStr);

  const res = await delhiveryFetch("/api/cmu/create.json", {
    method: "POST",
    headers: {
      ...AUTH_HEADER(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(
      `Create shipment: non-JSON`,
      res.status,
      text,
    );
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Create shipment failed: ${res.status}`,
      res.status,
      json,
    );
  }
  return json;
}

/** GET /api/v1/packages/json/?waybill=&ref_ids= */
export async function trackPackages(params: {
  waybill?: string;
  refIds?: string;
}): Promise<unknown> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const q = new URLSearchParams();
  if (params.waybill) q.set("waybill", params.waybill);
  if (params.refIds) q.set("ref_ids", params.refIds);
  const res = await delhiveryFetch(`/api/v1/packages/json/?${q}`, {
    headers: {
      ...AUTH_HEADER(),
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(`Track: non-JSON`, res.status, text);
  }
  if (!res.ok) {
    throw new DelhiveryApiError(`Track failed: ${res.status}`, res.status, json);
  }
  return json;
}

function collectHttpsUrls(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 40) return;
  if (typeof node === "string") {
    const t = node.trim();
    if (/^https:\/\//i.test(t)) out.add(t);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectHttpsUrls(x, out, depth + 1);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) collectHttpsUrls(v, out, depth + 1);
  }
}

function tryDirectPdfKeys(o: Record<string, unknown>): string | null {
  const keys = [
    "packing_slip_url",
    "packing_slip",
    "label_url",
    "pdf_url",
    "pdf",
    "document_url",
    "url",
    "s3",
    "link",
    "label",
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (/^https:\/\//i.test(t)) return t;
    }
  }
  const pkgs = o.packages;
  if (Array.isArray(pkgs) && pkgs[0] && typeof pkgs[0] === "object") {
    const nested = tryDirectPdfKeys(pkgs[0] as Record<string, unknown>);
    if (nested) return nested;
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = tryDirectPdfKeys(data as Record<string, unknown>);
    if (nested) return nested;
  }
  return null;
}

/** Prefer PDF/S3 URLs; avoid picking tracking or marketing links first. */
function scorePdfUrlCandidate(u: string): number {
  const lower = u.toLowerCase();
  let s = 0;
  if (lower.includes(".pdf")) s += 120;
  if (lower.includes("amazonaws.com") || lower.includes("cloudfront.net")) s += 60;
  if (lower.includes("s3.")) s += 40;
  if (/(pack|slip|label|shipping|manifest|document)/i.test(u)) s += 25;
  if (lower.includes("/track") || lower.includes("tracking")) s -= 150;
  if (lower.includes("delhivery.com") && !lower.includes(".pdf") && !lower.includes("s3"))
    s -= 40;
  return s;
}

function pickPackingSlipPdfUrl(json: unknown): string | null {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const direct = tryDirectPdfKeys(json as Record<string, unknown>);
    if (direct && scorePdfUrlCandidate(direct) > -80) return direct;
  }
  const set = new Set<string>();
  collectHttpsUrls(json, set);
  const urls = [...set];
  if (urls.length === 0) return null;
  urls.sort((a, b) => scorePdfUrlCandidate(b) - scorePdfUrlCandidate(a));
  const best = urls[0];
  if (scorePdfUrlCandidate(best) < -50) return null;
  return best;
}

function findFirstHttpsUrl(node: unknown, depth = 0): string | null {
  if (depth > 30) return null;
  if (typeof node === "string") {
    const t = node.trim();
    if (/^https:\/\//i.test(t)) return t;
    return null;
  }
  if (Array.isArray(node)) {
    for (const x of node) {
      const u = findFirstHttpsUrl(x, depth + 1);
      if (u) return u;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) {
      const u = findFirstHttpsUrl(v, depth + 1);
      if (u) return u;
    }
  }
  return null;
}

/**
 * GET /api/p/packing_slip?wbns=&pdf=true&pdf_size=4R|A4
 * Returns JSON containing an S3 (or similar) HTTPS URL to the label PDF when pdf=true.
 */
export async function fetchPackingSlipPdfUrl(params: {
  waybill: string;
  pdfSize?: "A4" | "4R";
}): Promise<{ pdfUrl: string; raw: unknown }> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const wb = params.waybill.trim();
  if (wb.length < 6) {
    throw new DelhiveryApiError("Invalid waybill number.", 400);
  }
  const pdfSize = params.pdfSize === "A4" ? "A4" : "4R";
  const q = new URLSearchParams({
    wbns: wb,
    pdf: "true",
    pdf_size: pdfSize,
  });
  const res = await delhiveryFetch(`/api/p/packing_slip?${q}`, {
    headers: AUTH_HEADER(),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(
      `Packing slip: expected JSON`,
      res.status,
      text,
    );
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Packing slip failed: ${res.status}`,
      res.status,
      json,
    );
  }

  let pdfUrl = pickPackingSlipPdfUrl(json);
  if (!pdfUrl && json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const cand = o.pdf ?? o.url ?? o.link ?? o.s3;
    if (typeof cand === "string" && /^https:\/\//i.test(cand.trim())) {
      pdfUrl = cand.trim();
    }
  }
  if (!pdfUrl) {
    pdfUrl = findFirstHttpsUrl(json);
  }
  if (!pdfUrl) {
    throw new DelhiveryApiError(
      "Packing slip response did not contain a PDF URL.",
      502,
      json,
    );
  }
  return { pdfUrl, raw: json };
}

/**
 * GET /api/p/packing_slip?wbns=&pdf=false&pdf_size=4R|A4
 * Returns JSON fields for a customizable label (render client-side; Code 128, etc.).
 */
export async function fetchPackingSlipJson(params: {
  waybill: string;
  pdfSize?: "A4" | "4R";
}): Promise<unknown> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const wb = params.waybill.trim();
  if (wb.length < 6) {
    throw new DelhiveryApiError("Invalid waybill number.", 400);
  }
  const pdfSize = params.pdfSize === "A4" ? "A4" : "4R";
  const q = new URLSearchParams({
    wbns: wb,
    pdf: "false",
    pdf_size: pdfSize,
  });
  const res = await delhiveryFetch(`/api/p/packing_slip?${q}`, {
    headers: AUTH_HEADER(),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(
      `Packing slip (json): expected JSON`,
      res.status,
      text,
    );
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Packing slip (json) failed: ${res.status}`,
      res.status,
      json,
    );
  }
  return json;
}

/** Fetch PDF bytes from Delhivery/S3 URL (server-side; used for admin proxy download). */
export async function fetchRemotePdfBuffer(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) {
    throw new DelhiveryApiError("Invalid PDF URL.", 400);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(trimmed, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { Accept: "application/pdf,*/*" },
    });
    if (!res.ok) {
      throw new DelhiveryApiError(
        `Could not download label PDF (${res.status}).`,
        res.status >= 400 && res.status < 600 ? res.status : 502,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const rawCt = res.headers.get("content-type");
    const contentType =
      rawCt?.split(";")[0]?.trim() || "application/pdf";
    return { buffer: buf, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** Invoice / kinko estimated charges */
export async function estimateShippingCharges(params: {
  md: "E" | "S";
  cgm: number;
  o_pin: string;
  d_pin: string;
  pt: "Pre-paid" | "COD";
  l?: number;
  b?: number;
  h?: number;
  ipkg_type?: "box" | "flyer";
}): Promise<unknown> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const q = new URLSearchParams({
    md: params.md,
    cgm: String(Math.max(0, Math.round(params.cgm))),
    o_pin: params.o_pin.replace(/\D/g, "").slice(0, 6),
    d_pin: params.d_pin.replace(/\D/g, "").slice(0, 6),
    ss: "Delivered",
    pt: params.pt,
  });
  if (params.l != null) q.set("l", String(Math.round(params.l)));
  if (params.b != null) q.set("b", String(Math.round(params.b)));
  if (params.h != null) q.set("h", String(Math.round(params.h)));
  if (params.ipkg_type) q.set("ipkg_type", params.ipkg_type);

  const res = await delhiveryFetch(
    `/api/kinko/v1/invoice/charges/.json?${q}`,
    {
      headers: {
        ...AUTH_HEADER(),
        "Content-Type": "application/json",
      },
    },
  );
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DelhiveryApiError(`Charges: non-JSON`, res.status, text);
  }
  if (!res.ok) {
    throw new DelhiveryApiError(
      `Charges failed: ${res.status}`,
      res.status,
      json,
    );
  }
  return json;
}

/**
 * TAT / expected delivery — path may vary by account; we try a few known patterns.
 */
export async function fetchTatHint(params: {
  origin_pin: string;
  destination_pin: string;
  mot: "S" | "E" | "N";
}): Promise<{ tatDays?: number; raw: unknown; ok: boolean }> {
  if (!delhiveryIsConfigured()) {
    throw new DelhiveryApiError("Delhivery is not configured", 503);
  }
  const customPath = process.env.DELHIVERY_TAT_PATH?.trim();
  const paths = customPath ?
      [customPath]
    : [
        `/api/dc/fetch/tat?origin_pin=${encodeURIComponent(params.origin_pin)}&destination_pin=${encodeURIComponent(params.destination_pin)}&mot=${params.mot}`,
        `/api/dc/fetch/tat/json/?origin_pin=${encodeURIComponent(params.origin_pin)}&destination_pin=${encodeURIComponent(params.destination_pin)}&mot=${params.mot}`,
      ];

  for (const path of paths) {
    try {
      const res = await delhiveryFetch(path, { headers: AUTH_HEADER() });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      if (!res.ok) continue;
      const days = extractTatDays(json);
      return { tatDays: days, raw: json, ok: true };
    } catch (e) {
      logger.debug(`Delhivery TAT try failed: ${(e as Error).message}`);
    }
  }
  return { raw: null, ok: false };
}

function extractTatDays(json: unknown): number | undefined {
  if (json == null || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  const candidates = [
    o.tat,
    o.TAT,
    o.expected_delivery_days,
    o.days,
    o.time_in_transit,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return Math.round(c);
    if (typeof c === "string" && /^\d+$/.test(c.trim())) return parseInt(c.trim(), 10);
  }
  if (typeof o.data === "object" && o.data) {
    return extractTatDays(o.data);
  }
  return undefined;
}

export function sanitizeManifestText(s: string): string {
  return s.replace(/[&\\#%;]/g, " ").replace(/\s+/g, " ").trim();
}

/** Chargeable weight (g): max(actual, volumetric) — volumetric from cm ÷ 5000 → kg → g */
export function chargeableWeightGrams(
  lengthCm: number,
  breadthCm: number,
  heightCm: number,
  actualGrams: number,
): number {
  const volKg = (lengthCm * breadthCm * heightCm) / 5000;
  const volG = Math.ceil(volKg * 1000);
  return Math.max(Math.ceil(actualGrams), volG);
}

/**
 * Dead weight per box (g) for multi-piece — must match manifest `weight` on each box.
 * Same rule as Delhivery UI: max(50g floor, ceil(total / boxes)).
 */
export function perBoxDeadWeightGm(totalGrams: number, boxCount: number): number {
  const boxes = Math.min(5, Math.max(1, Math.floor(boxCount)));
  return Math.max(50, Math.ceil(totalGrams / boxes));
}

export function volumetricWeightGrams(lengthCm: number, breadthCm: number, heightCm: number): number {
  const volKg = (lengthCm * breadthCm * heightCm) / 5000;
  return Math.ceil(volKg * 1000);
}

/** Parse CMU create.json response — structure varies; collect waybills and error text */
export function parseCreateShipmentResult(json: unknown): {
  ok: boolean;
  waybills: string[];
  errorMessage?: string;
} {
  if (json == null) return { ok: false, waybills: [], errorMessage: "Empty response" };
  const waybills: string[] = [];

  const pushWb = (v: unknown) => {
    if (typeof v === "string" && v.trim().length >= 8) waybills.push(v.trim());
  };

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.packages)) {
      for (const p of o.packages) {
        if (p && typeof p === "object") {
          const w = (p as Record<string, unknown>).waybill;
          pushWb(w);
        }
      }
    }
    if (Array.isArray(o.success)) {
      for (const p of o.success) {
        if (p && typeof p === "object") {
          const w = (p as Record<string, unknown>).waybill;
          pushWb(w);
        }
      }
    }
    if (typeof o.waybill === "string") pushWb(o.waybill);
  };

  walk(json);

  let errorMessage: string | undefined;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (o.rmk && typeof o.rmk === "string") errorMessage = o.rmk;
    if (Array.isArray(o.packages)) {
      for (const p of o.packages) {
        if (p && typeof p === "object") {
          const r = (p as Record<string, unknown>).remarks;
          if (Array.isArray(r) && r.length && typeof r[0] === "string") {
            errorMessage = (errorMessage ? `${errorMessage}; ` : "") + r[0];
          }
        }
      }
    }
    if (o.success === false && typeof o.error === "string") errorMessage = o.error;
  }

  const ok = waybills.length > 0;
  return { ok, waybills: [...new Set(waybills)], errorMessage };
}
