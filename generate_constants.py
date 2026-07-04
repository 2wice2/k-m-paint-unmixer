#!/usr/bin/env python3
"""Regenerate the optical data in constants.ts from Golden measurement data.

Modes
-----
1. Masstone only (original behaviour) — prints the pigment list and the
   masstone K/S table from the Golden 10-mil-over-white spreadsheet:

       python3 generate_constants.py \
           --masstone "Reflectance Data for Golden HB 10 mil Drawdowns over White.xlsx"

2. Two-constant fit — additionally reads tint measurements (paint mixed with
   Titanium White at known weight fractions) and fits per-wavelength
   absorption k and scattering s for every pigment, with s(Titanium White)=1.
   This is the fix for transparent pigments: their masstone-over-white
   drawdown is corrupted by the substrate showing through, but a tint with
   white is at complete hiding, so k and s recovered from tints are clean.

       python3 generate_constants.py --masstone <xlsx> --tints tints.csv --write constants.ts

   --write patches the block between the BEGIN/END GENERATED PIGMENT_KS_FIT
   markers in constants.ts in place; without it the block is printed.

   tints.csv format (header required, one row per tint drawdown):

       name,concentration,ks400,ks420,...,ks700        (16 K/S values)
   or  name,concentration,r400,r420,...,r700           (16 reflectances 0-1)

   `name` must match the paint name used in the masstone sheet (see
   PIGMENT_MAP below); `concentration` is the weight fraction of the colored
   paint in the paint+white mixture (e.g. 0.1 for 1:9 with white). Multiple
   rows per paint (different ratios) are encouraged — with >= 2 tints the fit
   uses least squares over the tints alone and ignores the masstone R-infinity
   assumption entirely.

3. Self-test — validates the fitting math on synthetic pigments with known
   k,s (no input files or openpyxl needed):

       python3 generate_constants.py --selftest
"""

import argparse
import csv
import json
import math
import re
import sys

# --- Saunderson surface-reflection correction (must match physicsEngine.ts) ---

SAUNDERSON_K1 = 0.03  # just below the dataset's 3.7% reflectance floor; must match physicsEngine.ts
SAUNDERSON_K2 = 0.6


def measured_to_internal(rm):
    num = rm - SAUNDERSON_K1
    den = (1 - SAUNDERSON_K1) * (1 - SAUNDERSON_K2) + SAUNDERSON_K2 * num
    return min(1.0, max(1e-4, num / den))


def ks_to_reflectance(ks):
    if ks > 5000:
        return 1e-4
    return 1 + ks - math.sqrt(ks * ks + 2 * ks)


def reflectance_to_ks(r):
    r = min(1.0, max(1e-4, r))
    return (1 - r) ** 2 / (2 * r)


def stored_ks_to_internal_ks(ks_stored):
    """Measured-over-white K/S column -> Saunderson-corrected internal K/S."""
    return reflectance_to_ks(measured_to_internal(ks_to_reflectance(ks_stored)))


def reflectance_to_internal_ks(r_measured):
    return reflectance_to_ks(measured_to_internal(r_measured))


# --- Two-constant fit ---------------------------------------------------------
#
# Model (all quantities per wavelength, internal/Saunderson-corrected units,
# unit-mass basis with s_white = 1):
#
#   (K/S)_tint = (c*k_p + (1-c)*k_w) / (c*s_p + (1-c)*s_w)
#
# which is linear in the unknowns (k_p, s_p):
#
#   c*k_p - KS_t*c*s_p = (1-c)*(KS_t*s_w - k_w)
#
# With >= 2 tint ratios we least-squares this system using tints only.
# With exactly 1 tint we add the masstone R-infinity relation k_p = KS_m * s_p
# as the second equation, giving the closed form
#
#   s_p = (1-c)*(k_w - KS_t) / (c*(KS_t - KS_m))

S_MIN, S_MAX = 0.002, 5.0


