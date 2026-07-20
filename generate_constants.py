"""Regenerate constants.ts from Golden's measured reflectance dataset.

Reads 'Reflectance Data for Golden HB 10 mil Drawdowns over White.xlsx'
(78 Heavy Body paints, %R at 400-700nm / 10nm, measured D65 / CIE 1964
10-degree observer over a white Leneta card) and emits:

  - constants.ts                     31-band reflectance + pigment metadata
  - scripts/golden_lab_fixture.json  published Lab per paint (validation fixture)

Whites: the Golden dataset contains no Titanium/Zinc White, so both are
synthesized from Scott Allen Burns' measured Titanium White acrylic
reflectance curve (scottburns.us, CC BY-SA) fitted so their D65/10-deg Lab
matches Golden's published CIELAB values (10 mil thin film section of
'Golden CIELAB Values.csv').

Colorimetry here mirrors services/colorimetry.ts exactly: CIE 1964 10-deg
CMFs x D65, rectangular summation 400-700/10nm, self-consistent white point.
The script verifies it reproduces the spreadsheet's own Lab columns (expected
mean dE76 ~0.04) before writing anything.
"""
import json
import math
import os
import sys

import numpy as np
import openpyxl
from scipy.optimize import minimize

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, "Reflectance Data for Golden HB 10 mil Drawdowns over White.xlsx")
CSV = os.path.join(HERE, "Golden CIELAB Values.csv")

WL = np.arange(400, 701, 10)  # 31 bands

# CIE 1964 10-degree standard observer CMFs, 400-700nm / 10nm (colour-science)
CMF_10DEG = np.array([
    [0.019110, 0.002004, 0.086011], [0.084736, 0.008756, 0.389366],
    [0.204492, 0.021391, 0.972542], [0.314679, 0.038676, 1.553480],
    [0.383734, 0.062077, 1.967280], [0.370702, 0.089456, 1.994800],
    [0.302273, 0.128201, 1.745370], [0.195618, 0.185190, 1.317560],
    [0.080507, 0.253589, 0.772125], [0.016172, 0.339133, 0.415254],
    [0.003816, 0.460777, 0.218502], [0.037465, 0.606741, 0.112044],
    [0.117749, 0.761757, 0.060709], [0.236491, 0.875211, 0.030451],
    [0.376772, 0.961988, 0.013676], [0.529826, 0.991761, 0.003988],
    [0.705224, 0.997340, 0.000000], [0.878655, 0.955552, 0.000000],
    [1.014160, 0.868934, 0.000000], [1.118520, 0.777405, 0.000000],
    [1.123990, 0.658341, 0.000000], [1.030480, 0.527963, 0.000000],
    [0.856297, 0.398057, 0.000000], [0.647467, 0.283493, 0.000000],
    [0.431567, 0.179828, 0.000000], [0.268329, 0.107633, 0.000000],
    [0.152568, 0.060281, 0.000000], [0.081261, 0.031800, 0.000000],
    [0.040851, 0.015905, 0.000000], [0.019941, 0.007749, 0.000000],
    [0.009577, 0.003718, 0.000000],
])

D65 = np.array([
    82.7549, 91.4860, 93.4318, 86.6823, 104.8650, 117.0080, 117.8120, 114.8610,
    115.9230, 108.8110, 109.3540, 107.8020, 104.7900, 107.6890, 104.4050, 104.0460,
    100.0000, 96.3342, 95.7880, 88.6856, 90.0062, 89.5991, 87.6987, 83.2886,
    83.6992, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091,
])

W_D65 = CMF_10DEG * D65[:, None]                # 31x3 weighting table
K_NORM = 100.0 / W_D65[:, 1].sum()
WHITE_POINT = K_NORM * W_D65.sum(axis=0)        # self-consistent [Xn, Yn, Zn]


def reflectance_to_xyz(refl):
    return K_NORM * (W_D65 * np.asarray(refl)[:, None]).sum(axis=0)


def xyz_to_lab(xyz):
    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    fx, fy, fz = (f(c / n) for c, n in zip(xyz, WHITE_POINT))
    return np.array([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)])


def lab_to_hex(lab):
    """Lab (D65/10-deg white) -> sRGB hex via the standard matrix, clipped."""
    L, a, b = lab
    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200

    def finv(t):
        return t ** 3 if t ** 3 > 216 / 24389 else (116 * t - 16) * 27 / 24389
    xyz = np.array([finv(fx), finv(fy), finv(fz)]) * WHITE_POINT / 100.0
    m = np.array([
        [3.2406, -1.5372, -0.4986],
        [-0.9689, 1.8758, 0.0415],
        [0.0557, -0.2040, 1.0570],
    ])
    rgb = m @ xyz

    def gamma(c):
        c = min(1.0, max(0.0, c))
        return 1.055 * c ** (1 / 2.4) - 0.055 if c > 0.0031308 else 12.92 * c
    r, g, bl = (round(gamma(c) * 255) for c in rgb)
    return f"#{r:02X}{g:02X}{bl:02X}"


