// Pick the opposite format after the most recently scheduled quiz.
export function alternatingCards(state,cards,count=8) {
 const used=new Set(Object.entries(state.newImages||{}).filter(([,v])=>v.status!=='rejected').map(([id])=>id));
 const available=cards.filter(c=>!used.has(c.id));
 const latest=Object.entries(state.newImages||{}).filter(([,v])=>v.status==='queued'&&v.dueAt)
  .sort((a,b)=>Date.parse(b[1].dueAt)-Date.parse(a[1].dueAt))[0];
 let next=cards.find(c=>c.id===latest?.[0])?.answerFormat==='reactions'?'letters':'reactions';
 const out=[];
 while(out.length<count&&available.length) {
  let i=available.findIndex(c=>(c.answerFormat||'letters')===next);
  if(i<0)i=0; // Finish the finite catalog when one format is exhausted.
  const [card]=available.splice(i,1);out.push(card);
  next=card.answerFormat==='reactions'?'letters':'reactions';
 }
 return out;
}
