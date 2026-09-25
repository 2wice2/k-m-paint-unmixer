// Pen-dispenser outlet caps for NovoPen-type insulin pens.
//
//   part = "B"    Potted-cannula cap: one straight steel tube, sharp end pierces
//                 the septum, blunt end dispenses. Epoxied into the cap.
//   part = "C"    Nozzle cap: printed spigot pushes into a hole punched in the
//                 septum (biopsy punch); short printed nozzle with a drip edge.
//   part = "nose" Reference only (not printed): the pen's male nose as modelled
//                 in the owner's NovaPen Adapter.prt, for fit reviews.
//
// Both caps screw onto the pen's needle thread (female thread here). The thread
// only retains the cap; the seal is at the septum (see hardware/README.md).
// The cap floor seats on the pen tip face, so septum depths are measured from
// that face.
//
// Render:  openscad -D 'part="B"' -o cap_B.stl --export-format binstl pen_caps.scad
// Review:  -D section=true for a half-section, -D show_nose=true to overlay the
//          reference nose screwed fully home.

/* [Selection] */
part = "B";            // "B", "C" or "nose"
section = false;       // cut in half to inspect the paint path
show_tube = true;      // part B: draw the steel tube (preview only, not printed)
show_nose = false;     // overlay the reference nose (preview only, not printed)

/* [Pen thread — from NovaPen Adapter.prt] */
// Source: NovaPen Adapter.prt (owner's patent-derived model of the pen's male
// nose). HELIX(2): dia 9.6, pitch 0.8, right hand. SKETCH(7): 60° flanks with
// R0.2 crest and root rounds, swept and subtracted from a Ø9.6 cylinder.
// Depth (0.293) follows from pitch, angle and rounds. Checked against NX's
// STL export of the part: see hardware/README.md.
thread_major_d = 9.6;  // pen male thread, major diameter
thread_pitch   = 0.8;
thread_angle   = 60;   // included flank angle
thread_round_r = 0.2;  // crest and root radius
thread_starts  = 1;
right_hand     = true;
thread_clear   = 0.15; // radial allowance: the whole profile moves out by this
                       // (same convention as the v7 collars r10/r15/r20)
thread_len     = 4.4;  // engaged female thread (5.5 turns). The adapter's
                       // thread runs from the tip face back 5.5 mm; keep the
                       // cap's thread inside the fully formed turns.
nose_len       = 0.0;  // unthreaded pen tip beyond the thread (model: none)
lead_in        = 0.8;  // plain counterbore at the open end, before the thread

/* [Cartridge / septum — measured on the pen 2026-09-25] */
// Real pen: Ø7.4 front entrance (the .prt's tip has a Ø5.8 lip instead); the
// rubber shows through the hole in the cartridge's aluminium seal.
pen_entrance_d = 7.4;  // opening in the pen tip (reference nose only)
aperture_d     = 4.88; // smallest opening in front of the rubber: the seal's hole
septum_recess  = 0.78; // pen tip face → rubber outer face
septum_thick   = 2.5;  // ASSUMED: the rubber can't be reached to measure. C's spigot
                       // goes 2.0 into the rubber and B's tube clears 5.5 of rubber
                       // plus bevel, so 2.0–3.5 mm septa all work.

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
septum_margin = 3.0;   // sharp end past the septum's inner face; must exceed the bevel length
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
th_h      = thread_angle / 2;
th_rc     = thread_major_d / 2 - thread_round_r;         // crest round centre radius
th_rr     = th_rc + (2 * thread_round_r - thread_pitch / 2 * cos(th_h)) / sin(th_h); // root round centre
th_root   = th_rr - thread_round_r;                      // male minor radius
th_depth  = thread_major_d / 2 - th_root;
th_u1     = thread_round_r * cos(th_h);                  // root round ends
th_u2     = thread_pitch / 2 - thread_round_r * cos(th_h); // crest round starts
r_major   = thread_major_d / 2 + thread_clear;           // void outer radius
r_minor   = th_root + thread_clear;                      // void crest radius (cap's thread tips)
body_r    = r_major + wall;
cavity_len = lead_in + thread_len + nose_len;            // open end → floor (= pen tip face)
body_len  = cavity_len + floor_t;

b_inner   = septum_recess + septum_thick + septum_margin; // tube past the floor, into the pen
b_tube_len = b_inner + floor_t + boss_len + tube_out;

c_spigot  = septum_recess + septum_thick - spigot_short;  // spigot length past the floor
c_path    = c_spigot + floor_t + nozzle_len;

// ---------------------------------------------------------------------------
// Thread. th_prof(u) is the male profile radius at axial distance u from a
// root centre (one pitch, |u| <= pitch/2): root round, straight flank, crest
// round. A cross-section of a helical thread is that profile wrapped once per
// pitch around the axis; twisting it by one turn per lead sweeps the exact
// helicoid.
function th_prof(u) = let(a = abs(u))
  a <= th_u1 ? th_rr - sqrt(pow(thread_round_r, 2) - a * a)
  : a >= th_u2 ? th_rc + sqrt(max(0, pow(thread_round_r, 2) - pow(thread_pitch / 2 - a, 2)))
  : (th_rr - thread_round_r * sin(th_h))
    + (a - th_u1) * ((th_rc + thread_round_r * sin(th_h)) - (th_rr - thread_round_r * sin(th_h))) / (th_u2 - th_u1);