def de76(l1, l2):
    return float(np.linalg.norm(np.asarray(l1) - np.asarray(l2)))


# ---------------------------------------------------------------------------
# Pigment metadata: xlsx display name -> (id, curated name, colour-index code)
# ---------------------------------------------------------------------------
PIGMENTS = {
    'Alizarin Crimson Hue': ('pr177', 'Alizarin Crimson Hue', 'PR 177'),
    'Anthraquinone Blue': ('pb60', 'Anthraquinone Blue', 'PB 60'),
    'Bismuth Vanadate Yellow': ('py184', 'Bismuth Vanadate Yellow', 'PY 184'),
    'Bone Black': ('pbk9', 'Bone Black', 'PBk 9'),
    'Burnt Sienna': ('pr101', 'Burnt Sienna', 'PR 101'),
    'Burnt Umber': ('pbr7_burnt', 'Burnt Umber', 'PBr 7'),
    'Cad Red Medium': ('pr108', 'Cadmium Red Medium', 'PR 108'),
    'Cad Yellow Medium': ('py35', 'Cadmium Yellow Medium', 'PY 35'),
    'Cadmium Orange': ('po20', 'Cadmium Orange', 'PO 20'),
    'Carbon Black': ('pbk7', 'Carbon Black', 'PBk 7'),
    'Cerulean Blue Chromium': ('pb36', 'Cerulean Blue Chromium', 'PB 36'),
    'Chromium Oxide': ('pg17', 'Chromium Oxide Green', 'PG 17'),
    'Cobalt Blue': ('pb28', 'Cobalt Blue', 'PB 28'),
    'Cobalt Green': ('pg50', 'Cobalt Green', 'PG 50'),
    'Diarylide Yellow': ('py83', 'Diarylide Yellow', 'PY 83'),
    'Dioxazine Purple': ('pv23', 'Dioxazine Purple', 'PV 23'),
    'Hansa Yellow Light': ('py3', 'Hansa Yellow Light', 'PY 3'),
    'Hansa Yellow Medium': ('py73', 'Hansa Yellow Medium', 'PY 73'),
    'Napthol red Light': ('pr112', 'Naphthol Red Light', 'PR 112'),
    'Paynes Gray': ('pg_mix', 'Paynes Gray', 'PB 29 / PBk 9'),
    'Phthalo Blue GS': ('pb15', 'Phthalo Blue (Green Shade)', 'PB 15:4'),
    'Phthalo Green BS': ('pg7', 'Phthalo Green (Blue Shade)', 'PG 7'),
    'Phthalo Green YS': ('pg36', 'Phthalo Green (Yellow Shade)', 'PG 36'),
    'Pyrrole Red': ('pr254', 'Pyrrole Red', 'PR 254'),
    'Quin Magenta': ('pr122', 'Quinacridone Magenta', 'PR 122'),
    'Quin Red': ('pv19', 'Quinacridone Red', 'PV 19'),
    'Raw Sienna': ('pbr7_sienna', 'Raw Sienna', 'PBr 7'),
    'Raw Umber': ('pbr7_raw', 'Raw Umber', 'PBr 7'),
    'Titan Buff': ('pw6_buff', 'Titan Buff', 'PW 6:1'),
    'Ultramarine Blue': ('pb29', 'Ultramarine Blue', 'PB 29'),
    'Yellow Ochre': ('py43', 'Yellow Ochre', 'PY 43'),
    'Azurite Hue': ('pb_azurite', 'Azurite Hue', 'PB Mix'),
    'Burnt Umber Light': ('pbr7_burnt_lt', 'Burnt Umber Light', 'PBr 7'),
    'Cad Red Dark': ('pr108_dk', 'Cadmium Red Dark', 'PR 108'),
    'Cad Red Light': ('pr108_lt', 'Cadmium Red Light', 'PR 108'),
    'Cad Yellow Dark': ('py35_dk', 'Cadmium Yellow Dark', 'PY 35'),
    'cad yellow Primrose': ('py35_prim', 'Cadmium Yellow Primrose', 'PY 35'),
    'Cadmium Yellow Light': ('py35_lt', 'Cadmium Yellow Light', 'PY 35'),
    'Cerulean Blue Deep': ('pb36_deep', 'Cerulean Blue Deep', 'PB 36'),
    'Chromium Oxide Dark': ('pg17_dk', 'Chromium Oxide Green Dark', 'PG 17'),
    'Cobalt Teal': ('pg50_teal', 'Cobalt Teal', 'PG 50'),
    'Cobalt Titanate Green': ('pg50_titan', 'Cobalt Titanate Green', 'PG 50'),
    'Cobalt Turquoise': ('pg50_turq', 'Cobalt Turquoise', 'PG 50'),
    'Green Gold': ('py129', 'Green Gold', 'PY 129'),
    'Hookers Green Hue': ('pg_hook', 'Hookers Green Hue', 'PG Mix'),
    'Indian Yellow Hue': ('py_indian', 'Indian Yellow Hue', 'PY Mix'),
    'Jenkins Green': ('pg_jenk', 'Jenkins Green', 'PG Mix'),
    'Manganese Blue Hue': ('pb_mang', 'Manganese Blue Hue', 'PB Mix'),
    'Mars Black': ('pbk11', 'Mars Black', 'PBk 11'),
    'Mars yellow': ('py42', 'Mars Yellow', 'PY 42'),
    'Napthol Red Medium': ('pr112_med', 'Naphthol Red Medium', 'PR 112'),
    'Nickel Azo Yellow': ('py150', 'Nickel Azo Yellow', 'PY 150'),
    'Perm Green Light': ('pg7_lt', 'Permanent Green Light', 'PG 7'),
    'Permanent Maroon': ('pr179', 'Permanent Maroon', 'PR 179'),
    'Permanent Violet Dark': ('pv23_dk', 'Permanent Violet Dark', 'PV 23'),
    'Phthalo Blue RS': ('pb15_rs', 'Phthalo Blue (Red Shade)', 'PB 15:1'),
    'Prussian Blue Hue': ('pb27', 'Prussian Blue Hue', 'PB 27'),
    'Pyrrole Orange': ('po73', 'Pyrrole Orange', 'PO 73'),
    'Pyrrole Red Dark': ('pr254_dk', 'Pyrrole Red Dark', 'PR 254'),
    'Pyrrole Red Light': ('pr254_lt', 'Pyrrole Red Light', 'PR 254'),
    'Quin Burnt Orange': ('po49', 'Quinacridone Burnt Orange', 'PO 49'),
    'Quin Crimson': ('pr206', 'Quinacridone Crimson', 'PR 206'),
    'Quin Nickel Azo': ('py150_qn', 'Quinacridone Nickel Azo', 'PY 150 / PO 48'),
    'Quin Red Light': ('pv19_lt', 'Quinacridone Red Light', 'PV 19'),
    'Quin Violet': ('pv19_vio', 'Quinacridone Violet', 'PV 19'),
    'Red Oxide': ('pr101_ox', 'Red Oxide', 'PR 101'),
    'Sap Green Hue': ('pg_sap', 'Sap Green Hue', 'PG Mix'),
    'Terre Verte Hue': ('pg_terre', 'Terre Verte Hue', 'PG Mix'),
    'Titanate Yellow': ('py53', 'Titanate Yellow', 'PY 53'),
    'Transparent Brown Iron Oxide': ('pbr7_trans', 'Transparent Brown Iron Oxide', 'PBr 7'),
    'Transparent Pyrrole Orange': ('po73_trans', 'Transparent Pyrrole Orange', 'PO 73'),
    'Transparent Red Iron Oxide': ('pr101_trans', 'Transparent Red Iron Oxide', 'PR 101'),
    'Transparent Yellow Iron Oxide': ('py42_trans', 'Transparent Yellow Iron Oxide', 'PY 42'),
    'Turquoise': ('pb_turq', 'Turquoise', 'PB Mix'),
    'Van Dyke Brown Hue': ('pbr_vd', 'Van Dyke Brown Hue', 'PBr Mix'),
    'Violet Oxide': ('pr101_vio', 'Violet Oxide', 'PR 101'),
    'Viridian Green Hue': ('pg18', 'Viridian Green Hue', 'PG 18'),
    'Yellow Oxide': ('py42_ox', 'Yellow Oxide', 'PY 42'),
}

