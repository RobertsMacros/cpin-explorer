import test from "node:test";
import assert from "node:assert/strict";
import {firstName} from "../../prototypes/shared/account-profile.js";
test("greeting infers the first name and respects the account holder's correction",()=>{
  assert.equal(firstName({name:"Robert M Stevens"}),"Robert");
  assert.equal(firstName({name:" Dr. Amélie Smith "}),"Amélie");
  assert.equal(firstName({name:"Jean-Luc Dupont"}),"Jean-Luc");
  assert.equal(firstName({name:"Wrong Guess",firstName:"Mary Ann"}),"Mary Ann");
  assert.equal(firstName({name:"   "}),"");
});
