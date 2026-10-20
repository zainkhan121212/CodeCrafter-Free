// Random test data, so solutions cannot hard-code responses.
const WORDS = ['apple', 'banana', 'cherry', 'grape', 'mango', 'orange', 'pear', 'pineapple', 'raspberry', 'strawberry', 'blueberry',
  'watermelon', 'lemon', 'lime', 'kiwi', 'peach', 'plum', 'apricot', 'fig', 'date', 'coconut', 'papaya', 'guava', 'melon',
  'horse', 'tiger', 'zebra', 'panda', 'koala', 'otter', 'eagle', 'falcon', 'shark', 'whale', 'dolphin', 'rabbit', 'monkey',
  'donkey', 'turtle', 'parrot', 'raccoon', 'beaver', 'badger', 'walrus', 'camel', 'llama', 'gecko', 'hippo'];

export const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const word = () => pick(WORDS);
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const words = n => shuffle(WORDS).slice(0, n);
export const key = () => `${word()}:${randInt(1, 999)}`;
export const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[randInt(0, 15)]).join('');
