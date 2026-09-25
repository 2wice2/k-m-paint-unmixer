// Pen-dispenser outlet caps for NovoPen-type insulin pens.
//
//   part = "B"  Potted-cannula cap: one straight steel tube, sharp end pierces
//               the septum, blunt end dispenses. Epoxied into the cap.
//   part = "C"  Nozzle cap: printed spigot pushes into a hole punched in the
//               septum (biopsy punch); short printed nozzle with a drip edge.
//
// Both screw onto the pen's needle thread (female thread here). The thread
// only retains the cap; the seal is at the septum (see docs/pen-caps.md).
//
// !! Thread and septum numbers below are PLACEHOLDERS. Replace them with the
// !! values from your working Novo adapter before printing.
//
// Render:  openscad -D 'part="B"' -o cap_B.stl pen_caps.scad
// Review:  add -D section=true for a half-section.

/* [Selection] */
part = "B";            // "B" or "C"
section = false;       // cut in half to inspect the paint path
show_tube = true;      // part B: draw the steel tube (preview only, not printed)

/* [Pen thread — MEASURE / COPY FROM WORKING ADAPTER] */
thread_major_d = 7.6;  // pen tip male thread, major diameter (mm)   PLACEHOLDER
thread_pitch   = 1.0;  // mm                                          PLACEHOLDER
thread_depth   = 0.55; // radial depth of thread form                 PLACEHOLDER
thread_starts  = 1;
thread_len     = 5.5;  // engaged length                              PLACEHOLDER
right_hand     = true;
thread_clear   = 0.20; // radial clearance for resin (tune: 0.15–0.30)
nose_len       = 0.5;  // pen tip beyond the thread, up to its end face

/* [Cartridge / septum — MEASURE] */
septum_recess  = 1.0;  // pen tip end face → septum outer surface      PLACEHOLDER
septum_thick   = 3.0;  // septum thickness                             PLACEHOLDER
aperture_d     = 4.0;  // hole in the pen tip exposing the septum      PLACEHOLDER

/* [Body] */
wall   = 2.0;
floor_t = 2.0;         // end wall the tube / nozzle passes through
ribs   = 12;           // grip ribs
rib_h  = 0.6;

/* [Part B: potted cannula] */
// Stainless tube OD/ID (mm): 18G 1.270/0.838, 20G 0.908/0.603,
//                            21G 0.819/0.514, 22G 0.718/0.413
tube_od   = 1.270;
tube_id   = 0.838;
tube_clear = 0.10;     // diametral clearance for epoxy
septum_margin = 2.0;   // how far the sharp end goes past the septum
boss_d    = 4.0;       // support boss around the tube on the outlet side
boss_len  = 4.0;
tube_out  = 8.0;       // exposed blunt tube beyond the boss (shorter = more flow)

/* [Part C: nozzle] */
bore_d     = 1.5;      // paint path diameter
spigot_od  = 3.0;      // push-fit into a punched septum hole (punch ~2.5 mm)
spigot_short = 0.5;    // stop this far short of the septum's inner face
nozzle_len = 4.0;      // outside the floor
nozzle_base_d = 5.0;
lip_wall   = 0.4;      // thin drip edge at the exit so paint breaks off cleanly

$fn = 72;
eps = 0.01;

// ---------------------------------------------------------------------------
// Derived
lead      = thread_pitch * thread_starts;
r_major   = thread_major_d / 2 + thread_clear;          // void outer radius
r_minor   = thread_major_d / 2 - thread_depth + thread_clear; // void crest radius
body_r    = r_major + wall;
cavity_len = thread_len + nose_len;                      // open end → floor
body_len  = cavity_len + floor_t;

b_inner   = septum_recess + septum_thick + septum_margin; // tube past the floor, into the pen
b_tube_len = b_inner + floor_t + boss_len + tube_out;

c_spigot  = septum_recess + septum_thick - spigot_short;  // spigot length past the floor
c_path    = c_spigot + floor_t + nozzle_len;

// ---------------------------------------------------------------------------
// Thread: twisted extrusion of an Archimedean profile gives a true helical
// thread with a triangular axial form.
module thread_void(h) {
  n = 120;
  pts = [for (i = [0:n-1])
    let(a = i * 360 / n,
        ph = (a * thread_starts / 360) % 1,
        t = ph < 0.5 ? ph * 2 : 2 - ph * 2,
        r = r_minor + (r_major - r_minor) * t)
    [r * cos(a), r * sin(a)]];
  linear_extrude(height = h, twist = (right_hand ? -1 : 1) * 360 * h / lead,
                 slices = ceil(h / lead * 48), convexity = 10)
    polygon(pts);
}

