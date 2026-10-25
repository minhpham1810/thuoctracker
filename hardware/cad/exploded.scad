// Enclosure-service exploded view. Frame stays assembled; drawers pulled forward.
// Fabrication solids only. Not a manufacturing job or fastener model.
use <enclosures.scad>
use <frame.scad>
use <drawer-parts.scad>
base_assembly(true);
translate([10,0,cabinet_seat_z()+45]) {
    assembled();
    color("teal") translate([4.6,-55,4.6]) bin(146.8, false);
    for (i=[1:2], c=[0:2])
        color("teal") translate([4.6+c*50.6666667,-55,4.6+44*i])
            bin(45.4666667, false);
}
translate([0,0,cabinet_seat_z()+136+90]) upper_assembly(true);
