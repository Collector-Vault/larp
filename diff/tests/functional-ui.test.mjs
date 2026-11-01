import test from 'node:test';import assert from 'node:assert/strict';
import {functionalHtml} from '../public/project.js';
test('green is scoped to a fresh linked service observation, never investment or affiliation verdict',()=>{
 const f={status:'observed',color:'green',checkedAt:100,expiresAt:200,capability:'Quote computation',observations:[],affiliation:'unverified'};
 assert.match(functionalHtml(f,150),/Quote route available/);assert.match(functionalHtml(f,150),/Token affiliation is unverified/);
 assert.doesNotMatch(functionalHtml(f,201),/tech-good/);assert.doesNotMatch(functionalHtml({...f,status:'unavailable'},150),/tech-good/);
 assert.doesNotMatch(functionalHtml(null,150),/tech-good/);
});
