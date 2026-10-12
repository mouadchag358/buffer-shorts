import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMediaEdit,findScheduledQuizImages} from '../src/refresh-facebook-quiz-media.js';

const q={id:'quiz-001',image:'pop-culture/cards/quiz-001.png',caption:'QUIZ TIME! One question?\nA) Foo'};
const channel='facebook-channel';
const dueAt='2026-10-15T06:00:00.000Z';
const make=(data={})=>({id:'post-a',channelId:channel,status:'scheduled',dueAt,text:q.caption,
  assets:[{source:'https://buffer-cdn.test/file',mimeType:'image/png'}],...data});
test('media edit changes only image and Facebook type, never time, status, text or channel',()=>{
 const input=buildMediaEdit(make(),q,'a'.repeat(40));
 assert.deepEqual(Object.keys(input).sort(),['assets','id','metadata']);
 assert.deepEqual(input.metadata,{facebook:{type:'post'}});
 assert.equal(input.assets[0].image.url,'https://raw.githubusercontent.com/mouadchag358/buffer-shorts/'+ 'a'.repeat(40)+'/pop-culture/cards/quiz-001.png');
});
test('recognizes only confirmed scheduled Facebook quiz images, excludes Reels',()=>{
 const posts=[
   make(),
   make({id:'video',assets:[{mimeType:'video/mp4',source:'https://buffer-cdn.test/opaque'}]}),
   make({id:'another-channel',channelId:'instagram'}),
   make({id:'another-caption',text:'Unrelated'}),make({id:'sent',status:'sent'})
 ];
 const x=findScheduledQuizImages(posts,[q],['quiz-001'],channel);
 assert.equal(x.selected.length,1);
 assert.equal(x.selected[0].post.id,'post-a');
 assert.deepEqual(x.unsafe,[{id:'video',quizId:'quiz-001',reason:'video media'}]);
});
test('never treats unknown opaque media as an image',()=>{
 const x=findScheduledQuizImages([make({assets:[{source:'https://buffer-cdn.test/opaque',mimeType:null}]})],[q],['quiz-001'],channel);
 assert.equal(x.selected.length,0); assert.equal(x.unsafe.length,1);
});
