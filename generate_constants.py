import openpyxl, json, math

wb = openpyxl.load_workbook('Reflectance Data for Golden HB 10 mil Drawdowns over White.xlsx', read_only=True)
ws = wb['Sheet1']
rows = list(ws.iter_rows(values_only=True))

ks_col_start = 38
indices_20nm = [0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30]

def lab_to_hex(L, a, b):
    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200
    x3 = fx**3
    y3 = fy**3
    z3 = fz**3
    x = x3 if x3 > 0.008856 else (fx - 16/116) / 7.787
    y = y3 if y3 > 0.008856 else (fy - 16/116) / 7.787
    z = z3 if z3 > 0.008856 else (fz - 16/116) / 7.787
    x *= 95.047 / 100
    y *= 100.0 / 100
    z *= 108.883 / 100
    r = x * 3.2406 + y * -1.5372 + z * -0.4986
    g = x * -0.9689 + y * 1.8758 + z * 0.0415
    bl = x * 0.0557 + y * -0.2040 + z * 1.0570
    def gamma(c):
        return 1.055 * (c ** (1/2.4)) - 0.055 if c > 0.0031308 else 12.92 * c
    r = max(0, min(255, round(gamma(max(0, r)) * 255)))
    g = max(0, min(255, round(gamma(max(0, g)) * 255)))
    bl = max(0, min(255, round(gamma(max(0, bl)) * 255)))
    return f'#{r:02X}{g:02X}{bl:02X}'

pigment_map = {
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

base_ids = {'pw6', 'pw4', 'pbk9', 'pbk7', 'pbk11'}

pigments_ts = []
ks_data = {}

for row in rows[2:]:
    data = list(row)
    if data[0] is None:
        continue
    name = data[1].strip()
    if name not in pigment_map:
        continue
    pid, code = pigment_map[name]
    lab_l, lab_a, lab_b = data[2], data[3], data[4]
    hex_color = lab_to_hex(lab_l, lab_a, lab_b)
    is_base = pid in base_ids
    ks = []
    for idx in indices_20nm:
        val = data[ks_col_start + idx]
        ks.append(round(val, 4))
    pigments_ts.append({
        'id': pid,
        'name': name,
        'code': code,
        'hex': hex_color,
        'isBase': is_base,
    })
    ks_data[pid] = ks

print("// === PIGMENTS ===")
for p in pigments_ts:
    base = 'true' if p['isBase'] else 'false'
    print(f"  {{ id: '{p['id']}', name: '{p['name']}', code: '{p['code']}', hex: '{p['hex']}', isBase: {base} }},")

print("\n// === KS_DATA ===")
for pid, ks in ks_data.items():
    print(f"  '{pid}': {json.dumps(ks)},")
