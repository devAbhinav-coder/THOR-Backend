/**
 * India PIN → state + logistics zone + transit SLA from NCR warehouse (201301).
 * Used when carrier TAT is unavailable so every region still gets a distinct ETA.
 */

export type DeliveryZone =
  | "ncr"
  | "north"
  | "west"
  | "central"
  | "east"
  | "south"
  | "jk"
  | "northeast"
  | "island";

export type PincodeGeo = {
  pincode: string;
  state: string;
  zone: DeliveryZone;
  zoneLabel: string;
  transitDaysMin: number;
  transitDaysMax: number;
};

const ZONE_LABEL: Record<DeliveryZone, string> = {
  ncr: "NCR Metro",
  north: "North India",
  west: "West India",
  central: "Central India",
  east: "East India",
  south: "South India",
  jk: "Jammu & Kashmir",
  northeast: "Northeast",
  island: "Island / remote",
};

/** Surface transit (business days, Sun off) from Noida / Greater Noida hub. */
const ZONE_TRANSIT: Record<DeliveryZone, { min: number; max: number }> = {
  ncr: { min: 1, max: 2 },
  north: { min: 2, max: 4 },
  west: { min: 3, max: 5 },
  central: { min: 3, max: 5 },
  east: { min: 4, max: 6 },
  south: { min: 4, max: 6 },
  jk: { min: 5, max: 8 },
  northeast: { min: 6, max: 9 },
  island: { min: 7, max: 10 },
};

const STATE_CODE_TO_NAME: Record<string, string> = {
  AN: "Andaman and Nicobar Islands",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CG: "Chhattisgarh",
  CH: "Chandigarh",
  DD: "Dadra and Nagar Haveli and Daman and Diu",
  DL: "Delhi",
  DN: "Dadra and Nagar Haveli and Daman and Diu",
  GA: "Goa",
  GJ: "Gujarat",
  HP: "Himachal Pradesh",
  HR: "Haryana",
  JH: "Jharkhand",
  JK: "Jammu and Kashmir",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Ladakh",
  LD: "Lakshadweep",
  MH: "Maharashtra",
  ML: "Meghalaya",
  MN: "Manipur",
  MP: "Madhya Pradesh",
  MZ: "Mizoram",
  NL: "Nagaland",
  OD: "Odisha",
  OR: "Odisha",
  PB: "Punjab",
  PY: "Puducherry",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TN: "Tamil Nadu",
  TR: "Tripura",
  TS: "Telangana",
  TG: "Telangana",
  UK: "Uttarakhand",
  UA: "Uttarakhand",
  UP: "Uttar Pradesh",
  WB: "West Bengal",
};

/** First-2 PIN prefix → default state (India Post circles). */
const PREFIX2_STATE: Record<string, string> = {
  "11": "Delhi",
  "12": "Haryana",
  "13": "Haryana",
  "14": "Punjab",
  "15": "Punjab",
  "16": "Chandigarh",
  "17": "Himachal Pradesh",
  "18": "Jammu and Kashmir",
  "19": "Jammu and Kashmir",
  "20": "Uttar Pradesh",
  "21": "Uttar Pradesh",
  "22": "Uttar Pradesh",
  "23": "Uttar Pradesh",
  "24": "Uttar Pradesh",
  "25": "Uttar Pradesh",
  "26": "Uttar Pradesh",
  "27": "Uttar Pradesh",
  "28": "Uttar Pradesh",
  "30": "Rajasthan",
  "31": "Rajasthan",
  "32": "Rajasthan",
  "33": "Rajasthan",
  "34": "Rajasthan",
  "36": "Gujarat",
  "37": "Gujarat",
  "38": "Gujarat",
  "39": "Gujarat",
  "40": "Maharashtra",
  "41": "Maharashtra",
  "42": "Maharashtra",
  "43": "Maharashtra",
  "44": "Maharashtra",
  "45": "Madhya Pradesh",
  "46": "Madhya Pradesh",
  "47": "Madhya Pradesh",
  "48": "Madhya Pradesh",
  "49": "Chhattisgarh",
  "50": "Telangana",
  "51": "Andhra Pradesh",
  "52": "Andhra Pradesh",
  "53": "Andhra Pradesh",
  "56": "Karnataka",
  "57": "Karnataka",
  "58": "Karnataka",
  "59": "Karnataka",
  "60": "Tamil Nadu",
  "61": "Tamil Nadu",
  "62": "Tamil Nadu",
  "63": "Tamil Nadu",
  "64": "Tamil Nadu",
  "67": "Kerala",
  "68": "Kerala",
  "69": "Kerala",
  "70": "West Bengal",
  "71": "West Bengal",
  "72": "West Bengal",
  "73": "West Bengal",
  "74": "West Bengal",
  "75": "Odisha",
  "76": "Odisha",
  "77": "Odisha",
  "78": "Assam",
  "79": "Arunachal Pradesh",
  "80": "Bihar",
  "81": "Bihar",
  "82": "Jharkhand",
  "83": "Jharkhand",
  "84": "Bihar",
  "85": "Bihar",
};