# Display order: whites, blacks/neutrals, earths, yellows, oranges, reds,
# violets, blues, greens (matches the previous hand-grouped constants.ts).
DISPLAY_ORDER = [
    'pw6', 'pw4', 'pw6_buff',
    'pbk9', 'pbk7', 'pbk11', 'pg_mix',
    'pbr7_raw', 'pbr7_burnt', 'pbr7_burnt_lt', 'pbr7_sienna', 'pr101', 'py43',
    'py42', 'py42_ox', 'pr101_ox', 'pr101_vio', 'pbr7_trans', 'pr101_trans',
    'py42_trans', 'pbr_vd',
    'py3', 'py73', 'py35_lt', 'py35', 'py35_dk', 'py35_prim', 'py184', 'py83',
    'py53', 'py150', 'py129',
    'po20', 'po73', 'po73_trans', 'py_indian',
    'pr254', 'pr254_lt', 'pr254_dk', 'pr108_lt', 'pr108', 'pr108_dk', 'pr112',
    'pr112_med', 'pv19', 'pv19_lt', 'pr122', 'pr177', 'pr206', 'po49',
    'py150_qn', 'pr179',
    'pv23', 'pv23_dk', 'pv19_vio',
    'pb29', 'pb15', 'pb15_rs', 'pb28', 'pb36', 'pb36_deep', 'pb60', 'pb27',
    'pb_azurite', 'pb_mang', 'pb_turq',
    'pg7', 'pg36', 'pg17', 'pg17_dk', 'pg50', 'pg50_teal', 'pg50_titan',
    'pg50_turq', 'pg7_lt', 'pg18', 'pg_sap', 'pg_hook', 'pg_jenk', 'pg_terre',
]

