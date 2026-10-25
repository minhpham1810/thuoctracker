// V7: nominal 3 mm plywood ONLY. Millimetres, no kerf compensation.
// Individual profiles and their actual 3-D placements share this source.
panel="none";
t=3; fit=0.12; bolt=3.4; nut_af=5.8; nut_axial=2.8;
arm_access_d=8.5; // Access around FACTORY horn hub, never a servo spline.
encoder_hole_d=14.5; // User-added front-left hole. Centre is approximate, not measured.
encoder_hole_x=40; encoder_hole_z=36;
W=176; D=112; UH=72; tilt=25; faceH=92;
frontY=-92; frontZ=38; seat_under=91; frame_seat=94;
cx=[5.5,170.5]; ux=[11.5,164.5];
floor_y=[-68,-20,24,100]; deck_y=[30,72];
$fn=48;
function cabinet_seat_z()=frame_seat;
function upper_total_h()=UH+3*t; // Includes 3mm roof spacers below floor.
function stack_floor_clearance()=frontZ+(faceH-75)/2*sin(tilt)+(t-40)*cos(tilt)-t;
module circle_bolt(){circle(d=bolt);}
module capsule(l,w){hull()for(x=[-(l-w)/2,(l-w)/2])translate([x,0])circle(d=w);}
// Edge-access nut slot: local +X points INTO panel. M3 nut on edge,
// NOT flush in 3 mm plywood. 14 mm channel clears M3x16 screw tips.
module tn(){translate([-0.1,-bolt/2])square([14.1,bolt]);translate([6,-nut_af/2])square([nut_axial,nut_af]);}
module ts(p,a){translate(p)rotate(a)tn();}
module mortise(p,w,h){translate([p[0]-fit/2,p[1]-fit/2])square([w+fit,h+fit]);}

// UPPER: side walls x10..13 /163..166; front/back overhang to protect holes.
module upper_side(){difference(){union(){
 translate([3,0])square([106,UH]);
 for(y=[14,54,88]){translate([y,-t])square([8,t]);translate([y,UH])square([8,t]);}
 for(y=[0,109])translate([y,30])square([t,8]);
}
 for(z=[16,56]){ts([3,z],0);ts([109,z],180);}
 for(y=[30,78]){ts([y,0],90);ts([y,UH],-90);}
 // Existing wood rear keys rise 4 mm above roof; base ring accounts for 3.
 translate([98,-0.1])square([14.1,1.4]);
}}
module upper_front(){difference(){square([W,UH]);
 for(x=ux){for(z=[16,56])translate([x,z])circle_bolt();mortise([x-t/2,30],t,8);}
 translate([134,40])circle(d=44);
 for(dx=[-22,22],dz=[-18,18])translate([134+dx,40+dz])circle_bolt();
 translate([72,58])circle(d=3);
 translate([encoder_hole_x,encoder_hole_z])circle(d=encoder_hole_d);
}}
module upper_rear(){difference(){square([W,UH]);
 for(x=ux){for(z=[16,56])translate([x,z])circle_bolt();mortise([x-t/2,30],t,8);}
 translate([25,7])square([42,29]);translate([136,7])square([20,25]);
 for(x=[80,124],z=[14,28])translate([x,z])circle(d=3);
 for(x=[10.7,161.7])translate([x,-0.1])square([3.6,1.4]);
}}
module upper_horizontal(lid=false){difference(){square([W,D]);
 for(x=ux){for(y=[30,78])translate([x,y])circle_bolt();for(y=[14,54,88])mortise([x-t/2,y],t,8);}
 if(lid){for(x=[40,64,88,112,136],y=[78,96])translate([x,y])capsule(14,3);}
 else{
  translate([20,8])square([136,96]);
  // Preserve existing roof harness opening, without a fragile narrow neck.
  translate([141.8,98.8])square([8.4,8.4]);
  for(x=[5,171],y=[18,94])translate([x,y])circle_bolt();
  for(x=[10.7,161.7])translate([x,97.8])square([3.6,14.3]);
 }
}}
module speaker_ring(){difference(){union(){circle(d=64);for(x=[-22,22],y=[-18,18])translate([x,y])circle(d=10);}
 circle(d=44);for(x=[-22,22],y=[-18,18])translate([x,y])circle_bolt();
}}
module upper_spacer(){difference(){circle(d=10);circle_bolt();}}

