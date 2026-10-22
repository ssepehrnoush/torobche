export type Ctx = {
  lat: number;
  lon: number;
  place: string;
  radius_km: number;
  budget_min: number | null;
  budget_max: number | null;
  visit: string;
  installments_only: boolean;
  torob_pay_only: boolean;
  open_only: boolean;
  range_mode: "time" | "km";
  range_minutes: number;
  travel_mode: TravelMode;
  originality: "any" | "original_only";
};

export type TravelMode = "walk" | "car" | "transit";

export type Leg = { mode: "walk" | "metro" | "transfer" | "taxi"; label: string; minutes: number; to?: string; line?: string; board?: string; alight?: string; stops?: number; at?: string };

export type Travel = { mode: string; minutes: number; label: string; legs?: Leg[]; warning?: string };

export type Authenticity = { status: "declared_copy" | "suspicious" | "likely_original" | "unknown"; confidence: number; label: string; reasons: string[] };

export type Bargain = {
  sid: number; name: string; price: number | null; mall: string | null; minutes: number; travel_mode: string; travel_label: string;
  alt_travel: { mode: string; minutes: number; label: string } | null; saving: number | null; extra_minutes: number | null; message: string; pid?: number;
};

export type Spec = { k: string; v: string };

export type ProductCard = {
  pid: number;
  title: string;
  brand: string | null;
  category: string;
  image: string | null;
  n_shops: number;
  price_min: number | null;
  price_median: number | null;
  price_max: number | null;
  n_nearby?: number;
  nearest_km?: number | null;
  nearby_min_price?: number | null;
  n_installment?: number;
  specs: Spec[];
  why?: string;
  tag?: string | null;
};

export type OpenState = {
  state: "open" | "closed" | "unknown";
  label: string;
  closes_in_min?: number | null;
  closes_at?: string;
  opens_at?: string;
};

export type Freshness = { tier: "fresh" | "aging" | "stale" | "unknown"; days: number | null; ts?: number; label: string };

export type Badge = { kind: string; label: string };

export type ShopBrief = {
  sid: number;
  shop_id: string;
  name: string;
  area: string | null;
  address: string | null;
  lat: number;
  lon: number;
  mall: string | null;
  mall_name: string | null;
  km: number;
  distance_label: string;
  travel: Travel;
  in_radius: boolean;
  open_now: OpenState;
  open_at_visit: OpenState;
  visit_warning: string | null;
  badges: Badge[];
  installments: string[];
  torob_pay: boolean;
  phone: string | null;
  is_real_name: boolean;
  instagram_url: string | null;
  website_url: string | null;
  reasons?: string[];
};

export type ShopOffer = ShopBrief & {
  offer_id: number;
  price: number | null;
  price_note: string | null;
  freshness: Freshness;
  seller_title: string;
  warranty: string | null;
  n_listings: number;
  stock: { state: string; label: string };
  score: number;
  reasons: string[];
  same_mall_count: number;
  price_warning: string | null;
  alt_open: { sid: number; name: string; price: number | null; distance_label: string; same_mall: boolean; open_label: string } | null;
  authenticity?: Authenticity;
};

export type ShopsResult = {
  items: ShopOffer[];
  stats: {
    total: number;
    in_radius: number;
    price_min: number | null;
    price_max: number | null;
    open_at_visit: number;
    hidden: Record<string, number>;
  };
  visit_at: string;
  range?: { mode: string; minutes: number; km: number; travel_mode: string; label: string };
  expand?: { minutes?: number; km?: number; count: number; label: string }[];
  bargain?: Bargain | null;
  product: { pid: number; title: string; brand: string | null; image: string | null; category: string; price_min: number | null; price_max: number | null; n_shops: number };
  similar: ProductCard[];
  leads: (ShopBrief & { reasons: string[] })[];
};

export type MallGuide = {
  mall_name: string | null;
  floor: string | null;
  floor_num: number | null;
  unit: string | null;
  street: string | null;
  steps: { icon: string; text: string }[];
  landmarks: { name: string; unit: string; sid: number }[];
  floors: { num: number; shops: number; target: boolean }[];
  mall_shop_count: number;
  source: string;
};

export type ShopDetail = ShopBrief & {
  week: { dow: number; day: string; text: string; today: boolean }[];
  categories: string[];
  n_products: number;
  providers: string[];
  mall_guide: MallGuide | null;
  offer: { price: number | null; freshness: Freshness; seller_title: string; warranty: string | null; description: string | null } | null;
  same_mall_offers: { sid: number; name: string; mall: string | null; price: number | null }[];
  phone_note: string;
  nav: { neshan: string; balad: string; google: string };
};

export type Question = { question: string; options: string[]; multi: boolean };

export type AgentStep = { id: string; tool: string; label: string; detail?: string; done: boolean };

export type FeedItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "agent";
      id: string;
      steps: AgentStep[];
      status?: string;
      pending: boolean;
      message?: string;
      notice?: string;
      ask?: Question[];
      answered?: boolean;
      products?: ProductCard[];
      suggestions?: string[];
      shopsPid?: number;
      inquiry?: { pid: number; sids: number[] };
      bargain?: Bargain | null;
      applied?: string[];
      error?: string;
      elapsed?: number;
    };

