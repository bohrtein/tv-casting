'use strict';

// Excludes visually ambiguous characters: 0/O, 1/I/L. See PROTOCOL.md
// "Room code format".
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

module.exports = { randomCode };