// BASE: inset side walls x4..7 /169..172. Caps project to width176.
module face_pose(){translate([0,frontY,frontZ])rotate([tilt,0,0])children();}
module base_side(){difference(){union(){
 polygon([[frontY,t],[112,t],[112,seat_under],[0,seat_under],
 [frontY+faceH*cos(tilt),frontZ+faceH*sin(tilt)],[frontY,frontZ]]);
 for(y=[-56,-4,44,82])translate([y,0])square([8,t]);
 for(y=[8,46,88])translate([y,seat_under])square([8,t]);
 translate([frontY-t,20])square([t,4]);translate([112,44])square([t,8]);
}
 for(y=floor_y)ts([y,t],90);
 for(y=deck_y)ts([y,seat_under],-90);
 for(z=[14,28])ts([frontY,z],0);
 for(z=[26,70])ts([112,z],180);
 for(u=[20,72])ts([frontY+u*cos(tilt),frontZ+u*sin(tilt)],tilt-90);
 for(y=[30,54,78])translate([y,38])rotate(90)capsule(32,8);
}}
module base_floor(){difference(){translate([0,-95])square([W,210]);
 for(x=cx){for(y=floor_y)translate([x,y])circle_bolt();for(y=[-56,-4,44,82])mortise([x-t/2,y],t,8);}
 // Only rear chamber vents, away from the conservative Pi/display stack.
 for(x=[38,88,138])translate([x,54])capsule(40,10);
}}
module base_deck(){difference(){square([W,115]);
 translate([18,18])square([140,62]);
 for(x=cx){for(y=deck_y)translate([x,y])circle_bolt();for(y=[8,46,88])mortise([x-t/2,y],t,8);}
 // Shares the WIDE servo's existing floor slots; two longer bolts retain frame.
 for(x=[67.5,108.5])translate([x,91])circle_bolt();
}}
module base_front(){difference(){square([W,frontZ-t]);
 for(x=cx){for(z=[14,28])translate([x,z-t])circle_bolt();mortise([x-t/2,20-t],t,4);}
}}
module base_rear(){difference(){square([W,seat_under-t]);
 for(x=cx){for(z=[26,70])translate([x,z-t])circle_bolt();mortise([x-t/2,44-t],t,8);}
 for(x=[24,124])translate([x,-0.1])square([28,20.1]);
 translate([80,-0.1])square([24,4.1]);
 for(x=[70,112],z=[8,16])translate([x,z])circle(d=3);
 for(x=[36:20:136])translate([x,53])capsule(14,5);
}}
module base_bezel(front=true){difference(){square([W,faceH]);
 if(front)translate([32,12])square([112,68]);
 else translate([27.4,7.9])square([121.2,76.2]);
 for(x=cx,u=[20,72])translate([x,u])circle_bolt();
}}
module servo_arm(){difference(){hull(){circle(d=18);translate([30,0])circle(d=12);}
 circle(d=arm_access_d);for(x=[9.5,15])translate([x,0])capsule(5,2.2);
}}
module servo_strip(){difference(){square([12,24]);translate([4,12])circle_bolt();}}

// Assembly contains fabrication solids only. No electronics or dummy screws.
module panel_yz(x,z=0){multmatrix([[0,0,1,x],[1,0,0,0],[0,1,0,z],[0,0,0,1]])linear_extrude(t,convexity=20)children();}
module panel_xz(y,z=0){multmatrix([[1,0,0,0],[0,0,1,y],[0,1,0,z],[0,0,0,1]])linear_extrude(t,convexity=20)children();}
module upper_assembly(ex=false){e=ex?25:0;
 for(x=[5,171],y=[18,94])color("tan")translate([x,y,0])linear_extrude(t)upper_spacer();
 translate([0,0,t]){
 color("burlywood")linear_extrude(t,convexity=20)upper_horizontal(false);
 for(x=[10-e,163+e])color("tan")panel_yz(x,t)upper_side();
 color("wheat")panel_xz(-e,t)upper_front();
 color("wheat")panel_xz(109+e,t)upper_rear();
 color("burlywood")translate([0,0,UH+t+e])linear_extrude(t,convexity=20)upper_horizontal(true);
 color("tan")translate([134,-t-2*e,43])rotate([-90,0,0])linear_extrude(t) speaker_ring();
 }
}
module base_assembly(ex=false){e=ex?30:0;
 color("burlywood")translate([0,0,-e])linear_extrude(t,convexity=20)base_floor();
 color("tan")panel_yz(4-e)base_side();color("tan")panel_yz(169+e)base_side();
 color("wheat")panel_xz(-95-e,t)base_front();
 color("wheat")panel_xz(112+e,t)base_rear();
 color("burlywood")translate([0,0,seat_under+e])linear_extrude(t,convexity=20)base_deck();
 color("tan")translate([0,-e,e])face_pose()linear_extrude(t,convexity=20)base_bezel(false);
 color("wheat")translate([0,-1.5*e,1.6*e])face_pose()translate([0,0,t])linear_extrude(t,convexity=20)base_bezel(true);
}
module actuators(){for(i=[0:2]){
 color("tan")translate([82,91,36+44*i])linear_extrude(t)servo_arm();
 for(z=[21+44*i,24+44*i]){
  color("tan")translate([63.5,79,z])linear_extrude(t)servo_strip();
  color("tan")translate([112.5,103,z])rotate([0,0,180])linear_extrude(t)servo_strip();
 }
}}
module profile(name){
 if(name=="upper_side")translate([0,t])upper_side();
 if(name=="upper_front")upper_front();
 if(name=="upper_rear")upper_rear();
 if(name=="upper_floor")upper_horizontal(false);
 if(name=="upper_lid")upper_horizontal(true);
 if(name=="speaker_ring")translate([32,32])speaker_ring();
 if(name=="upper_spacer")translate([5,5])upper_spacer();
 if(name=="base_side")translate([95,0])base_side();
 if(name=="base_floor")translate([0,95])base_floor();
 if(name=="base_deck")base_deck();
 if(name=="base_front")base_front();
 if(name=="base_rear")base_rear();
 if(name=="base_bezel_front")base_bezel(true);
 if(name=="base_bezel_spacer")base_bezel(false);
 if(name=="servo_arm")translate([9,9])servo_arm();
 if(name=="servo_strip")servo_strip();
}
assert(t==3,"V7 release is 3mm only; changing stock requires complete revalidation");
assert(stack_floor_clearance()>4,"Display stack clearance too small");
if(panel!="none")profile(panel);