GROUP_LABELS = {
    'pw6': 'WHITES', 'pbk9': 'BLACKS & NEUTRALS', 'pbr7_raw': 'EARTHS',
    'py3': 'YELLOWS', 'po20': 'ORANGES', 'pr254': 'REDS', 'pv23': 'VIOLETS',
    'pb29': 'BLUES', 'pg7': 'GREENS',
}

BASE_IDS = {'pw6', 'pw4', 'pbk9', 'pbk7', 'pbk11'}

# ---------------------------------------------------------------------------
# Relative scattering weights for pseudo two-constant K-M mixing.
# S_mix = sum(c_i * s_i), K_mix = sum(c_i * s_i * (K/S)_i); Titanium White is
# the scattering reference (s = 1.0). Classes follow pigment chemistry and
# Golden's opacity ratings: opaque inorganics scatter strongly, transparent
# organics barely at all. These are calibration knobs, not measurements —
# masstone predictions are unaffected by them (only mixing paths change).
# ---------------------------------------------------------------------------
S_OPAQUE = 0.65        # cadmiums, oxides, cobalts, chromium, titanate
S_SEMI = 0.45          # ultramarine, bone black, most convenience mixes
S_TRANSPARENT = 0.25   # phthalos, quins, hansas, pyrroles, dioxazine...
SCATTERING = {
    'pw6': 1.0, 'pw4': 0.30, 'pw6_buff': 0.80,
    'pbk9': 0.45, 'pbk7': 0.22, 'pbk11': 0.60, 'pg_mix': 0.45,
    'pbr7_raw': S_OPAQUE, 'pbr7_burnt': S_OPAQUE, 'pbr7_burnt_lt': S_OPAQUE,
    'pbr7_sienna': S_OPAQUE, 'pr101': S_OPAQUE, 'py43': S_OPAQUE,
    'py42': S_OPAQUE, 'py42_ox': S_OPAQUE, 'pr101_ox': S_OPAQUE,
    'pr101_vio': S_OPAQUE, 'pbr7_trans': 0.22, 'pr101_trans': 0.22,
    'py42_trans': 0.22, 'pbr_vd': S_SEMI,
    'py3': S_TRANSPARENT, 'py73': S_TRANSPARENT, 'py35_lt': S_OPAQUE,
    'py35': S_OPAQUE, 'py35_dk': S_OPAQUE, 'py35_prim': S_OPAQUE,
    'py184': S_OPAQUE, 'py83': S_TRANSPARENT, 'py53': S_OPAQUE,
    'py150': S_TRANSPARENT, 'py129': S_TRANSPARENT,
    'po20': S_OPAQUE, 'po73': 0.35, 'po73_trans': S_TRANSPARENT,
    'py_indian': S_SEMI,
    'pr254': 0.35, 'pr254_lt': 0.35, 'pr254_dk': 0.35,
    'pr108_lt': S_OPAQUE, 'pr108': S_OPAQUE, 'pr108_dk': S_OPAQUE,
    'pr112': 0.30, 'pr112_med': 0.30,
    'pv19': S_TRANSPARENT, 'pv19_lt': S_TRANSPARENT, 'pr122': S_TRANSPARENT,
    'pr177': S_TRANSPARENT, 'pr206': S_TRANSPARENT, 'po49': S_TRANSPARENT,
    'py150_qn': S_TRANSPARENT, 'pr179': S_TRANSPARENT,
    'pv23': S_TRANSPARENT, 'pv23_dk': S_TRANSPARENT, 'pv19_vio': S_TRANSPARENT,
    'pb29': S_SEMI, 'pb15': S_TRANSPARENT, 'pb15_rs': S_TRANSPARENT,
    'pb28': S_OPAQUE, 'pb36': S_OPAQUE, 'pb36_deep': S_OPAQUE,
    'pb60': S_TRANSPARENT, 'pb27': S_TRANSPARENT, 'pb_azurite': S_SEMI,
    'pb_mang': S_SEMI, 'pb_turq': S_SEMI,
    'pg7': S_TRANSPARENT, 'pg36': S_TRANSPARENT, 'pg17': S_OPAQUE,
    'pg17_dk': S_OPAQUE, 'pg50': S_OPAQUE, 'pg50_teal': S_OPAQUE,
    'pg50_titan': S_OPAQUE, 'pg50_turq': S_OPAQUE, 'pg7_lt': 0.30,
    'pg18': S_SEMI, 'pg_sap': 0.25, 'pg_hook': 0.25, 'pg_jenk': 0.25,
    'pg_terre': S_SEMI,
}

# ---------------------------------------------------------------------------
# Load measured data
# ---------------------------------------------------------------------------
wb = openpyxl.load_workbook(XLSX, read_only=True)
rows = list(wb['Sheet1'].iter_rows(values_only=True))

