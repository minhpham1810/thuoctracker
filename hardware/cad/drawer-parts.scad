// V4-compatible drawer, stock-horn extension, hold-down strip and speaker ring.
part="none"; $fn=40;
arm_access_d=8.5; // Stock-horn HUB ACCESS only, never a printed spline.
module lb(h,d=3.4){cylinder(h=h,d=d);}
module ls(l,w,h){hull()for(x=[-(l-w)/2,(l-w)/2])translate([x,0,0])lb(h,w);}
module bin(width=45.4666667,active=false){difference(){union(){
 difference(){cube([width,70,37.6]);translate([2.8,2.8,4])cube([width-5.6,64.4,37.6]);}
 translate([width/2-12,-6,19])cube([24,6.2,8]);
 if(active)translate([2,70,6])cube([14,9,13]);
}
if(active){translate([4,74.3,9])cube([6.65,2.84,11]);translate([13.2,72.2,5.9])lb(13.2,2.6);}
}}
module arm(){difference(){
 hull(){lb(4,18);translate([30,0,0])lb(4,12);}
 translate([0,0,-0.1])lb(4.2,arm_access_d);
 for(x=[9.5,15])translate([x,0,-0.1])ls(5,2.2,4.2);
}}
module strip(){difference(){cube([12,24,5]);translate([4,12,-0.1])lb(5.2);}}
module speaker_ring(){difference(){
 union(){lb(4,64);for(x=[-22,22],y=[-18,18])translate([x,y,0])lb(4,10);}
 translate([0,0,-0.1])lb(4.2,44);
 translate([0,0,2])lb(2.2,50.8);
 for(x=[-22,22],y=[-18,18])translate([x,y,-0.1])lb(4.2);
}}
if(part=="drawer")translate([0,6,0])bin();
if(part=="arm")translate([9,9,0])arm();
if(part=="strip")strip();
if(part=="ring")translate([32,32,0])speaker_ring();