def fit_pigment_ks(ks_mass_internal, tints_internal, k_white, s_white=1.0):
    """Fit per-wavelength (k, s) for one pigment.

    ks_mass_internal: list[float]  internal K/S of the masstone drawdown
    tints_internal:   list[(c, list[float])]  concentration + internal K/S
    k_white:          list[float]  white's internal K/S (= its k, since s=1)
    Returns (k, s) lists.
    """
    n = len(ks_mass_internal)
    k_out, s_out = [], []
    for w in range(n):
        ks_m = ks_mass_internal[w]
        if len(tints_internal) >= 2:
            # Least squares over tints: rows [c, -KS_t*c] . [k_p, s_p] = rhs
            a11 = a12 = a22 = b1 = b2 = 0.0
            for c, ks_row in tints_internal:
                ks_t = ks_row[w]
                r1, r2 = c, -ks_t * c
                rhs = (1 - c) * (ks_t * s_white - k_white[w])
                a11 += r1 * r1
                a12 += r1 * r2
                a22 += r2 * r2
                b1 += r1 * rhs
                b2 += r2 * rhs
            det = a11 * a22 - a12 * a12
            if abs(det) < 1e-12:
                s_p = S_MIN
                k_p = ks_m * s_p
            else:
                k_p = (b1 * a22 - b2 * a12) / det
                s_p = (a11 * b2 - a12 * b1) / det
        else:
            c, ks_row = tints_internal[0]
            ks_t = ks_row[w]
            den = c * (ks_t - ks_m)
            if abs(den) < 1e-9:
                s_p = S_MIN
            else:
                s_p = (1 - c) * (k_white[w] - ks_t) / den
            k_p = ks_m * max(s_p, S_MIN)
        s_p = min(S_MAX, max(S_MIN, s_p))
        k_p = max(0.0, k_p)
        k_out.append(k_p)
        s_out.append(s_p)
    return k_out, s_out


# --- Self-test ------------------------------------------------------------------


def selftest():
    n = 16
    k_white = [0.002] * n
    synthetic = {
        # name: (k, s) per unit mass, s relative to white=1
        'opaque_red': ([4.0 * 0.6 if w < 8 else 0.02 * 0.6 for w in range(n)], [0.6] * n),
        'transparent_blue': ([0.15 if w < 4 else 3.0 * 0.04 for w in range(n)], [0.04] * n),
        'semi_earth': ([1.2 * 0.2] * n, [0.2] * n),
    }
    max_rel_err = 0.0
    for name, (k_true, s_true) in synthetic.items():
        # Masstone internal K/S under the R-infinity assumption:
        ks_mass = [k / s for k, s in zip(k_true, s_true)]
        for concs in ([0.1], [0.1, 0.25]):
            tints = []
            for c in concs:
                ks_t = [
                    (c * k_true[w] + (1 - c) * k_white[w]) / (c * s_true[w] + (1 - c) * 1.0)
                    for w in range(n)
                ]
                tints.append((c, ks_t))
            k_fit, s_fit = fit_pigment_ks(ks_mass, tints, k_white)
            for w in range(n):
                if k_true[w] > 1e-6:
                    max_rel_err = max(max_rel_err, abs(k_fit[w] - k_true[w]) / k_true[w])
                max_rel_err = max(max_rel_err, abs(s_fit[w] - s_true[w]) / s_true[w])
    assert max_rel_err < 1e-9, f"self-test failed: max relative error {max_rel_err}"
    print(f"self-test OK: k,s recovered exactly (max rel err {max_rel_err:.2e}) "
          f"for {len(synthetic)} synthetic pigments x 1-tint and 2-tint fits")


# --- Spreadsheet / CSV parsing --------------------------------------------------

KS_COL_START = 38
INDICES_20NM = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]