export type Reply = {
  sid: number;
  outcome: "confirmed" | "price_changed" | "out_of_stock" | "no_answer" | "closed";
  delay_s: number;
  confirmed_price: number | null;
  price_delta?: number;
  in_stock: boolean | null;
  hold_until: string | null; // «۱۵:۴۲»
  hold_until_at?: string | null; // ISO, for the countdown
  hold_code?: string | null; // reservation code to show at the counter
  hours_today: string | null;
  text: string | null;
  note?: string;
  restock?: string | null;
  installments: string | null;
  authenticity_check?: { status: "confirmed_copy" | "unclear" | "claimed_original"; label: string; confidence?: number; reasons?: string[] } | null;
  via?: string; // the channel that got the answer: sms | bale | call
  real?: boolean; // tapped on the shop's answer page, not simulated
};

/** A shop's own order of contact channels, and the one-tap answer page. */
export type ContactChannel = { k: string; label: string };
export type ShopAnswer = {
  outcome: "confirmed" | "price_changed" | "out_of_stock" | "no_answer"; price: number | null; real: boolean; at?: string; expired?: boolean;
  hold_until?: string | null; hold_code?: string | null;
};
export type ShopReplyPage = { shop: string; price: number | null; product: string; image: string | null; answer: ShopAnswer | null };

export type InquiryShop = {
  sid: number;
  name: string;
  price: number | null;
  phone: string | null;
  freshness: Freshness;
  open_now: OpenState;
  distance_label: string;
  draft: string;
  authenticity?: Authenticity;
  channels?: ContactChannel[];
  reply_token?: string; // set once the inquiry is sent
  sms?: string; // the short text with the answer link (path only; the page adds its origin)
  real?: boolean; // demo «زنده» with Kavenegar set up: the text and call really go to the demo phone
};

export type InquirySummary = {
  text: string;
  best_sid: number | null;
  confirmed_sids: number[];
  failed_sids: number[];
  alternatives: ShopOffer[];
  similar: ProductCard[];
  leads: (ShopBrief & { reasons: string[] })[];
};

export type VisitStop = {
  sid: number;
  name: string;
  lat: number;
  lon: number;
  mall_name: string | null;
  mall: string | null;
  address: string | null;
  leg: Travel & { km: number };
  arrive: string;
  arrive_label: string;
  open: OpenState;
  price: number | null;
  confirmed_price: number | null;
  hold_until: string | null;
  hold_until_at?: string | null;
  hold_code?: string | null;
  guide: { icon: string; text: string }[];
  nav: { neshan: string; balad: string; google: string; dest?: { lat: number; lon: number; name: string } };
  installments: string[];
};

export type VisitPlan = {
  start: string;
  start_label: string;
  end_label: string;
  total_minutes: number;
  total_km: number;
  stops: VisitStop[];
  warnings: string[];
  checklist: string[];
  origin: { lat: number; lon: number; label: string };
  paths?: MapPath[];
};

/** One drawn stretch of the trip: along real streets when `real`, otherwise the straight dotted line. */
export type MapPath = { mode: string; real: boolean; points: [number, number][] };

export type Place ={ id: string; label: string; lat: number; lon: number };

/** A typed start point: preset square, metro station, shopping centre or neighbourhood (/api/places). */
export type PlaceHit = Place & { kind: "place" | "metro" | "mall" | "area"; sub: string };

/** A neighbourhood bubble on the place map. */
export type PlaceArea = PlaceHit & { shops: number };

/** A point tapped on the map: named after the nearest landmark, with the shops within a short walk. */
export type PointInfo = { label: string; near: PlaceHit | null; shops_nearby: number };

export type Meta = {
  places: Place[];
  visit_presets: Record<string, string>;
  snapshot: string;
  counts: Record<string, number>;
  llm: { available: boolean; providers: { name: string; model: string }[] };
  now: string;
  travel_modes?: Record<TravelMode, string>;
  range_minutes_presets?: number[];
};

export type StrollStop = {
  sid: number; name: string; mall: string | null; lat: number; lon: number; walk_minutes: number;
  item: { pid: number; title: string; category: string; image: string | null; price: number; usual_price: number; below_pct: number; label: string };
  nav: { neshan: string; balad: string; google: string };
};

export type Stroll = {
  anchor?: { sid: number; name: string; mall: string | null; lat: number; lon: number };
  stops: StrollStop[];
  total_minutes?: number;
  summary?: string;
  categories?: string[];
  note: string;
};

/* Generative UI: the next wizard screen, built by the model from a fixed box of blocks (backend genui.py). */
export type GenKnown = { place: boolean; travel: boolean };
export type GenAnswer = { q: string; a: string; budget?: number };
export type GenCompare = {
  products: { pid: number; title: string; image: string | null; price_min: number | null; n_nearby?: number; nearby_min_price?: number | null }[];
  rows: { key: string; values: (string | null)[]; differs: boolean }[];
};
export type GenScreen = {
  block: "choice" | "budget" | "place" | "travel" | "products" | "compare";
  title: string;
  why: string;
  source: "model" | "rule";
  options?: string[];
  multi?: boolean;
  budget?: { min: number; max: number; step: number; median: number };
  products?: { pid: number; title: string; brand: string | null; image: string | null; price_min: number | null; nearby_min_price?: number | null; n_nearby?: number; n_shops: number }[];
  compare?: GenCompare;
};
export type GenTurn = { screen: GenScreen; ctx: Ctx; known: GenKnown; search: { q: string; brand: string | null } };
export type GenShops = { layout: "best" | "list" | "map" | "bargain" | "expand"; title: string; why: string; source: "model" | "rule"; best_sid: number | null; reason: string };
