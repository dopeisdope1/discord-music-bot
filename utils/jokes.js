const CLEAR_JOKES = [
  "el kenchef t'as vidé",
  "zoubini t'as sucé",
  "machini t'as gobé",
  "zambouli t'as aspiré",
  "moro t'as mangé tout tes morts",
];

const randomClearJoke = () => CLEAR_JOKES[Math.floor(Math.random() * CLEAR_JOKES.length)];

module.exports = { CLEAR_JOKES, randomClearJoke };
