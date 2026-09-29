// Shared production-aligned physics globals for src/net.js VM tests.
// Keep this intentionally small: only values netcode prediction/validation
// consumes directly. The contract test below fails if game.js changes them.
export const NET_TEST_PHYSICS = Object.freeze({
  PUCK_R: 26,
  MALLET_R: 46,
  PUCK_MAX: 3100,
  SMACK_BONUS: 0.55,
  PLAYER_CAP: 4200,
});
