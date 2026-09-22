import { memo, type ReactNode } from 'react';

/**
 * PixelScene — playful retro pixel-art vignettes that fill the empty middle
 * of the shell header. Each route gets its own tiny themed scene (a chibi
 * character or two plus a themed prop), hand-drawn as character grids and
 * rendered as crisp SVG rects, so they scale cleanly and cost nothing to
 * load (no image assets, no network).
 *
 * Grid format: array of equal-ish-length strings; each char is a palette
 * key, '.' is transparent. Animations are pure CSS (see "Pixel scenes" in
 * index.css) and honor prefers-reduced-motion.
 */

type Grid = string[];
type Palette = Record<string, string>;

// ── Shared colors ──
const OUT = '#10192b'; // near-black outline used across sprites
const SKIN = '#f2c39b';
const EYE = '#1c2030';

interface SpriteProps {
  grid: Grid;
  palette: Palette;
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

// ── Chibi people (big head, tiny body — matches the reference style) ──

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

function chibi({ hair, shirt, pants = '#3b4663', hat = 'none', hatColor = '#e8b93c', wave = false }: ChibiOptions) {
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

const HOUSE = {
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

const SUN = {
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

const BOLT = {
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

const BATTERY = {
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

const ROOMBA = {
  grid: [
    '..RRRRRRRR..',
    '.RRRRRRRRRR.',
    'RRRRLLRRRRRR',
    'RRRRRRRRRRRR',
    '.DD......DD.',
  ],
  palette: { R: '#4a5670', L: '#5ad48a', D: OUT },
};

const CAT = {
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

const DUST = {
  grid: ['S.', '.S', 'S.'],
  palette: { S: '#9aa5b8' },
};

const ROUTER = {
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

const BELL = {
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

const WRENCH = {
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

const TOOLBOX = {
  grid: [
    '..NNNN..',
    'RRRRRRRR',
    'RRRRRRRR',
    'RRRRRRRR',
  ],
  palette: { N: '#9aa5b8', R: '#c95b4a' },
};

const GIFT = {
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

const SPARKLE = {
  grid: ['..S..', '..S..', 'SSSSS', '..S..', '..S..'],
  palette: { S: '#ffd23e' },
};

const BUG = {
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

const TERMINAL = {
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

const SCROLL = {
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

const IDCARD = {
  grid: [
    'BBBBBBBBBB',
    'BWWBGGGGGB',
    'BWWBGKGKGB',
    'BWWBGGGGGB',
    'BBBBBBBBBB',
  ],
  palette: { B: '#4a5670', W: SKIN, G: '#8fd3f4', K: '#1c2030' },
};

const GEAR = {
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

/** Wrapper that spaces the sprites and aligns them on a common baseline. */
function Scene({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none flex select-none items-end gap-4" aria-hidden="true">
      {children}
    </div>
  );
}

function sceneFor(path: string): ReactNode {
  if (path.startsWith('/utility')) {
    return (
      <Scene>
        <Sprite {...BOLT} className="px-flicker" />
        <Sprite {...WORKER} className="px-bob" />
        <Sprite {...BATTERY} className="px-bob-slow" style={{ animationDelay: '0.6s' }} />
      </Scene>
    );
  }
  if (path.startsWith('/roomba')) {
    return (
      <Scene>
        <Sprite {...CAT} className="px-bob-slow" />
        <div className="px-drive flex items-end gap-1">
          <Sprite {...DUST} className="px-twinkle" />
          <Sprite {...ROOMBA} />
        </div>
      </Scene>
    );
  }
  if (path.startsWith('/wifi')) {
    return (
      <Scene>
        <Sprite {...ROUTER} className="px-pulse" />
        <Sprite {...CAPGUY} className="px-bob" />
      </Scene>
    );
  }
  if (path.startsWith('/notifications')) {
    return (
      <Scene>
        <Sprite {...BELL} className="px-swing" scale={4} />
        <Sprite {...DARK} className="px-bob" />
      </Scene>
    );
  }
  if (path.startsWith('/users')) {
    return (
      <Scene>
        <Sprite {...GREEN} className="px-bob" />
        <Sprite {...RED} className="px-bob" style={{ animationDelay: '0.4s' }} />
        <Sprite {...DARK} className="px-bob" style={{ animationDelay: '0.8s' }} />
      </Scene>
    );
  }
  if (path.startsWith('/maintenance')) {
    return (
      <Scene>
        <Sprite {...WRENCH} className="px-swing" scale={4} />
        <Sprite {...WORKER} className="px-bob" />
        <Sprite {...TOOLBOX} className="px-bob-slow" style={{ animationDelay: '0.5s' }} />
      </Scene>
    );
  }
  if (path.startsWith('/updates')) {
    return (
      <Scene>
        <Sprite {...SPARKLE} className="px-twinkle" />
        <Sprite {...GIFT} className="px-bob" scale={4} />
        <Sprite {...RED} className="px-bob" style={{ animationDelay: '0.3s' }} />
        <Sprite {...SPARKLE} className="px-twinkle" style={{ animationDelay: '0.7s' }} />
      </Scene>
    );
  }
  if (path.startsWith('/profile')) {
    return (
      <Scene>
        <Sprite {...BRYAN} className="px-bob" />
        <Sprite {...GEAR} className="px-spin-slow" scale={4} />
      </Scene>
    );
  }
  if (path.startsWith('/admin/guests')) {
    return (
      <Scene>
        <Sprite {...IDCARD} className="px-bob-slow" scale={4} />
        <Sprite {...GREEN} className="px-bob" />
      </Scene>
    );
  }
  if (path.startsWith('/admin/debug')) {
    return (
      <Scene>
        <Sprite {...TERMINAL} className="px-pulse" scale={4} />
        <Sprite {...BUG} className="px-bob" scale={4} />
      </Scene>
    );
  }
  if (path.startsWith('/admin/logs')) {
    return (
      <Scene>
        <Sprite {...SCROLL} className="px-bob-slow" scale={4} />
        <Sprite {...DARK} className="px-bob" />
      </Scene>
    );
  }
  // Home (default): sun, house with a waving Bryan out front.
  return (
    <Scene>
      <Sprite {...SUN} className="px-spin-slow" scale={4} />
      <Sprite {...HOUSE} className="px-bob-slow" />
      <Sprite {...BRYAN} className="px-bob" />
    </Scene>
  );
}

interface HeaderPixelSceneProps {
  path: string;
}

/**
 * Route-aware pixel scene for the shell header. Rendered only on lg+ (the
 * header middle is empty there); memoized so it re-renders only on route
 * change, not on health/unread poll updates.
 */
export const HeaderPixelScene = memo(function HeaderPixelScene({ path }: HeaderPixelSceneProps) {
  return <>{sceneFor(path)}</>;
});

export default HeaderPixelScene;