PIGMENT_MAP = {
    'Alizarin Crimson Hue': ('pr177', 'PR 177'),
    'Anthraquinone Blue': ('pb60', 'PB 60'),
    'Bismuth Vanadate Yellow': ('py184', 'PY 184'),
    'Bone Black': ('pbk9', 'PBk 9'),
    'Burnt Sienna': ('pr101', 'PR 101'),
    'Burnt Umber': ('pbr7_burnt', 'PBr 7'),
    'Cad Red Medium': ('pr108', 'PR 108'),
    'Cad Yellow Medium': ('py35', 'PY 35'),
    'Cadmium Orange': ('po20', 'PO 20'),
    'Carbon Black': ('pbk7', 'PBk 7'),
    'Cerulean Blue Chromium': ('pb36', 'PB 36'),
    'Chromium Oxide': ('pg17', 'PG 17'),
    'Cobalt Blue': ('pb28', 'PB 28'),
    'Cobalt Green': ('pg50', 'PG 50'),
    'Diarylide Yellow': ('py83', 'PY 83'),
    'Dioxazine Purple': ('pv23', 'PV 23'),
    'Hansa Yellow Light': ('py3', 'PY 3'),
    'Hansa Yellow Medium': ('py73', 'PY 73'),
    'Napthol red Light': ('pr112', 'PR 112'),
    'Paynes Gray': ('pg_mix', 'PB 29 / PBk 9'),
    'Phthalo Blue GS': ('pb15', 'PB 15:4'),
    'Phthalo Green BS': ('pg7', 'PG 7'),
    'Phthalo Green YS': ('pg36', 'PG 36'),
    'Pyrrole Red': ('pr254', 'PR 254'),
    'Quin Magenta': ('pr122', 'PR 122'),
    'Quin Red': ('pv19', 'PV 19'),
    'Raw Sienna': ('pbr7_sienna', 'PBr 7'),
    'Raw Umber': ('pbr7_raw', 'PBr 7'),
    'Titan Buff': ('pw6_buff', 'PW 6:1'),
    'Ultramarine Blue': ('pb29', 'PB 29'),
    'Yellow Ochre': ('py43', 'PY 43'),
    'Azurite Hue': ('pb_azurite', 'PB Mix'),
    'Burnt Umber Light': ('pbr7_burnt_lt', 'PBr 7'),
    'Cad Red Dark': ('pr108_dk', 'PR 108'),
    'Cad Red Light': ('pr108_lt', 'PR 108'),
    'Cad Yellow Dark': ('py35_dk', 'PY 35'),
    'cad yellow Primrose': ('py35_prim', 'PY 35'),
    'Cadmium Yellow Light': ('py35_lt', 'PY 35'),
    'Cerulean Blue Deep': ('pb36_deep', 'PB 36'),
    'Chromium Oxide Dark': ('pg17_dk', 'PG 17'),
    'Cobalt Teal': ('pg50_teal', 'PG 50'),
    'Cobalt Titanate Green': ('pg50_titan', 'PG 50'),
    'Cobalt Turquoise': ('pg50_turq', 'PG 50'),
    'Green Gold': ('py129', 'PY 129'),
    'Hookers Green Hue': ('pg_hook', 'PG Mix'),
    'Indian Yellow Hue': ('py_indian', 'PY Mix'),
    'Jenkins Green': ('pg_jenk', 'PG Mix'),
    'Manganese Blue Hue': ('pb_mang', 'PB Mix'),
    'Mars Black': ('pbk11', 'PBk 11'),
    'Mars yellow': ('py42', 'PY 42'),
    'Napthol Red Medium': ('pr112_med', 'PR 112'),
    'Nickel Azo Yellow': ('py150', 'PY 150'),
    'Perm Green Light': ('pg7_lt', 'PG 7'),
    'Permanent Maroon': ('pr179', 'PR 179'),
    'Permanent Violet Dark': ('pv23_dk', 'PV 23'),
    'Phthalo Blue RS': ('pb15_rs', 'PB 15:1'),
    'Prussian Blue Hue': ('pb27', 'PB 27'),
    'Pyrrole Orange': ('po73', 'PO 73'),
    'Pyrrole Red Dark': ('pr254_dk', 'PR 254'),
    'Pyrrole Red Light': ('pr254_lt', 'PR 254'),
    'Quin Burnt Orange': ('po49', 'PO 49'),
    'Quin Crimson': ('pr206', 'PR 206'),
    'Quin Nickel Azo': ('py150_qn', 'PY 150 / PO 48'),
    'Quin Red Light': ('pv19_lt', 'PV 19'),
    'Quin Violet': ('pv19_vio', 'PV 19'),
    'Red Oxide': ('pr101_ox', 'PR 101'),
    'Sap Green Hue': ('pg_sap', 'PG Mix'),
    'Terre Verte Hue': ('pg_terre', 'PG Mix'),
    'Titanate Yellow': ('py53', 'PY 53'),
    'Transparent Brown Iron Oxide': ('pbr7_trans', 'PBr 7'),
    'Transparent Pyrrole Orange': ('po73_trans', 'PO 73'),
    'Transparent Red Iron Oxide': ('pr101_trans', 'PR 101'),
    'Transparent Yellow Iron Oxide': ('py42_trans', 'PY 42'),
    'Turquoise': ('pb_turq', 'PB Mix'),
    'Van Dyke Brown Hue': ('pbr_vd', 'PBr Mix'),
    'Violet Oxide': ('pr101_vio', 'PR 101'),
    'Viridian Green Hue': ('pg18', 'PG 18'),
    'Yellow Oxide': ('py42_ox', 'PY 42'),
}