const PREFIX3_OVERRIDE: Record<string, { state: string; zone?: DeliveryZone }> = {
  "121": { state: "Haryana", zone: "ncr" }, // Faridabad
  "122": { state: "Haryana", zone: "ncr" }, // Gurugram
  "140": { state: "Punjab" },
  "160": { state: "Chandigarh" },
  "194": { state: "Ladakh", zone: "jk" },
  "201": { state: "Uttar Pradesh", zone: "ncr" }, // Noida / Ghaziabad
  "203": { state: "Uttar Pradesh" },
  "244": { state: "Uttarakhand" },
  "246": { state: "Uttarakhand" },
  "247": { state: "Uttarakhand" },
  "248": { state: "Uttarakhand" },
  "249": { state: "Uttarakhand" },
  "263": { state: "Uttarakhand" },
  "396": { state: "Dadra and Nagar Haveli and Daman and Diu" },
  "403": { state: "Goa" },
  "605": { state: "Puducherry" },
  "607": { state: "Puducherry" },
  "609": { state: "Puducherry" },
  "737": { state: "Sikkim" },
  "744": { state: "Andaman and Nicobar Islands", zone: "island" },
  "792": { state: "Arunachal Pradesh", zone: "northeast" },
  "793": { state: "Meghalaya", zone: "northeast" },
  "794": { state: "Meghalaya", zone: "northeast" },
  "795": { state: "Manipur", zone: "northeast" },
  "796": { state: "Mizoram", zone: "northeast" },
  "797": { state: "Nagaland", zone: "northeast" },
  "798": { state: "Nagaland", zone: "northeast" },
  "799": { state: "Tripura", zone: "northeast" },
};

function zoneForState(state: string, pin: string): DeliveryZone {
  const p3 = pin.slice(0, 3);
  const override = PREFIX3_OVERRIDE[p3];
  if (override?.zone) return override.zone;

  if (pin.startsWith("11") || pin.startsWith("201") || pin.startsWith("121") || pin.startsWith("122")) {
    return "ncr";
  }

  switch (state) {
    case "Delhi":
      return "ncr";
    case "Jammu and Kashmir":
    case "Ladakh":
      return "jk";
    case "Assam":
    case "Arunachal Pradesh":
    case "Meghalaya":
    case "Manipur":
    case "Mizoram":
    case "Nagaland":
    case "Tripura":
    case "Sikkim":
      return "northeast";
    case "Andaman and Nicobar Islands":
    case "Lakshadweep":
      return "island";
    case "Haryana":
    case "Punjab":
    case "Chandigarh":
    case "Himachal Pradesh":
    case "Uttar Pradesh":
    case "Uttarakhand":
    case "Rajasthan":
      return "north";
    case "Gujarat":
    case "Maharashtra":
    case "Goa":
    case "Dadra and Nagar Haveli and Daman and Diu":
      return "west";
    case "Madhya Pradesh":
    case "Chhattisgarh":
      return "central";
    case "Bihar":
    case "Jharkhand":
    case "West Bengal":
    case "Odisha":
      return "east";
    case "Telangana":
    case "Andhra Pradesh":
    case "Karnataka":
    case "Tamil Nadu":
    case "Kerala":
    case "Puducherry":
      return "south";
    default:
      return "north";
  }
}

const STATE_ALIASES: Record<string, string> = {
  "nct of delhi": "Delhi",
  "nct delhi": "Delhi",
  "new delhi": "Delhi",
  orissa: "Odisha",
  uttaranchal: "Uttarakhand",
  pondicherry: "Puducherry",
  "jammu & kashmir": "Jammu and Kashmir",
  "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman & diu": "Dadra and Nagar Haveli and Daman and Diu",
  "andaman & nicobar islands": "Andaman and Nicobar Islands",
  "andaman and nicobar": "Andaman and Nicobar Islands",
};

export function normalizeStateName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const fromCode = STATE_CODE_TO_NAME[t.toUpperCase()];
  if (fromCode) return fromCode;
  const lower = t.toLowerCase();
  if (STATE_ALIASES[lower]) return STATE_ALIASES[lower];
  for (const name of Object.values(STATE_CODE_TO_NAME)) {
    if (name.toLowerCase() === lower) return name;
  }
  return t;
}

export function resolvePincodeGeo(pin: string): PincodeGeo {
  const pincode = pin.replace(/\D/g, "").slice(0, 6);
  const p3 = pincode.slice(0, 3);
  const p2 = pincode.slice(0, 2);
  /** Kavaratti / Minicoy — do not treat all 682xxx (Kochi) as island. */
  if (pincode.startsWith("68255")) {
    const transit = ZONE_TRANSIT.island;
    return {
      pincode,
      state: "Lakshadweep",
      zone: "island",
      zoneLabel: ZONE_LABEL.island,
      transitDaysMin: transit.min,
      transitDaysMax: transit.max,
    };
  }
  const override = PREFIX3_OVERRIDE[p3];
  const state = override?.state || PREFIX2_STATE[p2] || "India";
  const zone = zoneForState(state, pincode);
  const transit = ZONE_TRANSIT[zone];

  return {
    pincode,
    state,
    zone,
    zoneLabel: ZONE_LABEL[zone],
    transitDaysMin: transit.min,
    transitDaysMax: transit.max,
  };
}

export function zoneTransit(zone: DeliveryZone): { min: number; max: number } {
  return ZONE_TRANSIT[zone];
}
