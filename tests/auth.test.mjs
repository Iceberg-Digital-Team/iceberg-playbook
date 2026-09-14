import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../src/auth/auth.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText;
const {validateSignIn,mockAuthAdapter,getAuthActor}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('empty or malformed sign-in fields give useful errors',()=>{
 assert.ok(validateSignIn('','').email);assert.ok(validateSignIn('','').password);
 assert.ok(validateSignIn('not-an-email','test').email);
 assert.deepEqual(validateSignIn(' test@example.test ','test'),{email:'',password:''});
});
test('mock sign-in returns identity only and never echoes credentials or remember choice',async()=>{
 const session=await mockAuthAdapter.signIn({email:'tester@example.test',password:'test-only-value',remember:true});
 assert.equal(session.user.email,'tester@example.test');
 assert.equal(JSON.stringify(session).includes('test-only-value'),false);
 assert.equal('password' in session,false);
 assert.equal(getAuthActor(session).userId,session.user.id);
 await mockAuthAdapter.signOut();
 await assert.rejects(()=>mockAuthAdapter.signIn({email:'invalid',password:'',remember:false}));
});
