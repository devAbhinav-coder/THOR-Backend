/** Local trend + festival intelligence for Indian ethnic wear (no external API key). */

export type TrendSeed = {
  keyword: string;
  score: number;
  reason: string;
  category: string;
};

export type FestivalHook = {
  name: string;
  approxDate: string;
  daysAway: number;
  contentAngle: string;
};

const MONTHLY_TRENDS: Record<number, TrendSeed[]> = {
  0: [
    { keyword: "wedding season saree looks", score: 92, reason: "Peak north Indian wedding season", category: "bridal" },
    { keyword: "banarasi saree styling", score: 88, reason: "Winter wedding reception searches", category: "saree-styling" },
    { keyword: "saree gift box ideas", score: 75, reason: "Post-New Year gifting", category: "gifting" },
  ],
  1: [
    { keyword: "reception saree drape ideas", score: 90, reason: "Wedding season continues", category: "bridal" },
    { keyword: "valentine saree gift", score: 70, reason: "Feb gifting spike", category: "gifting" },
    { keyword: "spring wedding saree colours", score: 82, reason: "Pre-summer wedding palette", category: "trends" },
  ],
  2: [
    { keyword: "holi saree care tips", score: 85, reason: "Holi prep — fabric protection", category: "fabric-care" },
    { keyword: "light festive saree looks", score: 78, reason: "Holi & spring festivals", category: "festive" },
    { keyword: "chanderi saree summer styling", score: 72, reason: "Breathable fabric trend", category: "saree-styling" },
  ],
  3: [
    { keyword: "summer wedding saree fabrics", score: 80, reason: "Heat-friendly bridal picks", category: "bridal" },
    { keyword: "office ethnic wear saree", score: 68, reason: "Summer workwear searches", category: "saree-styling" },
    { keyword: "silk saree storage summer", score: 65, reason: "Fabric care seasonal", category: "fabric-care" },
  ],
  4: [
    { keyword: "monsoon saree care", score: 88, reason: "Rainy season fabric care rises", category: "fabric-care" },
    { keyword: "lightweight cotton saree drape", score: 76, reason: "Monsoon comfort styling", category: "saree-styling" },
    { keyword: "pre festive wardrobe planning", score: 70, reason: "Early Diwali prep searches", category: "trends" },
  ],
  5: [
    { keyword: "monsoon ethnic wear tips", score: 86, reason: "June–July monsoon peak", category: "fabric-care" },
    { keyword: "rakhi saree gift ideas", score: 82, reason: "Raksha Bandhan planning starts", category: "gifting" },
    { keyword: "handloom saree trend 2026", score: 74, reason: "Sustainable fashion interest", category: "trends" },
  ],
  6: [
    { keyword: "rakhi gift saree for sister", score: 90, reason: "Raksha Bandhan peak", category: "gifting" },
    { keyword: "independence day ethnic look", score: 65, reason: "Tricolour / handloom angle", category: "festive" },
    { keyword: "teej special saree look", score: 78, reason: "Teej festival styling", category: "festive" },
  ],
  7: [
    { keyword: "onam kasavu saree styling", score: 88, reason: "Onam season Kerala searches", category: "festive" },
    { keyword: "janmashtami ethnic outfit", score: 72, reason: "Festival content window", category: "festive" },
    { keyword: "ganesh chaturthi saree colours", score: 80, reason: "Early festive planning", category: "festive" },
  ],
  8: [
    { keyword: "ganesh chaturthi saree drape", score: 92, reason: "Major festival Sep", category: "festive" },
    { keyword: "navratri saree colours day wise", score: 85, reason: "Navratri prep searches", category: "festive" },
    { keyword: "corporate diwali gift hamper saree", score: 78, reason: "B2B gifting season starts", category: "gifting" },
  ],
  9: [
    { keyword: "navratri saree styling guide", score: 95, reason: "Peak Navratri searches", category: "festive" },
    { keyword: "karva chauth saree look", score: 88, reason: "Oct festival cluster", category: "bridal" },
    { keyword: "diwali saree shopping guide", score: 94, reason: "Biggest festive commerce spike", category: "festive" },
  ],
  10: [
    { keyword: "diwali ethnic wear ideas", score: 96, reason: "Diwali peak", category: "festive" },
    { keyword: "bhai dooj saree gift", score: 82, reason: "Post-Diwali gifting", category: "gifting" },
    { keyword: "wedding season banarasi saree", score: 90, reason: "Nov wedding wave", category: "bridal" },
  ],
  11: [
    { keyword: "christmas party saree look", score: 75, reason: "Year-end parties", category: "saree-styling" },
    { keyword: "new year ethnic outfit", score: 80, reason: "NYE searches", category: "trends" },
    { keyword: "winter silk saree care", score: 70, reason: "Cold weather fabric care", category: "fabric-care" },
  ],
};

/** Approximate festival dates — content planning hooks (India). */
function festivalCalendar(year: number): Array<{ name: string; month: number; day: number; angle: string; year: number }> {
  return [
    { name: "Holi", month: 2, day: 14, angle: "Colour-safe saree care & festive looks" },
    { name: "Raksha Bandhan", month: 7, day: 28, angle: "Sister gifting — saree gift guides" },
    { name: "Onam", month: 7, day: 26, angle: "Kasavu / Kerala silk styling" },
    { name: "Ganesh Chaturthi", month: 8, day: 14, angle: "Maharashtrian festive drapes" },
    { name: "Navratri", month: 9, day: 11, angle: "9-day colour & drape series" },
    { name: "Karva Chauth", month: 9, day: 28, angle: "Bridal red / bandhani looks" },
    { name: "Diwali", month: 10, day: 8, angle: "Festive saree edit + gifting" },
    { name: "Wedding Season Peak", month: 11, day: 15, angle: "Bridal banarasi & reception looks" },
  ].map((f) => ({ ...f, year }));
}

export function getUpcomingFestivals(withinDays = 90, now = new Date()): FestivalHook[] {
  const year = now.getFullYear();
  const events = festivalCalendar(year).concat(festivalCalendar(year + 1));
  const today = now.getTime();

  return events
    .map((f) => {
      const d = new Date(f.year, f.month, f.day);
      const daysAway = Math.ceil((d.getTime() - today) / 86400000);
      return {
        name: f.name,
        approxDate: d.toISOString().slice(0, 10),
        daysAway,
        contentAngle: f.angle,
      };
    })
    .filter((f) => f.daysAway >= -7 && f.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway)
    .slice(0, 8);
}

export function getMonthlyTrendSeeds(now = new Date()): TrendSeed[] {
  const month = now.getMonth();
  const current = MONTHLY_TRENDS[month] || [];
  const next = MONTHLY_TRENDS[(month + 1) % 12] || [];
  return [...current, ...next]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

export function getSeasonLabel(now = new Date()): string {
  const m = now.getMonth();
  if (m >= 9 || m <= 1) return "festive & wedding peak (Oct–Feb)";
  if (m >= 2 && m <= 4) return "spring festivals & summer prep";
  if (m >= 5 && m <= 8) return "monsoon care & pre-festive buildup";
  return "year-round ethnic wear";
}