BASE_IDS = {'pw6', 'pw4', 'pbk9', 'pbk7', 'pbk11'}

# Titanium White masstone K/S is not in the Golden sheet; must match constants.ts.
PW6_STORED_KS = [0.05, 0.04, 0.03, 0.02, 0.01, 0.01, 0.01, 0.01,
                 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01]


def lab_to_hex(L, a, b):
    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200
    def finv(f):
        f3 = f ** 3
        return f3 if f3 > 0.008856 else (f - 16 / 116) / 7.787
    x = finv(fx) * 95.047 / 100
    y = finv(fy) * 100.0 / 100
    z = finv(fz) * 108.883 / 100
    r = x * 3.2406 + y * -1.5372 + z * -0.4986
    g = x * -0.9689 + y * 1.8758 + z * 0.0415
    bl = x * 0.0557 + y * -0.2040 + z * 1.0570
    def gamma(c):
        return 1.055 * (c ** (1 / 2.4)) - 0.055 if c > 0.0031308 else 12.92 * c
    r = max(0, min(255, round(gamma(max(0, r)) * 255)))
    g = max(0, min(255, round(gamma(max(0, g)) * 255)))
    bl = max(0, min(255, round(gamma(max(0, bl)) * 255)))
    return f'#{r:02X}{g:02X}{bl:02X}'