refl = {}           # id -> 31-band reflectance (fraction)
published_lab = {}  # id -> published Lab from the spreadsheet
for row in rows[2:]:
    if row[0] is None or not row[1]:
        continue
    name = str(row[1]).strip()
    if name not in PIGMENTS:
        print(f'WARNING: unmapped paint in xlsx: {name!r}')
        continue
    pid = PIGMENTS[name][0]
    r = np.array([row[6 + i] for i in range(31)], dtype=float) / 100.0
    refl[pid] = r
    published_lab[pid] = [float(row[2]), float(row[3]), float(row[4])]

print(f'Loaded {len(refl)} measured paints from xlsx')

# ---------------------------------------------------------------------------
# Verify colorimetry chain against the spreadsheet's own Lab columns
# ---------------------------------------------------------------------------
errs = {pid: de76(xyz_to_lab(reflectance_to_xyz(r)), published_lab[pid])
        for pid, r in refl.items()}
errs_v = np.array(list(errs.values()))
print(f'Masstone Lab reproduction: mean dE76 {errs_v.mean():.4f}, '
      f'median {np.median(errs_v):.4f}, max {errs_v.max():.4f}')
assert errs_v.mean() < 0.1 and errs_v.max() < 0.5, 'colorimetry chain mismatch!'

# ---------------------------------------------------------------------------
# Synthesize whites (missing from the dataset)
# ---------------------------------------------------------------------------
# Scott Allen Burns' measured Titanium White acrylic reflectance, 400-700nm
# slice of the 380-730nm curve published at scottburns.us (CC BY-SA).
BURNS_TIW = np.array([
    0.3886, 0.6489, 0.8518, 0.9362, 0.9568, 0.9625, 0.9673, 0.9678, 0.9677,
    0.9694, 0.9691, 0.9691, 0.9701, 0.9692, 0.9692, 0.9693, 0.9668, 0.9695,
    0.9679, 0.9676, 0.9671, 0.9673, 0.9673, 0.9655, 0.9661, 0.9676, 0.9700,
    0.9694, 0.9680, 0.9678, 0.9692,
])
# ZnO variant: same flat plateau but a sharper, earlier UV absorption edge.
ZNO_BASE = 0.97 / (1 + np.exp(-(WL - 385) / 9.0))

# Golden's published thin-film (10 mil) CIELAB values for the whites.
WHITE_TARGETS = {
    'pw6': ([98.28, -0.90, 1.67], BURNS_TIW),
    'pw4': ([95.83, -0.49, 0.56], ZNO_BASE),
}


def fit_white(target_lab, base):
    """Scale/offset/tilt a base curve so its D65/10-deg Lab hits target_lab."""
    def curve(p):
        alpha, beta, gamma = p
        return np.clip(alpha * base + beta + gamma * (WL - 550) / 150.0,
                       1e-4, 0.9999)

    def cost(p):
        return de76(xyz_to_lab(reflectance_to_xyz(curve(p))), target_lab) ** 2

    best = min(
        (minimize(cost, x0, method='Nelder-Mead',
                  options={'xatol': 1e-7, 'fatol': 1e-10, 'maxiter': 4000})
         for x0 in ([1.0, 0.0, 0.0], [0.95, 0.02, 0.0])),
        key=lambda r: r.fun,
    )
    return curve(best.x)


for pid, (target, base) in WHITE_TARGETS.items():
    r = fit_white(target, base)
    refl[pid] = r
    published_lab[pid] = target
    got = xyz_to_lab(reflectance_to_xyz(r))
    print(f'{pid}: fitted white Lab ({got[0]:.2f}, {got[1]:.2f}, {got[2]:.2f}) '
          f'vs target {target}  dE76 {de76(got, target):.4f}')

missing = [pid for pid in DISPLAY_ORDER if pid not in refl]
assert not missing, f'missing spectra for: {missing}'

# ---------------------------------------------------------------------------
# Fully-opaque calibration (ported from branch claude/paint-unmix-accuracy-xcy5er)
#
# The drawdown spectra are NOT opaque masstones — the white card shows through
# transparent paints, understating their true absorption. Golden's CIELAB
# workbook has a second section, "6mm Fully Opaque" (specular EXCLUDED — darks
# reach L* ≈ 5, below the drawdowns' ~3.7% gloss floor). We fit one scalar γ
# per pigment so that R∞(γ · K/S_internal), pushed through a specular-excluded
# Saunderson forward, reproduces the measured fully-opaque colour. γ > 1 means
# card show-through (transparent pigment); a free per-wavelength (k, s) fit is
# NOT identifiable from this data pair and collapses tinting strength — the
# hard-won lesson from the earlier calibration work. s stays 1 for chromatics;
# whites get a finite-thickness film fit (L*-only: the 6mm casting's b* is
# polluted by binder yellowing) that also yields zinc's relative scattering.
# ---------------------------------------------------------------------------
SAUNDERSON_K1 = 0.03
SAUNDERSON_K2 = 0.6
DE_EMIT_MAX = 8.0        # beyond this the two Golden datasets likely disagree
CARD_REFLECTANCE = 0.82  # white Leneta card, measured (specular included)

CIELAB_XLSX = os.path.join(HERE, 'Golden CIELAB Values.xlsx')

