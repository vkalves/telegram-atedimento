import test from 'node:test';
import assert from 'node:assert/strict';
import {peerFromURL,TargetTracker} from './target.js';
test('only exact supported private chat URLs produce a recipient',()=>{
 assert.equal(peerFromURL('https://web.telegram.org/k/#11'),'11');
 assert.equal(peerFromURL('https://web.telegram.org/a/#@alice'),'@alice');
 for(const href of ['https://web.telegram.org/k/','https://web.telegram.org/k/#-10077','https://web.telegram.org/k/#11_23','https://example.com/#11','https://web.telegram.org/z/#11'])assert.equal(peerFromURL(href),null);
});
test('switching conversation clears old recipient and rejects delayed results',()=>{
 const tracker=new TargetTracker();const old=tracker.change('11');const current=tracker.change('22');
 assert.equal(tracker.target,null);assert.equal(tracker.accept(old,{id:'11'}),false);assert.equal(tracker.target,null);
 assert.equal(tracker.accept(current,{id:'22'}),true);assert.equal(tracker.target.id,'22');
 tracker.change(null);assert.equal(tracker.target,null);assert.equal(tracker.accept(current,{id:'22'}),false);
});