def load_masstones(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb['Sheet1']
    rows = list(ws.iter_rows(values_only=True))
    pigments_ts = []
    ks_data = {}
    for row in rows[2:]:
        data = list(row)
        if data[0] is None:
            continue
        name = str(data[1]).strip()
        if name not in PIGMENT_MAP:
            continue
        pid, code = PIGMENT_MAP[name]
        hex_color = lab_to_hex(data[2], data[3], data[4])
        ks = [round(data[KS_COL_START + idx], 4) for idx in INDICES_20NM]
        pigments_ts.append({
            'id': pid, 'name': name, 'code': code,
            'hex': hex_color, 'isBase': pid in BASE_IDS,
        })
        ks_data[pid] = ks
    return pigments_ts, ks_data


def load_tints(path):
    """Read tints.csv -> {paint name: [(concentration, internal K/S list)]}."""
    tints = {}
    with open(path, newline='') as f:
        reader = csv.reader(f)
        header = [h.strip().lower() for h in next(reader)]
        if header[0] != 'name' or header[1] != 'concentration':
            sys.exit("tints csv: first two columns must be 'name,concentration'")
        n_vals = len(header) - 2
        if n_vals != 16:
            sys.exit(f"tints csv: expected 16 spectral columns (400-700nm/20nm), got {n_vals}")
        is_reflectance = header[2].startswith('r')
        for row in reader:
            if not row or not row[0].strip():
                continue
            name = row[0].strip()
            c = float(row[1])
            if not (0 < c < 1):
                sys.exit(f"tints csv: concentration for '{name}' must be in (0,1), got {c}")
            vals = [float(v) for v in row[2:2 + 16]]
            if is_reflectance:
                if max(vals) > 1.0:  # tolerate percent input
                    vals = [v / 100 for v in vals]
                internal = [reflectance_to_internal_ks(v) for v in vals]
            else:
                internal = [stored_ks_to_internal_ks(v) for v in vals]
            tints.setdefault(name, []).append((c, internal))
    return tints


def emit_fit_block(fits):
    lines = ["export const PIGMENT_KS_FIT: Record<string, { k: number[]; s: number[] }> = {"]
    for pid, (k, s) in fits.items():
        k_str = json.dumps([round(v, 4) for v in k])
        s_str = json.dumps([round(v, 4) for v in s])
        lines.append(f"  '{pid}': {{ k: {k_str}, s: {s_str} }},")
    lines.append("};")
    return "\n".join(lines)


def write_constants(constants_path, block):
    with open(constants_path) as f:
        src = f.read()
    pattern = re.compile(
        r"(// BEGIN GENERATED PIGMENT_KS_FIT.*?\n).*?(\n// END GENERATED PIGMENT_KS_FIT)",
        re.S,
    )
    if not pattern.search(src):
        sys.exit(f"markers not found in {constants_path}")
    src = pattern.sub(lambda m: m.group(1) + block + m.group(2), src, count=1)
    with open(constants_path, 'w') as f:
        f.write(src)
    print(f"wrote PIGMENT_KS_FIT ({block.count(chr(10)) - 1} pigments) into {constants_path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--masstone', default='Reflectance Data for Golden HB 10 mil Drawdowns over White.xlsx')
    ap.add_argument('--tints', help='CSV of tint drawdowns (see module docstring)')
    ap.add_argument('--write', metavar='CONSTANTS_TS', help='patch PIGMENT_KS_FIT into this constants.ts in place')
    ap.add_argument('--selftest', action='store_true', help='validate the fitting math on synthetic data')
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    pigments_ts, ks_data = load_masstones(args.masstone)

    if not args.tints:
        print("// === PIGMENTS ===")
        for p in pigments_ts:
            base = 'true' if p['isBase'] else 'false'
            print(f"  {{ id: '{p['id']}', name: '{p['name']}', code: '{p['code']}', hex: '{p['hex']}', isBase: {base} }},")
        print("\n// === KS_DATA ===")
        for pid, ks in ks_data.items():
            print(f"  '{pid}': {json.dumps(ks)},")
        return

    tints_by_name = load_tints(args.tints)
    k_white = [stored_ks_to_internal_ks(v) for v in PW6_STORED_KS]

    fits = {}
    skipped = []
    for name, tint_list in sorted(tints_by_name.items()):
        if name not in PIGMENT_MAP:
            skipped.append(name)
            continue
        pid, _ = PIGMENT_MAP[name]
        if pid not in ks_data:
            skipped.append(name)
            continue
        ks_mass_internal = [stored_ks_to_internal_ks(v) for v in ks_data[pid]]
        k_fit, s_fit = fit_pigment_ks(ks_mass_internal, tint_list, k_white)
        fits[pid] = (k_fit, s_fit)
        n_clamped = sum(1 for v in s_fit if v in (S_MIN, S_MAX))
        note = f" ({n_clamped} bands clamped)" if n_clamped else ""
        print(f"fitted {pid:16s} from {len(tint_list)} tint(s){note}", file=sys.stderr)
    if skipped:
        print(f"skipped (no masstone match): {', '.join(skipped)}", file=sys.stderr)

    block = emit_fit_block(fits)
    if args.write:
        write_constants(args.write, block)
    else:
        print(block)


if __name__ == '__main__':
    main()