function th_u(a) = let(x = (lead * a / 360) % thread_pitch)
  x > thread_pitch / 2 ? x - thread_pitch : x;

// Helical solid whose surface is the thread profile moved out by `clear`.
// Root centre at angle 0 on its base plane.
module thread_solid(h, clear) {
  n = 180;
  pts = [for (i = [0:n-1]) let(a = i * 360 / n, r = th_prof(th_u(a)) + clear)
         [r * cos(a), r * sin(a)]];
  linear_extrude(height = h, twist = (right_hand ? -1 : 1) * 360 * h / lead,
                 slices = ceil(h / lead * 72), convexity = 10)
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
    // plain lead-in bore with a rim chamfer
    translate([0, 0, -eps]) cylinder(r = r_major + 0.05, h = lead_in + 2 * eps);
    translate([0, 0, -eps]) cylinder(r1 = r_major + 0.55, r2 = r_major + 0.05, h = 0.5);
    // female thread, with a 45° chamfer on its first turn
    translate([0, 0, lead_in]) rotate(show_nose ? nose_phase() : 0) thread_solid(thread_len + eps, thread_clear);
    translate([0, 0, lead_in - eps])
      cylinder(r1 = r_major + 0.05, r2 = r_minor - 0.05, h = r_major - r_minor + 0.1);
    // relief over any unthreaded pen tip
    if (nose_len > 0)
      translate([0, 0, lead_in + thread_len - eps]) cylinder(r = r_major, h = nose_len + 2 * eps);
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
// Reference nose (NovaPen Adapter.prt), tip face at z = 0, body towards -z.
// Revolved outline from the part's section, tip opening as measured on the
// pen; the thread is the same profile with no clearance. Below the shoulder (z < -7.3) the four lugs are drawn as
// a plain ring, and the 0.8 mm where the swept groove starts is left solid.
// Good for fit reviews only.
nose_tip_z   = 9.485;  // tip face height in the .prt
nose_helix_z = 4.4;    // groove centre at angle 0 where the sweep starts (.prt)

module pen_nose() {
  z = function(zp) zp - nose_tip_z;
  t0 = nose_helix_z + thread_pitch;                     // first fully formed turn
  difference() {
    union() {
      translate([0, 0, z(0)]) rotate_extrude($fn = 96) polygon([
        [4.1, 0], [5.3, 0], [5.5, 0.2], [5.5, 0.95], [5.44, 0.95], [5.44, 2.15],
        [4.8, 2.15], [4.8, t0 - thread_pitch / 2], [4.1, t0 - thread_pitch / 2]]);
      // thread: root centre at angle 0 sits at nose_helix_z + k * pitch
      translate([0, 0, z(t0 - thread_pitch / 2)])
        rotate((right_hand ? 1 : -1) * 360 * (-thread_pitch / 2) / lead)
          thread_solid(nose_tip_z - (t0 - thread_pitch / 2), 0);
    }
    // Ø8.2 bore, 0.6 front lip opened to the measured entrance (the .prt has
    // an R0.6-blended end wall with a Ø5.8 hole here)
    translate([0, 0, z(0)]) rotate_extrude($fn = 96) polygon(
      [[0, -1], [4.1, -1], [4.1, 8.885], [pen_entrance_d / 2, 8.885],
       [pen_entrance_d / 2, 10], [0, 10]]);
  }
}

// Cap placed on the nose, floor on the tip face, with its thread phased to
// interleave (the real cap finds its own phase).
function nose_phase() =
  let(zb = nose_tip_z - cavity_len + lead_in,           // nose height of the thread base
      f = ((zb - nose_helix_z) / thread_pitch) % 1)
  (right_hand ? 1 : -1) * 360 * f * thread_pitch / lead;

// ---------------------------------------------------------------------------
module assembled() {
  if (part == "B") { part_B(); if (show_tube && $preview) tube_B(); }
  else if (part == "C") part_C();
  else if (part == "nose") pen_nose();
}

module placed() {
  if (show_nose && part != "nose") {
    // The review overlay moves the cap onto the nose and phases its thread.
    translate([0, 0, -cavity_len]) assembled();
    color("lightsteelblue") pen_nose();
  } else assembled();
}

if (section)
  difference() { placed(); translate([0, -50, -50]) cube(100); }
else
  placed();

// ---------------------------------------------------------------------------
// Report key numbers (shown in the OpenSCAD console)
echo(str("thread: Ø", thread_major_d, " x ", thread_pitch, " ", right_hand ? "RH" : "LH",
         ", depth ", round(th_depth * 1000) / 1000, ", cap bore Ø", 2 * r_minor, " / Ø", 2 * r_major,
         " (radial allowance ", thread_clear, "), engaged ", thread_len,
         " mm; review phase ", nose_phase()));
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
