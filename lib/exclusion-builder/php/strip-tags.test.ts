/**
 * PHP's `strip_tags` port. Every expectation is PHP 8.1.34's own output for
 * the input (`strip_tags($input)`, no allowed tags).
 */
import { describe, expect, it } from 'vitest';
import { stripTags } from './strip-tags';

describe('stripTags', () => {
  it.each([
    // Tags, and text around them.
    ['a<b>c', 'ac'],
    ['a>b', 'a>b'],
    ['<<b>a>', ''],
    ['a<b\n>c', 'ac'],
    // `<` + whitespace is text.
    ['a < b', 'a < b'],
    ['a<\tb>c', 'a<\tb>c'],
    // Quotes inside a tag hide `>`; a quote outside a tag is text.
    ['a<b c="x>y">d', 'ad'],
    ["a<b c='x>y'>d", 'ad'],
    ['<a href="x\'y">z', 'z'],
    ['a"b<c', 'a"b'],
    // A `<` inside a tag nests: the next `>` closes the inner level.
    ['a<b<c>d>e', 'ae'],
    ['a<b<c>>d', 'ad'],
    ['x<a<!--b-->c>d', 'xcd'],
    // Comments and declarations.
    ['a<!-- x -->b', 'ab'],
    ['a<!-- x > y -->b', 'ab'],
    ['<!---->x', 'x'],
    ['x<!--a"-->y', 'xy'],
    ['x<!a "q>" >y', 'xy'],
    ['a<!doctype html>b', 'ab'],
    ['a<!DOCTYPE<x>>b', 'ab'],
    // Processing blocks: `?>` ends them outside quotes and parentheses.
    ['a<?php echo 1; ?>b', 'ab'],
    ['a<?php ">" ?>b', 'ab'],
    ['a<?php (">") ?>b', 'ab'],
    ['a<?= ?>b', 'ab'],
    ['a<?x(?>b', 'a'],
    ['a<?xml v="1"?>b', 'ab'],
    ['x<a<?b"?>"?>d', 'xd'],
    // A nesting level opened in a tag is closed by a `>` inside a block or declaration.
    ['x<a<?b>c?>d', 'xd'],
    ['x<a<!b>c>d', 'xd'],
    ["x<!a'>'>d", 'xd'],
    // NUL outside a tag is dropped; an unclosed tag swallows the rest.
    ['a\0b', 'ab'],
    ['<a\0b>c', 'c'],
    ['a<', 'a'],
    ['a<b', 'a']
  ])('%j → %j', (input, expected) => {
    expect(stripTags(input)).toBe(expected);
  });

  it('keeps non-ASCII text, which never decides a state', () => {
    expect(stripTags('é<b>😀</b> ')).toBe('é😀 ');
  });
});
