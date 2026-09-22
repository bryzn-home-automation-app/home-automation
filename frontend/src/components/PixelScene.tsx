import { memo, type ReactNode } from 'react';

/**
 * PixelScene — playful retro pixel-art panoramas that fill the empty middle
 * of the shell header. Each route gets a full-width themed scene: a ground
 * strip with chibi characters and props spread along it, drawn from
 * hand-made character grids rendered as crisp SVG rects (no image assets,
 * no network cost).
 *
 * Grid format: array of strings; each char is a palette key, '.' is
 * transparent. Animations are pure CSS (see "Pixel scenes" in index.css)
 * and honor prefers-reduced-motion.
 */

type Grid = string[];
type Palette = Record<string, string>;

// ── Shared colors ──
const OUT = '#10192b'; // near-black outline used across sprites
const SKIN = '#f2c39b';
const EYE = '#1c2030';

interface PixelArt {
  grid: Grid;
  palette: Palette;
}

interface SpriteProps extends PixelArt {
  /** CSS pixels per art pixel. */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
}

function Sprite({ grid, palette, scale = 3, className, style }: SpriteProps) {
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  const rects: ReactNode[] = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const fill = palette[ch];
      if (!fill) continue;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    }
  });
  return (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {rects}
    </svg>
  );
}

// ── Chibi people (big head, tiny body) ──

interface ChibiOptions {
  hair: string;
  shirt: string;
  pants?: string;
  /** 'none' | 'cap' | 'hardhat' — swaps the hair rows for headgear. */
  hat?: 'none' | 'cap' | 'hardhat';
  hatColor?: string;
  /** Raise one arm (waving). */
  wave?: boolean;
}

function chibi({ hair, shirt, pants = '#3b4663', hat = 'none', hatColor = '#e8b93c', wave = false }: ChibiOptions): PixelArt {
  // When waving, the raised hand sits beside the cheek (touching the head)
  // and the right arm-hand is dropped so the arm reads as raised.
  const cheekRow = wave ? '.HFFFFFFHF' : '.HFFFFFFH.';
  const head =
    hat === 'none'
      ? ['...HHHH...', '..HHHHHH..', '.HHHHHHHH.', cheekRow]
      : hat === 'cap'
        ? ['...CCCC...', '..CCCCCC..', '.CCCCCCCCC', cheekRow]
        : ['...CCCC...', '..CCCCCC..', 'CCCCCCCCCC', cheekRow];
  const arms = wave ? '.FBBBBBB..' : '.FBBBBBBF.';
  const grid: Grid = [
    ...head,
    '.HFEFFEFH.',
    '..FFFFFF..',
    '...FFFF...',
    '..BBBBBB..',
    arms,
    '..BBBBBB..',
    '...PPPP...',
    '...P..P...',
    '..SS..SS..',
  ];
  const palette: Palette = {
    H: hair,
    C: hatColor,
    F: SKIN,
    E: EYE,
    B: shirt,
    P: pants,
    S: OUT,
  };
  return { grid, palette };
}

// ── Props / objects ──

const HOUSE: PixelArt = {
  grid: [
    '.....RR......',
    '....RRRR..K..',
    '...RRRRRR.K..',
    '..RRRRRRRRRR.',
    '.RRRRRRRRRRRR',
    '.WWWWWWWWWWW.',
    '.WGGWWWWWDDW.',
    '.WGGWWWWWDDW.',
    '.WWWWWWWWDDW.',
    '.WWWWWWWWDDW.',
  ],
  palette: { R: '#c95b4a', W: '#e8ddc8', G: '#8fd3f4', D: '#7a5236', K: '#9aa5b8' },
};

const SUN: PixelArt = {
  grid: [
    'Y..Y..Y',
    '.YYYYY.',
    'YYYYYYY',
    'YYYYYYY',
    '.YYYYY.',
    'Y..Y..Y',
  ],
  palette: { Y: '#ffd23e' },
};

