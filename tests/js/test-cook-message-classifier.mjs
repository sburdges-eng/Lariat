import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImperativeCommand } from '../../lib/cookMessageClassifier.ts';

// The Q-vs-C boundary cases that justify having a code-side classifier
// at all. The LLM's prompt-side router was tripping on "86" as a noun.

test('command: leading "86" verb', () => {
  assert.equal(isImperativeCommand('86 the salmon'), true);
  assert.equal(isImperativeCommand('86 the test-salmon, we just ran out'), true);
  assert.equal(isImperativeCommand('eighty-six the salmon'), true);
  assert.equal(isImperativeCommand('eighty six the line'), true);
});

test('command: other imperative verbs', () => {
  assert.equal(isImperativeCommand('log 5 lb of carrots received'), true);
  assert.equal(isImperativeCommand('mark the walk-in broken'), true);
  assert.equal(isImperativeCommand('give Jenny a gold star'), true);
  assert.equal(isImperativeCommand('add 2 lb prep to the BEO'), true);
  assert.equal(isImperativeCommand('record reach-in cooler at 38F'), true);
  assert.equal(isImperativeCommand('scale chicken stock by 2'), true);
  assert.equal(isImperativeCommand('receive 30 lb pork shoulder at 35F'), true);
});

test('question: "86" as noun (the regression that motivated this module)', () => {
  assert.equal(isImperativeCommand('What is currently 86?'), false);
  assert.equal(isImperativeCommand("what's 86 today?"), false);
  assert.equal(isImperativeCommand('Is salmon 86 today?'), false);
  assert.equal(isImperativeCommand('Anything 86?'), false);
  assert.equal(isImperativeCommand('Are any items 86?'), false);
});

test('question: leading interrogatives', () => {
  assert.equal(isImperativeCommand('What recipes use heavy cream?'), false);
  assert.equal(isImperativeCommand('How much salmon do we have?'), false);
  assert.equal(isImperativeCommand('Where does the queso live?'), false);
  assert.equal(isImperativeCommand('Why is the walk-in warm?'), false);
  assert.equal(isImperativeCommand('Can I substitute lime for lemon?'), false);
  assert.equal(isImperativeCommand('Do we have any pork shoulder left?'), false);
});

test('question: any question mark forces question, even with imperative-looking lead', () => {
  // A cook hedges with a question mark — respect it. They probably want
  // to confirm before issuing the action.
  assert.equal(isImperativeCommand('86 the salmon?'), false);
  assert.equal(isImperativeCommand('Mark walk-in broken?'), false);
});

test('ambiguous: bare statement, no question word, no imperative verb → question (conservative)', () => {
  assert.equal(isImperativeCommand('The salmon is out'), false);
  assert.equal(isImperativeCommand('walk-in feels warm'), false);
  assert.equal(isImperativeCommand('Hello'), false);
  assert.equal(isImperativeCommand('thanks'), false);
});

test('case insensitivity', () => {
  assert.equal(isImperativeCommand('86 THE SALMON'), true);
  assert.equal(isImperativeCommand('LOG 5 LB OF CARROTS'), true);
  assert.equal(isImperativeCommand('IS X 86?'), false);
});

test('whitespace and empty inputs', () => {
  assert.equal(isImperativeCommand(''), false);
  assert.equal(isImperativeCommand('   '), false);
  assert.equal(isImperativeCommand('\n\t'), false);
  assert.equal(isImperativeCommand('  86 the salmon  '), true);
});

test('non-string inputs', () => {
  assert.equal(isImperativeCommand(null), false);
  assert.equal(isImperativeCommand(undefined), false);
  assert.equal(isImperativeCommand(86), false);
  assert.equal(isImperativeCommand({}), false);
  assert.equal(isImperativeCommand([]), false);
});
