/** Current viewport, then two screens ahead, then remaining forward text, then behind. */
export function readingPriority(top:number,bottom:number,height:number):number{
  const h=Math.max(height,1);
  if(bottom>0&&top<h)return Math.max(0,top);
  if(top>=h&&top<3*h)return h+top;
  if(top>=3*h)return 4*h+top;
  return 1e9+Math.abs(bottom);
}