const CLOUD: PixelArt = {
  grid: [
    '...NNNNN....',
    '.NNNNNNNNN..',
    'NNNNNNNNNNNN',
    '.NNNNNNNNN..',
  ],
  palette: { N: '#aebad2' },
};

const TREE: PixelArt = {
  grid: [
    '...GGG...',
    '..GGGGG..',
    '.GGGGGGG.',
    '.GGGGGGG.',
    '..GGGGG..',
    '...GGG...',
    '...TTT...',
    '...TTT...',
    '...TTT...',
  ],
  palette: { G: '#3f8d52', T: '#6b4b34' },
};

const FENCE: PixelArt = {
  grid: [
    'F...F...F...F',
    'FFFFFFFFFFFFF',
    'F...F...F...F',
    'FFFFFFFFFFFFF',
    'F...F...F...F',
    'F...F...F...F',
  ],
  palette: { F: '#8a6a4a' },
};

const POLE: PixelArt = {
  grid: [
    '...T...',
    'TTTTTTT',
    'W..T..W',
    '...T...',
    '...T...',
    '...T...',
    '...T...',
    '...T...',
    '...T...',
  ],
  palette: { T: '#6b4b34', W: '#dfe7f5' },
};

const PLANT: PixelArt = {
  grid: [
    '..G.G..',
    '.GGGGG.',
    '.GGGGG.',
    '..GGG..',
    '..PPP..',
    '.PPPPP.',
    '.PPPPP.',
  ],
  palette: { G: '#4ea45c', P: '#c95b4a' },
};

const CONE: PixelArt = {
  grid: [
    '...O...',
    '..OOO..',
    '..WWW..',
    '.OOOOO.',
    '.OOOOO.',
    'OOOOOOO',
  ],
  palette: { O: '#e8984a', W: '#e8ddc8' },
};

const BOLT: PixelArt = {
  grid: [
    '....ZZZ',
    '...ZZZ.',
    '..ZZZ..',
    '.ZZZZZZ',
    '...ZZZ.',
    '..ZZZ..',
    '.ZZZ...',
    'ZZZ....',
  ],
  palette: { Z: '#ffd23e' },
};

const BATTERY: PixelArt = {
  grid: [
    '..NN..',
    'GGGGGG',
    'GLLLLG',
    'GLLLLG',
    'GLLLLG',
    'GGGGGG',
  ],
  palette: { N: '#9aa5b8', G: '#3f4b66', L: '#5ad48a' },
};

const ROOMBA: PixelArt = {
  grid: [
    '..RRRRRRRR..',
    '.RRRRRRRRRR.',
    'RRRRLLRRRRRR',
    'RRRRRRRRRRRR',
    '.DD......DD.',
  ],
  palette: { R: '#4a5670', L: '#5ad48a', D: OUT },
};

const CAT: PixelArt = {
  grid: [
    'C...C..',
    'CC.CC..',
    'CCCCC..',
    'CWCWC..',
    'CCCCC.C',
    'CCCCCCC',
    '.C..C..',
  ],
  palette: { C: '#e8984a', W: '#1c2030' },
};

const DUST: PixelArt = {
  grid: ['S.', '.S', 'S.'],
  palette: { S: '#9aa5b8' },
};

const ROUTER: PixelArt = {
  grid: [
    '...AAAAAA...',
    '..A......A..',
    '....AAAA....',
    '...A....A...',
    '.....AA.....',
    '.....AA.....',
    'RRRRRRRRRRRR',
    'RGRLRRRRRRRR',
    'RRRRRRRRRRRR',
  ],
  palette: { A: '#6ee7f2', R: '#3f4b66', G: '#5ad48a', L: '#ffd23e' },
};

const BELL: PixelArt = {
  grid: [
    '...BB...',
    '..BBBB..',
    '.BBBBBB.',
    '.BBBBBB.',
    '.BBBBBB.',
    'BBBBBBBB',
    '...CC...',
  ],
  palette: { B: '#ffd23e', C: '#c95b4a' },
};

