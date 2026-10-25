// V5. Nominal3mm plywood. Verify actual stock thickness before cutting.
// Design contours only: no machine power, feed or automatic laser control.
material=3; fit=0.12; panel="none"; // Recovered original frame; export for rebuilds only.
W=156; D=112; H=136; CW=(W-16)/3;
$fn=40;
function ft(i)=4+44*i;
function ys(i)=i==3?[12,88]:[12,80];
module hole(d=3.4){circle(d=d);}
module slot(l=12,w=3.4){hull()for(x=[-(l-w)/2,(l-w)/2])translate([x,0])circle(d=w);}
module tn(){translate([3.9,102.3])square([9.5,3.4]);translate([10.6,101.1])square([2.8,5.8]);}
module nuts(){tn();translate([W,0])mirror([1,0])tn();}
module side(){
 difference(){
  union(){square([D,H]);translate([98,H])square([14,4]);}
  for(i=[0:3],y=ys(i))translate([y-fit/2,ft(i)-material-fit/2])square([12+fit,material+fit]);
  for(i=[0:3])translate([104,ft(i)-material/2])hole();
  for(z=[20,104])translate([D-material-fit/2,z-fit/2])square([material+fit,12+fit]);
  translate([D-material/2,66])hole();
 }
}
module back(){
 difference(){
  union(){translate([4,0])square([148,H]);for(x=[4-material,152],z=[20,104])translate([x,z])square([material,12]);}
  translate([0,-38])nuts();
  for(i=[0:2])translate([122,ft(i)+7])square([12,22]);
 }
}
module shelf(i){
 difference(){
  union(){translate([4,0])square([148,D-material]);
   for(y=ys(i)){translate([4-material,y])square([material,12]);translate([152,y])square([material,12]);}
   if(i==3)for(x=[-10,152],y=[12,88])translate([x,y])square([14,12]);
  }
  nuts();
  for(c=[0:1]){
   xc=4+CW+2+c*(CW+4);
   if(i==1||i==2)for(y=[12,44])translate([xc-material/2-fit/2,y-fit/2])square([material+fit,8+fit]);
   if(i==2||i==3)for(y=[24,54])translate([xc-material/2-fit/2,y-fit/2])square([material+fit,8+fit]);
  }
  if(i<3)for(c=(i==0?[1]:[0:2]),dx=[-20.5,20.5])translate([4+CW/2+c*(CW+4)+dx,91])rotate(90)slot();
  if(i>0)translate([132,99])square([8,8]);
  if(i==3){
   for(x=[-5,161],y=[18,94])translate([x,y])hole();
   for(x=[22,52,100,126],y=[38,88])translate([x,y])slot(12,3);
  }
 }
}
module divider(){
 h=44-material;
 union(){square([64,h]);for(y=[12,44])translate([y,-material])square([8,material]);for(y=[24,54])translate([y,h])square([8,material]);}
}
module assembled(){
 for(i=[0:3])color("burlywood")translate([0,0,ft(i)-material])linear_extrude(height=material,convexity=20)shelf(i);
 for(x=[4-material,152])color("tan")multmatrix([[0,0,1,x],[1,0,0,0],[0,1,0,0],[0,0,0,1]])linear_extrude(height=material,convexity=20)side();
 color("sienna")multmatrix([[1,0,0,0],[0,0,1,D-material],[0,1,0,0],[0,0,0,1]])linear_extrude(height=material,convexity=20)back();
 for(i=[1:2],c=[0:1])color("wheat")multmatrix([[0,0,1,4+CW+2+c*(CW+4)-material/2],[1,0,0,0],[0,1,0,ft(i)],[0,0,0,1]])linear_extrude(height=material,convexity=20)divider();
}
if(panel=="side")side();
if(panel=="back")back();
if(panel=="bottom")shelf(0);
if(panel=="shelf_lower")shelf(1);
if(panel=="shelf_middle")shelf(2);
if(panel=="top")translate([10,0])shelf(3);
if(panel=="divider")translate([0,material])divider();
if(panel=="assembled")assembled();