# Reflectance-sheet name -> CIELAB-sheet name (normalized lowercase)
CIELAB_ALIAS = {
    'bismuth vanadate yellow': 'bismuth vanadate',
    'cad red dark': 'cadmium red dark',
    'cad red light': 'cadmium red light',
    'cad red medium': 'cadmium red medium',
    'cad yellow dark': 'cadmium yellow dark',
    'cad yellow medium': 'cadmium yellow medium',
    'cad yellow primrose': 'cadmium yellow primrose',
    'perm green light': 'permanent green light',
    'phthalo blue gs': 'phthalo blue (green shade)',
    'phthalo blue rs': 'phthalo blue (red shade)',
    'phthalo green bs': 'phthalo green (blue shade)',
    'phthalo green ys': 'phthalo green (yellow shade)',
    'quin burnt orange': 'quinacridone burnt orange',
    'quin crimson': 'quinacridone crimson',
    'quin magenta': 'quinacridone magenta',
    'quin nickel azo': 'quinacridone nickel azo gold',
    'quin red': 'quinacridone red',
    'quin red light': 'quinacridone red light',
    'quin violet': 'quinacridone violet',
    'turquoise': 'turquoise (phthalo)',
}


def _norm(name):
    return ' '.join(str(name).strip().lower().split())


def load_cielab(path):
    """Golden CIELAB Values.xlsx -> ({name: lab} thin film, {name: lab} opaque)."""
    ws = openpyxl.load_workbook(path, read_only=True)['Sheet1']
    thin, opaque = {}, {}
    section = None
    for row in ws.iter_rows(values_only=True):
        vals = [c for c in row if c is not None]
        if not vals:
            continue
        head = str(vals[0])
        if head.startswith('10 mil'):
            section = thin
            continue
        if head.startswith('6mm'):
            section = opaque
            continue
        if head == 'Name' or section is None:
            continue
        if len(vals) >= 4 and all(isinstance(v, (int, float)) for v in vals[1:4]):
            section[_norm(vals[0])] = [float(v) for v in vals[1:4]]
    return thin, opaque


def lookup_cielab(name, table):
    n = _norm(name)
    for key in (n, CIELAB_ALIAS.get(n), 'c.p. ' + n):
        if key and key in table:
            return table[key]
    return None




def measured_to_internal(rm):
    r = (rm - SAUNDERSON_K1) / (1 - SAUNDERSON_K1 - SAUNDERSON_K2 * (1 - rm))
    return min(0.99999, max(1e-5, r))


def internal_to_spex(ri):
    """Saunderson forward with the specular component EXCLUDED (k1 = 0)."""
    return ((1 - SAUNDERSON_K2) * ri) / (1 - SAUNDERSON_K2 * ri)


def ks_from_r(r):
    return (1 - r) ** 2 / (2 * r)


def r_from_ks(ks):
    return 1 + ks - math.sqrt(ks * ks + 2 * ks)


def q31_of(pid):
    return np.array([ks_from_r(measured_to_internal(r)) for r in refl[pid]])


def predicted_opaque_lab(q31):
    r = [internal_to_spex(r_from_ks(q)) for q in q31]
    return xyz_to_lab(reflectance_to_xyz(r))


def fit_pigment_gamma(q31, opaque_lab):
    """Scalar γ so R∞(γ·q) matches the fully-opaque CIELAB (golden-section)."""
    def objective(g):
        return de76(predicted_opaque_lab(g * q31), opaque_lab)

    grid = [10 ** (e / 8.0) for e in range(-5, 14)]  # ~0.24 .. ~42
    best_i = min(range(len(grid)), key=lambda i: objective(grid[i]))
    lo = grid[max(0, best_i - 1)]
    hi = grid[min(len(grid) - 1, best_i + 1)]
    phi = (math.sqrt(5) - 1) / 2
    a, b = math.log(lo), math.log(hi)
    c, d = b - phi * (b - a), a + phi * (b - a)
    fc, fd = objective(math.exp(c)), objective(math.exp(d))
    for _ in range(40):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - phi * (b - a)
            fc = objective(math.exp(c))
        else:
            a, c, fc = c, d, fd
            d = a + phi * (b - a)
            fd = objective(math.exp(d))
    g = math.exp(0.5 * (a + b))
    return g, objective(g)


def film_reflectance(kx, sx, rg):
    """Internal reflectance of a film (absorption kX, scattering sX) over a
    backing of internal reflectance rg — Kubelka-Munk hyperbolic solution."""
    if sx < 1e-6:
        return rg * math.exp(-2 * kx)
    a = 1 + kx / sx
    b = math.sqrt(max(a * a - 1, 1e-12))
    bsx = b * sx
    if bsx > 30:
        return a - b
    coth = 1 / math.tanh(bsx) if bsx > 1e-9 else 1 / bsx
    return (1 - rg * (a - b * coth)) / (a - rg + b * coth)


