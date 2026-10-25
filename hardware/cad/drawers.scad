// Same drawer geometry as the recovered cabinet, in millimetres.
// One unchanged small STL is reused SIX times. No sensor-specific drawer variant.
use <drawer-parts.scad>
part = "small";
if (part == "small") translate([0,6,0]) bin(45.4666667, false);
if (part == "wide") translate([0,6,0]) bin(146.8, false);
