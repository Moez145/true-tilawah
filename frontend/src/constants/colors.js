// ─────────────────────────────────────────────────────────────────────────────
// True Tilawah — design tokens
// One source of truth for every color used in the app. Anywhere that needs the
// brand green should import BRAND_GRADIENT (heroes, banners, drawer header,
// splash) — do not inline gradient color arrays anywhere else.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Brand (deep Quranic green) ──────────────────────────────────────────────
export const PRIMARY                = '#1A3C34';
export const PRIMARY_LIGHT          = '#2D5A4E';
export const SECONDARY              = '#86B6A7';
export const SECONDARY_MEDIUM       = '#5C8E7F';
export const SECONDARY_LIGHT        = '#D1E0DB';
export const SECONDARY_ULTRA_LIGHT  = '#E8F3F0';

// Gold accent — used on the dark brand gradient (badges, dividers, dots).
export const ACCENT_GOLD            = '#FFE9A8';
export const ACCENT_GOLD_DEEP       = '#E6B014';

// Single source of truth for every "top green" surface.
export const BRAND_GRADIENT         = [PRIMARY, PRIMARY_LIGHT, SECONDARY_MEDIUM];

// Disabled / inactive variant of the brand gradient.
export const MUTED_GRADIENT         = ['#9CA3AF', '#6B7280'];

// ─── Neutrals ────────────────────────────────────────────────────────────────
export const WHITE              = '#FFFFFF';
export const BLACK              = '#000000';
export const BACKGROUND         = '#F5F7F8';
export const BACKGROUND_LIGHT   = '#F8FAFB';
export const GRAY_100           = '#F3F4F6';
export const GRAY_200           = '#E5E7EB';
export const GRAY_300           = '#D1D5DB';
export const GRAY_400           = '#9CA3AF';
export const GRAY_500           = '#6B7280';
export const GRAY_600           = '#4B5563';

// ─── Semantic ────────────────────────────────────────────────────────────────
export const RED            = '#EF4444';
export const RED_LIGHT      = '#FEE2E2';
export const ORANGE         = '#F97316';
export const ORANGE_LIGHT   = '#FFF7ED';
export const GREEN          = '#10B981';
export const GREEN_LIGHT    = '#ECFDF5';
export const BLUE           = '#3B82F6';
export const BLUE_LIGHT     = '#EFF6FF';
export const PURPLE         = '#8B5CF6';
export const PURPLE_LIGHT   = '#F5F3FF';
export const YELLOW         = '#EAB308';
export const YELLOW_LIGHT   = '#FEFCE8';

// ─── Feature-card palette (Memorize / Recite / Retain / Track) ───────────────
// Pastel bg + saturated foreground, tuned to sit next to the brand green.
export const FEATURE_CARDS = {
  memorize: { bg: SECONDARY_ULTRA_LIGHT, fg: PRIMARY },
  recite:   { bg: '#FFF5F0',             fg: '#FF7A3D' },
  retain:   { bg: '#FFFBE8',             fg: ACCENT_GOLD_DEEP },
  track:    { bg: '#F0F3FF',             fg: '#4D6BFE' },
};

// ─── Legacy aggregate ────────────────────────────────────────────────────────
// Kept so `import { COLORS } from '../constants'` continues to work everywhere.
// For new code, prefer the named exports above.
export const COLORS = {
  primary:             PRIMARY,
  primaryLight:        PRIMARY_LIGHT,
  secondary:           SECONDARY,
  secondaryMedium:     SECONDARY_MEDIUM,
  secondaryLight:      SECONDARY_LIGHT,
  secondaryUltraLight: SECONDARY_ULTRA_LIGHT,
  accentGold:          ACCENT_GOLD,
  accentGoldDeep:      ACCENT_GOLD_DEEP,

  background:          BACKGROUND,
  backgroundLight:     BACKGROUND_LIGHT,
  white:               WHITE,
  black:               BLACK,
  gray100:             GRAY_100,
  gray200:             GRAY_200,
  gray300:             GRAY_300,
  gray400:             GRAY_400,
  gray500:             GRAY_500,
  gray600:             GRAY_600,

  red:                 RED,
  redLight:            RED_LIGHT,
  orange:              ORANGE,
  orangeLight:         ORANGE_LIGHT,
  green:               GREEN,
  greenLight:          GREEN_LIGHT,
  blue:                BLUE,
  blueLight:           BLUE_LIGHT,
  purple:              PURPLE,
  purpleLight:         PURPLE_LIGHT,
  yellow:              YELLOW,
  yellowLight:         YELLOW_LIGHT,
};

// ─── Word-by-word recitation feedback states ─────────────────────────────────
export const WORD_PENDING       = '#1F2937';       // default text colour (dark grey)
export const WORD_MISTAKE       = '#DC2626';       // red — instant highlight on partial_mistake
export const WORD_CORRECTED     = '#16A34A';       // green — user re-read correctly
export const WORD_ACKNOWLEDGED  = '#FCA5A5';       // faded red — user moved on or 2 s timeout

// Make them available on the COLORS aggregate for consistency with existing code
COLORS.wordPending      = WORD_PENDING;
COLORS.wordMistake      = WORD_MISTAKE;
COLORS.wordCorrected    = WORD_CORRECTED;
COLORS.wordAcknowledged = WORD_ACKNOWLEDGED;
