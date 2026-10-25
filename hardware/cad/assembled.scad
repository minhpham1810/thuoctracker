// Manual-drawer demo: fabrication solids only, no electronic dummy geometry.
use <enclosures.scad>
use <frame.scad>
use <drawer-parts.scad>
base_assembly();
translate([10,0,cabinet_seat_z()]) {
    assembled();
    color("teal") translate([4.6,2,4.6]) bin(146.8, false);
    for (i=[1:2], c=[0:2])
        color("teal") translate([4.6+c*50.6666667,2,4.6+44*i])
            bin(45.4666667, false);
}
translate([0,0,cabinet_seat_z()+136]) upper_assembly();