def fit_white_film(q31, thin_L, opaque_L, rg):
    """Fit (α, s) for a white from its thin/opaque L* pair: at 10-mil film
    thickness over the card it must show thin_L, at complete hiding opaque_L.
    L*-only per the branch's finding (opaque b* polluted by binder yellowing)."""
    def objective(alpha, sx):
        kx31 = alpha * q31 * sx
        film = []
        for kx in kx31:
            ri = film_reflectance(kx, sx, rg)
            rm = SAUNDERSON_K1 + ((1 - SAUNDERSON_K1) * (1 - SAUNDERSON_K2) * ri) / (1 - SAUNDERSON_K2 * ri)
            film.append(rm)
        d = abs(xyz_to_lab(reflectance_to_xyz(film))[0] - thin_L)
        d += abs(predicted_opaque_lab(alpha * q31)[0] - opaque_L)
        return d

    best = (float('inf'), 1.0, 1.0)
    for ae in range(-24, 9):
        alpha = 10 ** (ae / 8.0)
        for se in range(0, 21):
            sx = 10 ** (se / 8.0)
            d = objective(alpha, sx)
            if d < best[0]:
                best = (d, alpha, sx)
    return best  # (err, alpha, sx)


thin_tbl, opaque_tbl = load_cielab(CIELAB_XLSX)
print(f'CIELAB workbook: {len(thin_tbl)} thin-film + {len(opaque_tbl)} fully-opaque rows')

xlsx_name_of = {PIGMENTS[n][0]: n for n in PIGMENTS}
calibration = {}   # pid -> {'g','s','cal','de_fit','de_naive'}
opaque_ref = {}    # pid -> 6mm opaque Lab (for the validation fixture)
fallbacks = []

for pid in DISPLAY_ORDER:
    if pid in ('pw6', 'pw4'):
        continue
    name = xlsx_name_of[pid]
    op_lab = lookup_cielab(name, opaque_tbl)
    if op_lab is None:
        calibration[pid] = {'g': 1.0, 's': 1.0, 'cal': False}
        fallbacks.append(f'{name} (no CIELAB row)')
        continue
    q31 = q31_of(pid)
    g, de_fit = fit_pigment_gamma(q31, op_lab)
    de_naive = de76(predicted_opaque_lab(q31), op_lab)
    opaque_ref[pid] = op_lab
    if de_fit > DE_EMIT_MAX:
        calibration[pid] = {'g': 1.0, 's': 1.0, 'cal': False}
        fallbacks.append(f'{name} (dE {de_fit:.1f})')
    else:
        calibration[pid] = {'g': round(g, 4), 's': 1.0, 'cal': True,
                            'de_fit': de_fit, 'de_naive': de_naive}

# Whites: finite-thickness film fit on the thin/opaque L* pair
rg = measured_to_internal(CARD_REFLECTANCE)
S_MIN, S_MAX = 0.05, 1.5
white_names = {'pw6': 'Titanium White', 'pw4': 'Zinc White'}
white_fits = {}
for pid, wname in white_names.items():
    thin_lab = lookup_cielab(wname, thin_tbl)
    op_lab = lookup_cielab(wname, opaque_tbl)
    assert thin_lab and op_lab, f'CIELAB rows missing for {wname}'
    err, alpha, sx = fit_white_film(q31_of(pid), thin_lab[0], op_lab[0], rg)
    white_fits[pid] = (err, alpha, sx)
    opaque_ref[pid] = op_lab

ti_err, ti_alpha, ti_sx = white_fits['pw6']
zn_err, zn_alpha, zn_sx = white_fits['pw4']
zn_rel = min(S_MAX, max(S_MIN, zn_sx / ti_sx))
calibration['pw6'] = {'g': round(ti_alpha, 4), 's': 1.0, 'cal': True}
calibration['pw4'] = {'g': round(zn_alpha, 4), 's': round(zn_rel, 3), 'cal': True}
print(f'whites: pw6 alpha={ti_alpha:.3f} (L* err {ti_err:.2f}); '
      f'pw4 alpha={zn_alpha:.3f} s_rel={zn_rel:.3f} (L* err {zn_err:.2f})')

cal_des = [c['de_fit'] for c in calibration.values() if c.get('de_fit') is not None]
print(f'opaque calibration: {len(cal_des)} chromatic paints fitted, '
      f'mean dE_fit {np.mean(cal_des):.2f}, max {np.max(cal_des):.2f}; '
      f'{len(fallbacks)} fallback(s)')
for f_ in fallbacks:
    print(f'  fallback: {f_}')
gammas = sorted((c['g'], pid) for pid, c in calibration.items() if c['cal'])
print(f'gamma range: {gammas[0][0]:.2f} ({gammas[0][1]}) .. {gammas[-1][0]:.2f} ({gammas[-1][1]})')

# ---------------------------------------------------------------------------
# Emit constants.ts
# ---------------------------------------------------------------------------
id_meta = {pid: (name, code) for _, (pid, name, code) in PIGMENTS.items()}
id_meta['pw6'] = ('Titanium White', 'PW 6')
id_meta['pw4'] = ('Zinc White', 'PW 4')