const WRENCH: PixelArt = {
  grid: [
    'W..W',
    'WWWW',
    '.WW.',
    '.WW.',
    '.WW.',
    '.WWW',
  ],
  palette: { W: '#9aa5b8' },
};

const TOOLBOX: PixelArt = {
  grid: [
    '..NNNN..',
    'RRRRRRRR',
    'RRRRRRRR',
    'RRRRRRRR',
  ],
  palette: { N: '#9aa5b8', R: '#c95b4a' },
};

const GIFT: PixelArt = {
  grid: [
    '.Y....Y.',
    '..Y..Y..',
    'RRRRRRRR',
    'RRRYYRRR',
    'RRRYYRRR',
    'RRRYYRRR',
    'RRRRRRRR',
  ],
  palette: { R: '#c95b4a', Y: '#ffd23e' },
};

const SPARKLE: PixelArt = {
  grid: ['..S..', '..S..', 'SSSSS', '..S..', '..S..'],
  palette: { S: '#ffd23e' },
};

const BUG: PixelArt = {
  grid: [
    'A....A',
    '.A..A.',
    '.GGGG.',
    'GGKKGG',
    'GGGGGG',
    'GGKKGG',
    '.GGGG.',
  ],
  palette: { A: '#5ad48a', G: '#5ad48a', K: '#1c2030' },
};

const TERMINAL: PixelArt = {
  grid: [
    'TTTTTTTTTT',
    'TKKKKKKKKT',
    'TKGK.KKKKT',
    'TKKGKKKKKT',
    'TKGK.GGKKT',
    'TKKKKKKKKT',
    'TTTTTTTTTT',
  ],
  palette: { T: '#3f4b66', K: '#131a2a', G: '#5ad48a' },
};

const SCROLL: PixelArt = {
  grid: [
    'NNNNNNNN.',
    'NWWWWWWNN',
    'NWKKKKWWN',
    'NWWWWWWWN',
    'NWKKKWWWN',
    'NWWWWWWWN',
    'NWKKKKKWN',
    'NNNNNNNNN',
  ],
  palette: { N: '#c9b98a', W: '#e8ddc8', K: '#7a6a45' },
};

const IDCARD: PixelArt = {
  grid: [
    'BBBBBBBBBB',
    'BWWBGGGGGB',
    'BWWBGKGKGB',
    'BWWBGGGGGB',
    'BBBBBBBBBB',
  ],
  palette: { B: '#4a5670', W: SKIN, G: '#8fd3f4', K: '#1c2030' },
};

const GEAR: PixelArt = {
  grid: [
    '.N.N.N.',
    'NNNNNNN',
    '.NNKNN.',
    'NNKKKNN',
    '.NNKNN.',
    'NNNNNNN',
    '.N.N.N.',
  ],
  palette: { N: '#9aa5b8', K: '#131a2a' },
};

// ── Cast ──
const BRYAN = chibi({ hair: '#3a2c22', shirt: '#4f7cd1', wave: true });
const GREEN = chibi({ hair: '#4ea45c', shirt: '#e0e4ee' });
const RED = chibi({ hair: '#d1603f', shirt: '#e8b93c' });
const DARK = chibi({ hair: '#241f2e', shirt: '#8a5cd1' });
const WORKER = chibi({ hair: '#3a2c22', shirt: '#e8984a', hat: 'hardhat', hatColor: '#ffd23e' });
const CAPGUY = chibi({ hair: '#3a2c22', shirt: '#5ad48a', hat: 'cap', hatColor: '#c95b4a' });

// ── Panorama layout ──
//
// Each scene item is placed at a % offset across the full available width,
// standing on a ground strip (or floating in the "sky" when `top` is set).
// Percent positioning means the scene naturally spreads out on wide screens
// and compresses on narrower ones.

const GROUND_H = 6; // px height of the grass strip