module grip_body() {
  cylinder(r = body_r, h = body_len);
  for (i = [0:ribs-1]) rotate(i * 360 / ribs)
    translate([body_r - 0.1, -0.5, 0]) cube([rib_h + 0.1, 1.0, body_len * 0.8]);
}

// Cap shell: grip body with threaded cavity, open at z = 0, floor at the top.
module cap_shell() {
  difference() {
    grip_body();
    translate([0, 0, -eps]) thread_void(thread_len + eps);
    // lead-in chamfer
    translate([0, 0, -eps]) cylinder(r1 = r_major + 0.4, r2 = r_minor, h = 0.8);
    // nose clearance between thread and floor
    translate([0, 0, thread_len - eps]) cylinder(r = r_minor, h = nose_len + 2 * eps);
  }
}

// ---------------------------------------------------------------------------
module part_B() {
  difference() {
    union() {
      cap_shell();
      // support boss on the outlet side
      translate([0, 0, body_len - eps]) cylinder(d = boss_d, h = boss_len);
    }
    // tube bore through floor and boss
    translate([0, 0, cavity_len - 1]) cylinder(d = tube_od + tube_clear, h = floor_t + boss_len + 2, $fn = 36);
    // epoxy fillet well at the boss tip
    translate([0, 0, body_len + boss_len - 1.0 + eps])
      cylinder(d1 = tube_od + tube_clear, d2 = tube_od + 1.6, h = 1.0, $fn = 36);
    // epoxy fillet well on the inside of the floor (dry side, facing the pen)
    translate([0, 0, cavity_len - eps])
      cylinder(d1 = tube_od + 1.6, d2 = tube_od + tube_clear, h = 0.8, $fn = 36);
  }
}

module tube_B() {
  // Sharp end (bevel) points into the pen at z = cavity_len - b_inner.
  z0 = cavity_len - b_inner;
  color("silver") difference() {
    translate([0, 0, z0]) cylinder(d = tube_od, h = b_tube_len, $fn = 24);
    translate([0, 0, z0 - eps]) cylinder(d = tube_id, h = b_tube_len + 2 * eps, $fn = 24);
    // 20° bevel on the sharp end
    translate([0, 0, z0]) rotate([0, 70, 0]) translate([-5, -5, -10]) cube([10, 10, 10]);
  }
}

// ---------------------------------------------------------------------------
module part_C() {
  difference() {
    union() {
      cap_shell();
      // spigot into the punched septum hole (inside the cavity, pointing at the pen)
      translate([0, 0, cavity_len - c_spigot]) {
        cylinder(d = spigot_od, h = c_spigot + eps);
      }
      // nozzle cone outside
      translate([0, 0, body_len - eps])
        cylinder(d1 = nozzle_base_d, d2 = bore_d + 2 * lip_wall, h = nozzle_len);
    }
    // straight paint path
    translate([0, 0, cavity_len - c_spigot - 1])
      cylinder(d = bore_d, h = c_path + 2, $fn = 36);
    // lead-in chamfer on the spigot tip
    translate([0, 0, cavity_len - c_spigot - eps])
      difference() {
        cylinder(d = spigot_od + 1, h = 0.6);
        cylinder(d1 = spigot_od - 0.8, d2 = spigot_od, h = 0.6);
      }
  }
}

// ---------------------------------------------------------------------------
module assembled() {
  if (part == "B") { part_B(); if (show_tube && $preview) tube_B(); }
  else if (part == "C") part_C();
}

if (section)
  difference() { assembled(); translate([0, -50, -50]) cube(100); }
else
  assembled();

// ---------------------------------------------------------------------------
// Report key numbers (shown in the OpenSCAD console)
if (part == "B") {
  echo(str("B: cut tube to ", b_tube_len, " mm; sharp end protrudes ", b_inner,
           " mm past the floor; trapped volume ≈ ",
           round(PI * pow(tube_id / 2, 2) * b_tube_len * 10) / 10, " µL"));
}
if (part == "C") {
  assert(spigot_od < aperture_d - 0.4, "spigot_od must clear the pen-tip aperture");
  echo(str("C: spigot ", c_spigot, " mm long, paint path ", c_path, " mm × Ø", bore_d,
           " mm; trapped volume ≈ ", round(PI * pow(bore_d / 2, 2) * c_path * 10) / 10, " µL",
           "; punch the septum ~", spigot_od - 0.5, " mm"));
}
