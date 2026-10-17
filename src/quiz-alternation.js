// Facebook quizzes use reactions only. Legacy letter cards stay in the archive.
export function alternatingCards(state,cards,count=8) {
 const used=new Set(Object.entries(state.newImages||{}).filter(([,v])=>v.status!=='rejected').map(([id])=>id));
 return cards.filter(c=>c.answerFormat==='reactions'&&!used.has(c.id)).slice(0,count);
}