lines = []
lines.append("import { Pigment } from './types';")
lines.append('')
lines.append('// Golden Heavy Body Acrylics — measured 10 mil drawdowns over white Leneta')
lines.append('// card, 400–700 nm at 10 nm, D65 / CIE 1964 10° observer (78 paints).')
lines.append('// Titanium/Zinc White are synthesized: Scott Allen Burns’ measured TiW')
lines.append('// acrylic curve (scottburns.us, CC BY-SA), fitted to Golden’s published')
lines.append('// thin-film CIELAB for each white. Swatch hexes show each paint’s')
lines.append('// FULLY-OPAQUE appearance (γ-calibrated, specular excluded) — how the')
lines.append('// default mixing model renders 100% of that paint.')
lines.append('// GENERATED by generate_constants.py — edit that script, not this file.')
lines.append('')
lines.append('export const WAVELENGTHS = [')
lines.append('  ' + ', '.join(str(w) for w in WL) + ',')
lines.append('];')
lines.append('')
lines.append('export const AVAILABLE_PIGMENTS: Pigment[] = [')
for pid in DISPLAY_ORDER:
    if pid in GROUP_LABELS:
        lines.append(f'  // --- {GROUP_LABELS[pid]} ---')
    name, code = id_meta[pid]
    hex_color = lab_to_hex(predicted_opaque_lab(calibration[pid]['g'] * q31_of(pid)))
    base = 'true' if pid in BASE_IDS else 'false'
    lines.append(f"  {{ id: '{pid}', name: '{name}', code: '{code}', "
                 f"hex: '{hex_color}', isBase: {base} }},")
lines.append('];')
lines.append('')
lines.append('// Measured (or fitted, for the whites) spectral reflectance, fraction 0–1,')
lines.append('// 400–700 nm / 10 nm. This is the raw over-white measurement; Saunderson')
lines.append('// correction and K/S conversion happen in the physics engine.')
lines.append('export const SPECTRAL_R_DATA: Record<string, number[]> = {')
for pid in DISPLAY_ORDER:
    vals = ', '.join(f'{v:.5f}' for v in refl[pid])
    lines.append(f"  '{pid}': [{vals}],")
lines.append('};')
lines.append('')
lines.append('// Relative scattering weight per pigment (Titanium White = 1.0) for the')
lines.append('// pseudo two-constant mixing model: opaque inorganics ~0.65, semi-opaque')
lines.append('// ~0.45, transparent organics ~0.18. Calibration knobs — masstones are')
lines.append('// unaffected; only the path a mixture takes between endpoints changes.')
lines.append('export const SCATTERING_S: Record<string, number> = {')
row_buf = []
for i, pid in enumerate(DISPLAY_ORDER):
    row_buf.append(f"'{pid}': {SCATTERING[pid]:.2f}")
    if len(row_buf) == 4 or i == len(DISPLAY_ORDER) - 1:
        lines.append('  ' + ', '.join(row_buf) + ',')
        row_buf = []
lines.append('};')
lines.append('')
lines.append('// Fully-opaque calibration (γ per pigment, fitted against the "6mm Fully')
lines.append('// Opaque" section of Golden CIELAB Values.xlsx; specular-excluded output).')
lines.append('// g scales the internal masstone K/S; s is relative scattering (TiW = 1,')
lines.append('// chromatics 1 by the s=1 convention, zinc from the film fit). cal=false')
lines.append('// means the two Golden datasets disagree (ΔE > 8, likely formulation')
lines.append('// change) and the paint keeps the uncalibrated masstone fallback.')
lines.append('export const CALIBRATION: Record<string, { g: number; s: number; cal: boolean }> = {')
for pid in DISPLAY_ORDER:
    c = calibration[pid]
    cal = 'true' if c['cal'] else 'false'
    lines.append(f"  '{pid}': {{ g: {c['g']}, s: {c['s']}, cal: {cal} }},")
lines.append('};')
lines.append('')
lines.append('export const INITIAL_SPECTRAL_DATA = WAVELENGTHS.map(wl => ({')
lines.append('  wavelength: wl,')
lines.append('  targetReflectance: 0.5,')
lines.append('  mixReflectance: 0.5,')
lines.append('}));')
lines.append('')

out_ts = os.path.join(HERE, 'constants.ts')
with open(out_ts, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(lines))
print(f'Wrote {out_ts}')

# Validation fixture: published thin-film Lab, 6mm opaque Lab, calibration meta
os.makedirs(os.path.join(HERE, 'scripts'), exist_ok=True)
fixture = {}
for pid in DISPLAY_ORDER:
    entry = {'name': id_meta[pid][0],
             'lab': [round(v, 4) for v in published_lab[pid]],
             'gamma': calibration[pid]['g'],
             'calibrated': calibration[pid]['cal']}
    if pid in opaque_ref:
        entry['opaqueLab'] = [round(v, 4) for v in opaque_ref[pid]]
    fixture[pid] = entry
out_json = os.path.join(HERE, 'scripts', 'golden_lab_fixture.json')
with open(out_json, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(fixture, f, indent=1)
print(f'Wrote {out_json}')