interface SceneItem {
  art: PixelArt;
  /** Horizontal position, % of panorama width. */
  left: number;
  /** Sky items: offset from the top in px (grounded items omit this). */
  top?: number;
  scale?: number;
  cls?: string;
  delay?: string;
  /** Marks the scene's must-keep items for the compact (mobile) variant. */
  hero?: boolean;
}

type SceneSpec = SceneItem[];

const sky = (art: PixelArt, left: number, top: number, cls?: string, delay?: string): SceneItem => ({
  art, left, top, cls, delay, scale: 3,
});
const ground = (art: PixelArt, left: number, scale = 4, cls?: string, delay?: string): SceneItem => ({
  art, left, scale, cls, delay,
});

const SCENES: Array<[prefix: string, spec: SceneSpec]> = [
  ['/utility', [
    sky(CLOUD, 20, 2, 'px-bob-slow'),
    sky(CLOUD, 72, 8, 'px-bob-slow', '1.2s'),
    ground(BOLT, 6, 4, 'px-flicker'),
    ground(POLE, 18, 4),
    ground(WORKER, 42, 4, 'px-bob'),
    ground(BATTERY, 58, 4, 'px-bob-slow', '0.6s'),
    ground(POLE, 78, 4),
  ]],
  ['/roomba', [
    ground(PLANT, 4, 4),
    ground(CAT, 16, 4, 'px-bob-slow'),
    { art: ROOMBA, left: 42, scale: 4, cls: 'px-drive-wide' },
    { art: DUST, left: 38, scale: 3, cls: 'px-twinkle' },
    ground(PLANT, 88, 4),
  ]],
  ['/wifi', [
    sky(CLOUD, 12, 4, 'px-bob-slow'),
    sky(CLOUD, 80, 2, 'px-bob-slow', '1s'),
    ground(ROUTER, 36, 4, 'px-pulse'),
    ground(CAPGUY, 56, 4, 'px-bob'),
    ground(PLANT, 82, 4),
  ]],
  ['/notifications', [
    sky(CLOUD, 70, 4, 'px-bob-slow'),
    { ...sky(BELL, 38, 6, 'px-swing'), hero: true },
    { ...ground(DARK, 52, 4, 'px-bob'), hero: true },
    ground(TREE, 12, 4),
    ground(FENCE, 80, 4),
  ]],
  ['/users', [
    ground(BRYAN, 10, 4, 'px-bob'),
    ground(GREEN, 32, 4, 'px-bob', '0.4s'),
    ground(RED, 50, 4, 'px-bob', '0.8s'),
    ground(DARK, 68, 4, 'px-bob', '1.2s'),
    ground(TREE, 88, 4),
  ]],
  ['/maintenance', [
    ground(CONE, 6, 4),
    sky(WRENCH, 30, 12, 'px-swing'),
    ground(WORKER, 42, 4, 'px-bob'),
    ground(TOOLBOX, 58, 4, 'px-bob-slow', '0.5s'),
    ground(FENCE, 74, 4),
    ground(CONE, 92, 4),
  ]],
  ['/updates', [
    sky(SPARKLE, 16, 8, 'px-twinkle'),
    { ...sky(SPARKLE, 62, 4, 'px-twinkle', '0.7s'), hero: true },
    sky(SPARKLE, 90, 14, 'px-twinkle', '0.4s'),
    { ...ground(GIFT, 34, 4, 'px-bob'), hero: true },
    { ...ground(RED, 50, 4, 'px-bob', '0.3s'), hero: true },
    ground(TREE, 78, 4),
  ]],
  ['/profile', [
    sky(CLOUD, 66, 4, 'px-bob-slow'),
    ground(HOUSE, 12, 4),
    ground(BRYAN, 44, 4, 'px-bob'),
    sky(GEAR, 60, 16, 'px-spin-slow'),
    ground(TREE, 84, 4),
  ]],
  ['/admin/guests', [
    sky(CLOUD, 60, 4, 'px-bob-slow'),
    ground(IDCARD, 30, 4, 'px-bob-slow'),
    ground(GREEN, 52, 4, 'px-bob'),
    ground(FENCE, 74, 4),
  ]],
  ['/admin/debug', [
    ground(TERMINAL, 30, 4, 'px-pulse'),
    { art: BUG, left: 55, scale: 4, cls: 'px-drive' },
    ground(PLANT, 82, 4),
  ]],
  ['/admin/logs', [
    ground(SCROLL, 32, 4, 'px-bob-slow'),
    ground(DARK, 54, 4, 'px-bob'),
    ground(TREE, 80, 4),
  ]],
  // Home (default) — sunny yard: sun, clouds, house, Bryan waving, trees.
  ['/', [
    sky(SUN, 3, 0, 'px-spin-slow'),
    sky(CLOUD, 26, 6, 'px-bob-slow'),
    sky(CLOUD, 66, 2, 'px-bob-slow', '1.4s'),
    ground(TREE, 14, 4),
    ground(HOUSE, 34, 4, 'px-bob-slow'),
    ground(BRYAN, 56, 4, 'px-bob'),
    ground(FENCE, 70, 4),
    ground(TREE, 88, 4),
  ]],
];

function specFor(path: string): SceneSpec {
  for (const [prefix, spec] of SCENES) {
    if (prefix !== '/' && path.startsWith(prefix)) return spec;
  }
  return SCENES[SCENES.length - 1][1];
}

/**
 * Derive the phone-sized scene from the full spec: keep the first three
 * grounded items (the themed hero props/characters — scenery like far
 * fences/trees comes later in each spec), re-spread them across the narrow
 * strip, drop clouds, and step every sprite down one pixel-scale. The wide
 * roomba patrol also drops to the narrow drive amplitude.
 */
function compactSpec(spec: SceneSpec): SceneSpec {
  const heroes = spec.filter((item) => item.hero);
  const pool = heroes.length > 0 ? heroes : spec.filter((item) => item.top === undefined);
  const kept = pool.slice(0, 3);
  const positions = kept.length === 1 ? [40] : kept.length === 2 ? [18, 60] : [8, 40, 70];
  return kept.map((item, i) => ({
    ...item,
    left: positions[i],
    scale: Math.max(2, (item.scale ?? 4) - 1),
    cls: item.cls === 'px-drive-wide' ? 'px-drive' : item.cls,
  }));
}

interface HeaderPixelSceneProps {
  path: string;
  /** Compact: shorter strip, fewer/smaller sprites — for the mobile header. */
  compact?: boolean;
}

/**
 * Route-aware pixel panorama for the shell header. The full variant fills
 * the empty header middle on lg+; the compact variant is a short strip for
 * the mobile header. Memoized so it re-renders only on route change, not on
 * health/unread poll updates.
 */
export const HeaderPixelScene = memo(function HeaderPixelScene({ path, compact = false }: HeaderPixelSceneProps) {
  const spec = compact ? compactSpec(specFor(path)) : specFor(path);
  return (
    <div
      className={`pointer-events-none relative w-full select-none ${compact ? 'h-12' : 'h-[4.5rem]'}`}
      aria-hidden="true"
    >
      {spec.map((item, i) => (
        <div
          key={i}
          className="absolute"
          style={
            item.top !== undefined
              ? { left: `${item.left}%`, top: item.top }
              : { left: `${item.left}%`, bottom: GROUND_H }
          }
        >
          <Sprite
            {...item.art}
            scale={item.scale ?? 4}
            className={item.cls}
            style={item.delay ? { animationDelay: item.delay } : undefined}
          />
        </div>
      ))}
      {/* Ground strip: grass over dirt, spanning the full panorama width. */}
      <div
        className="absolute inset-x-0 bottom-0 rounded-full"
        style={{ height: GROUND_H, background: '#3f7d4e' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 rounded-full"
        style={{ height: 3, background: '#2e5c3a' }}
      />
    </div>
  );
});

export default HeaderPixelScene;
