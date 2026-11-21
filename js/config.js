// Data tables: items, cosmetics, jobs, NPC personalities, progression.

// shape: box [w,h,d] | cyl [r,h] | sphere [r] | compound kinds (cart, mop, chair, sign)
// grip: 0..1 how tightly the object follows your hand (heavy things lag)
export const ITEMS = {
  cereal:   { shape: 'box', size: [0.2, 0.28, 0.07], mass: 0.4, color: 0xf4b400, accent: 0xe53935, label: 'Cereal' },
  milk:     { shape: 'box', size: [0.1, 0.24, 0.1], mass: 1.0, color: 0xffffff, accent: 0x42a5f5, label: 'Milk' },
  soda:     { shape: 'cyl', size: [0.035, 0.12], mass: 0.35, color: 0xe53935, label: 'Soda Can' },
  tp:       { shape: 'cyl', size: [0.06, 0.11], mass: 0.15, color: 0xf5f5f5, label: 'Toilet Paper' },
  melon:    { shape: 'sphere', size: [0.14], mass: 4, color: 0x2e7d32, label: 'Watermelon' },
  banana:   { shape: 'box', size: [0.2, 0.04, 0.05], mass: 0.15, color: 0xffeb3b, label: 'Banana' },
  chips:    { shape: 'box', size: [0.18, 0.24, 0.06], mass: 0.15, color: 0x8e24aa, accent: 0xffd54f, label: 'Chips' },
  box:      { shape: 'box', size: [0.45, 0.35, 0.45], mass: 3, color: 0xc49a6c, accent: 0x8d6e63, label: 'Cardboard Box' },
  stock:    { shape: 'box', size: [0.24, 0.24, 0.24], mass: 1, color: 0xd7a86e, accent: 0x4caf50, label: 'Stock Box' },
  ball:     { shape: 'sphere', size: [0.09], mass: 0.2, color: 0xff4081, label: 'Bouncy Ball', mat: 'bouncy' },
  bball:    { shape: 'sphere', size: [0.12], mass: 0.5, color: 0xff7a1a, label: 'Basketball', mat: 'bouncy' },
  duck:     { shape: 'sphere', size: [0.07], mass: 0.1, color: 0xffd600, label: 'Rubber Duck', mat: 'bouncy' },
  block:    { shape: 'box', size: [0.15, 0.15, 0.15], mass: 0.3, color: 0x29b6f6, label: 'Toy Block' },
  teddy:    { shape: 'box', size: [0.25, 0.35, 0.18], mass: 0.6, color: 0x8d6e63, label: 'Teddy Bear' },
  cone:     { shape: 'cyl', size: [0.15, 0.5], mass: 1, color: 0xff6d00, label: 'Traffic Cone' },
  patty:    { shape: 'cyl', size: [0.06, 0.025], mass: 0.15, color: 0xf48fb1, label: 'Raw Patty' },
  fries:    { shape: 'box', size: [0.09, 0.14, 0.06], mass: 0.15, color: 0xd32f2f, accent: 0xffd54f, label: 'Fries' },
  cup:      { shape: 'cyl', size: [0.045, 0.16], mass: 0.3, color: 0x1e88e5, label: 'Soda Cup' },
  cart:     { shape: 'cart', size: [0.6, 1.0, 0.95], mass: 14, color: 0xb0bec5, label: 'Shopping Cart', grip: 0.35, mat: 'slippery' },
  mop:      { shape: 'mop', size: [0.08, 1.3, 0.08], mass: 1.2, color: 0x1565c0, label: 'Mop', grip: 0.7 },
  chair:    { shape: 'chair', size: [0.45, 0.85, 0.45], mass: 4, color: 0xff7043, label: 'Chair', grip: 0.5 },
  wetsign:  { shape: 'box', size: [0.35, 0.6, 0.08], mass: 1, color: 0xffeb3b, label: 'Wet Floor Sign' },
  // ---- Update 2: employee equipment (snap = held like a tool, nozzle aims where your controller points) ----
  extinguisher: { shape: 'ext', size: [0.075, 0.42], mass: 2.5, color: 0xd50000, label: 'Fire Extinguisher', grip: 0.8, noBurn: true,
    snap: { handle: [0, 0.2, 0.02] }, spray: { kind: 'foam', range: 3.4, rate: 0.75, nozzle: [0, 0.2, -0.12], sound: 'spray' } },
  sprayer:  { shape: 'box', size: [0.07, 0.2, 0.07], mass: 0.4, color: 0x29b6f6, accent: 0xffffff, label: 'Water Sprayer', noBurn: true,
    snap: { handle: [0, -0.02, 0] }, spray: { kind: 'water', range: 3.6, rate: 0.35, nozzle: [0, 0.11, -0.05], sound: 'spray', puddles: true } },
  hose:     { shape: 'hose', size: [0.035, 0.22], mass: 0.8, color: 0xffb300, label: 'Fire Hose', grip: 0.9, noBurn: true,
    snap: { handle: [0, 0, 0.06] }, spray: { kind: 'water', range: 6.5, rate: 1.0, nozzle: [0, 0, -0.12], sound: 'spray', puddles: true } },
  blowtorch:{ shape: 'torch', size: [0.06, 0.28], mass: 1.2, color: 0x78909c, label: 'Cartoon Blowtorch', noBurn: true,
    snap: { handle: [0, -0.05, 0.04] }, spray: { kind: 'flame', range: 1.7, rate: 1, nozzle: [0, 0.06, -0.16], sound: 'fireIgnite' } },
  blower:   { shape: 'blower', size: [0.16, 0.2, 0.3], mass: 2, color: 0xff6d00, label: 'Leaf Blower', grip: 0.8, noBurn: true,
    snap: { handle: [0, 0.08, 0.06] }, spray: { kind: 'air', range: 3.6, rate: 1, nozzle: [0, 0, -0.42], sound: 'leafBlower' } },
  megaphone:{ shape: 'mega', size: [0.12, 0.3], mass: 0.6, color: 0xffffff, label: 'Megaphone', noBurn: true, snap: { handle: [0, -0.06, 0.08] } },
  chicken:  { shape: 'chicken', size: [0.08, 0.45, 0.08], mass: 0.3, color: 0xffeb3b, label: 'Rubber Chicken', mat: 'bouncy' },
  peel:     { shape: 'box', size: [0.14, 0.02, 0.12], mass: 0.05, color: 0xfdd835, label: 'Banana Peel' },
  // ---- Update 3 ----
  basket:   { shape: 'basket', size: [0.46, 0.26, 0.32], mass: 0.8, color: 0xe53935, label: 'Shopping Basket', grip: 0.9 },
  blaster:  { shape: 'blaster', size: [0.08, 0.2, 0.38], mass: 0.8, color: 0xff6d00, label: 'Foam Dart Blaster', noBurn: true,
    snap: { handle: [0, -0.06, 0.08] }, blast: { proj: 'dart', speed: 17, rate: 0.2, spread: 0.025, nozzle: [0, 0.03, -0.22], sound: 'pew' } },
  launcher: { shape: 'launcher', size: [0.14, 0.2, 0.55], mass: 2, color: 0x7c4dff, label: 'Boing Ball Launcher', grip: 0.8, noBurn: true,
    snap: { handle: [0, -0.08, 0.12] }, blast: { proj: 'boing', speed: 12, rate: 0.75, spread: 0.01, nozzle: [0, 0.03, -0.32], sound: 'thwomp' } },
  icecream: { shape: 'box', size: [0.16, 0.1, 0.12], mass: 0.4, color: 0xf8bbd0, accent: 0x6d4c41, label: 'Ice Cream' },
  pizza:    { shape: 'cyl', size: [0.18, 0.03], mass: 0.3, color: 0xffb74d, label: 'Pizza' },
  taco:     { shape: 'box', size: [0.16, 0.08, 0.08], mass: 0.15, color: 0xffd54f, accent: 0x7cb342, label: 'Taco' },
  noodles:  { shape: 'cyl', size: [0.07, 0.1], mass: 0.3, color: 0xffffff, label: 'Noodle Cup' },
  popcorn:  { shape: 'box', size: [0.12, 0.18, 0.12], mass: 0.15, color: 0xffffff, accent: 0xe53935, label: 'Popcorn' },
  phone:    { shape: 'box', size: [0.08, 0.16, 0.012], mass: 0.18, color: 0x212121, label: 'Phone' },
  book:     { shape: 'box', size: [0.16, 0.22, 0.04], mass: 0.4, color: 0x1565c0, label: 'Book' },
  pillow:   { shape: 'box', size: [0.5, 0.12, 0.35], mass: 0.4, color: 0xfff9c4, label: 'Pillow', mat: 'bouncy' },
  apple:    { shape: 'sphere', size: [0.045], mass: 0.15, color: 0xd32f2f, label: 'Apple' },
  lamp:     { shape: 'lamp', size: [0.3, 1.4, 0.3], mass: 3, color: 0xffe082, label: 'Lamp', grip: 0.7 },
};
// Instanced rendering: these simple items share one draw call per type (huge mall = lots of stuff)
export const INSTANCED = ['cereal', 'milk', 'soda', 'tp', 'banana', 'chips', 'box', 'stock', 'block', 'ball', 'melon', 'icecream',
  'pizza', 'taco', 'noodles', 'popcorn', 'phone', 'book', 'pillow', 'apple', 'patty', 'fries', 'teddy', 'peel'];

// Employee Supply shop. 'item' = object spawned when you press GET.
export const GEAR = [
  { id: 'extinguisher', name: 'Fire Extinguisher', price: 50, desc: 'Foam blaster. Puts out fires.' },
  { id: 'sprayer', name: 'Water Sprayer', price: 35, desc: 'Weak, but makes puddles. Chaos.' },
  { id: 'mop', name: 'Mop', price: 20, desc: 'For spills. Or jousting.' },
  { id: 'blowtorch', name: 'Cartoon Blowtorch', price: 120, desc: 'Totally fictional. Sets things on (cartoon) fire.' },
  { id: 'blower', name: 'Leaf Blower', price: 140, desc: 'Blasts objects and toupees across the mall.' },
  { id: 'megaphone', name: 'Megaphone', price: 70, desc: 'Make announcements. Startle grandmas.' },
  { id: 'chicken', name: 'Rubber Chicken', price: 25, desc: 'Squeaks. Slaps. Legally a weapon? No.' },
  { id: 'peel', name: 'Banana Peel x3', price: 15, desc: 'Classic. Shoppers slip on them.' },
  { id: 'wetsign', name: 'Wet Floor Sign', price: 10, desc: 'Look responsible.' },
  { id: 'blaster', name: 'Foam Dart Blaster', price: 60, desc: 'Rapid-fire harmless foam darts. Pew pew.' },
  { id: 'launcher', name: 'Boing Ball Launcher', price: 150, desc: 'Giant bouncy balls. Huge knockback.' },
];

// Fire tuning (cartoon flames)
export const FIRE = {
  ashTime: 9,          // seconds an object can burn before it crumbles (=> BABY ASH)
  babyCooldown: 40,    // min seconds between Baby Ash moments (keeps it special)
  maxFires: 10,
  spreadEvery: 2.5, spreadRadius: 0.8,
  autoSprinklerAfter: 30, // fire event: sprinklers kick in if players ignore it this long
};

export const PRODUCT_POOL = ['cereal', 'milk', 'soda', 'tp', 'banana', 'chips', 'melon'];

// ---- Cosmetics ----
export const SKINS = [0xffd7b5, 0xf1c27d, 0xc68642, 0x8d5524, 0x5c3a21, 0x9be7a5, 0xb39ddb, 0x81d4fa];
export const COLORS = [0xe53935, 0xff9800, 0xffd23f, 0x43a047, 0x1e88e5, 0x8e24aa, 0xff4f9a, 0x263238, 0xffffff, 0x00bfa5];
// price 0 = free. 'ach' = unlocked by achievement instead of money
export const HATS = [
  { id: 'none', name: 'No Hat', price: 0 },
  { id: 'cap', name: 'Ball Cap', price: 0 },
  { id: 'beanie', name: 'Beanie', price: 40 },
  { id: 'chef', name: 'Chef Hat', price: 80 },
  { id: 'cone', name: 'Traffic Cone', price: 120 },
  { id: 'tophat', name: 'Top Hat', price: 200 },
  { id: 'propeller', name: 'Propeller', price: 300 },
  { id: 'crown', name: 'Crown', price: 0, ach: 'richish' },
];
export const ACCS = [
  { id: 'none', name: 'Nothing', price: 0 },
  { id: 'shades', name: 'Shades', price: 0 },
  { id: 'mustache', name: 'Mustache', price: 50 },
  { id: 'bowtie', name: 'Bow Tie', price: 60 },
  { id: 'nose', name: 'Clown Nose', price: 90 },
  { id: 'headphones', name: 'Headphones', price: 150 },
  { id: 'badge', name: 'Mall Cop Badge', price: 0, ach: 'mallcop' },
];
export const DEFAULT_LOOK = { skin: 0, shirt: 4, pants: 7, hat: 'cap', acc: 'none' };

// ---- Jobs ----
export const JOBS = {
  cashier: { name: 'Cashier', pay: 12, desc: 'Scan customer items at a Mega Mart register.' },
  stocker: { name: 'Stocker', pay: 8, desc: 'Grab stock boxes from Storage, fill the glowing shelf slots.' },
  janitor: { name: 'Janitor', pay: 10, desc: 'Grab a mop from Storage and scrub the spills.' },
  food:    { name: 'Food Worker', pay: 15, desc: 'Make orders at Chow Town. Cook patties on the grill!' },
  security:{ name: 'Security', pay: 20, desc: 'Walk the patrol checkpoints. Tag shoplifters!' },
};

export const UPGRADES = [
  { id: 'scanner', name: 'Laser Scanner', desc: 'Cashier pay +50%', price: 150, job: 'cashier' },
  { id: 'turbomop', name: 'Turbo Mop', desc: 'Janitor pay +50%', price: 150, job: 'janitor' },
  { id: 'tipjar', name: 'Tip Jar', desc: 'Food pay +50%', price: 200, job: 'food' },
  { id: 'forklift', name: 'Forklift License', desc: 'Stocker pay +50%', price: 150, job: 'stocker' },
  { id: 'whistle', name: 'Golden Whistle', desc: 'Security pay +50%', price: 200, job: 'security' },
];
export const AREAS = [
  { id: 'arcade', name: 'Pixel Palace Arcade', desc: 'Basketball + Whack-a-Button', price: 250 },
];

export const ACHIEVEMENTS = [
  { id: 'firstpay', name: 'First Paycheck', desc: 'Earn money from a job', stat: 'jobsDone', goal: 1 },
  { id: 'yeet', name: 'Professional Yeeter', desc: 'Throw 50 things', stat: 'thrown', goal: 50 },
  { id: 'scan', name: 'Beep Beep', desc: 'Scan 40 items', stat: 'scanned', goal: 40 },
  { id: 'clean', name: 'Squeaky Clean', desc: 'Clean 15 spills', stat: 'cleaned', goal: 15 },
  { id: 'bonk', name: 'Bowling Champion', desc: 'Bonk 10 shoppers', stat: 'bonks', goal: 10 },
  { id: 'swish', name: 'Nothing But Net', desc: 'Make 10 hoops', stat: 'swishes', goal: 10 },
  { id: 'order', name: 'Order Up!', desc: 'Serve 10 food orders', stat: 'served', goal: 10 },
  { id: 'mallcop', name: 'Mall Cop', desc: 'Catch 3 shoplifters', stat: 'caught', goal: 3, reward: 'Badge accessory' },
  { id: 'richish', name: 'Rich-ish', desc: 'Earn $1000 total', stat: 'earned', goal: 1000, reward: 'Crown hat' },
  { id: 'chaos', name: 'Chaos Survivor', desc: 'Live through 5 mall events', stat: 'events', goal: 5 },
  { id: 'secret', name: 'You Saw Nothing', desc: 'Find the secret button', stat: 'secret', goal: 1 },
  { id: 'firefighter', name: 'Certified Firefighter', desc: 'Put out 10 fires', stat: 'extinguished', goal: 10 },
  { id: 'babyash', name: 'Witness', desc: 'Experience the Baby Ash', stat: 'babyash', goal: 1 },
  { id: 'peel', name: 'Slapstick Master', desc: 'Make shoppers slip 5 times', stat: 'slips', goal: 5 },
];

export const DAILY_POOL = [
  { id: 'd_throw', text: 'Throw 25 things', stat: 'thrown', goal: 25, reward: 60 },
  { id: 'd_scan', text: 'Scan 15 items', stat: 'scanned', goal: 15, reward: 80 },
  { id: 'd_clean', text: 'Clean 5 spills', stat: 'cleaned', goal: 5, reward: 70 },
  { id: 'd_bonk', text: 'Bonk 3 shoppers', stat: 'bonks', goal: 3, reward: 50 },
  { id: 'd_serve', text: 'Serve 4 orders', stat: 'served', goal: 4, reward: 90 },
  { id: 'd_stock', text: 'Stock 12 shelf slots', stat: 'stocked', goal: 12, reward: 70 },
  { id: 'd_patrol', text: 'Finish 2 patrols', stat: 'patrols', goal: 2, reward: 80 },
  { id: 'd_earn', text: 'Earn $150', stat: 'earned', goal: 150, reward: 60 },
  { id: 'd_swish', text: 'Make 5 hoops', stat: 'swishes', goal: 5, reward: 60 },
  { id: 'd_fire', text: 'Put out 3 fires', stat: 'extinguished', goal: 3, reward: 90 },
  { id: 'd_slip', text: 'Make 2 shoppers slip', stat: 'slips', goal: 2, reward: 60 },
];

// ---- NPCs ----
export const PERSONALITIES = {
  chill: { speed: 1.0, colors: [4, 7], hat: 'beanie', acc: 'shades',
    idle: ['Vibes are immaculate today.', 'Just browsing, my dude.', 'This mall slaps.', 'Love the elevator music.'],
    hit: ['Whoa, not cool!', 'Duuude.', 'My vibe! Ruined!'],
    near: ['Sup.', 'Nice hat, friend.', 'You work here?'],
    confused: ['Is that... a {item} on the floor?', 'Abstract art, probably.'] },
  karen: { speed: 1.15, colors: [6, 8], hat: 'none', acc: 'none',
    idle: ['Where is the MANAGER?', 'These prices are criminal.', 'I have a coupon from 1997.', 'I need to speak to someone.'],
    hit: ['I am calling CORPORATE!', 'Do you know who I AM?', 'UNACCEPTABLE!'],
    near: ['Are you the manager?', 'Excuse me. EXCUSE me.', 'Back up, please.'],
    confused: ['Why is there a {item} here?! Unbelievable.', 'Who left this {item}?!'] },
  nervous: { speed: 1.3, colors: [3, 1], hat: 'cap', acc: 'none',
    idle: ['Is it hot in here?', 'Everyone is looking at me...', 'Okay. Okay okay okay.'],
    hit: ['AAAAH!', 'I knew it! I KNEW it!', 'Not again!'],
    near: ['P-please don\'t throw anything.', 'Hi! Bye!', 'Eep.'],
    confused: ['Is that {item} going to explode?', 'Nope. Nope nope.'] },
  kid: { speed: 1.8, colors: [2, 0], hat: 'propeller', acc: 'none', small: true,
    idle: ['WHEEEE!', 'I want a TOY!', 'Mom said I could!', 'I\'m gonna be an astronaut!'],
    hit: ['OW! I\'m telling!', 'Again! Again!', 'MOOOM!'],
    near: ['Are you a robot?', 'Can you throw me?', 'You\'re weird. I like you.'],
    confused: ['Ooh, a {item}!', 'Finders keepers!'] },
  grandpa: { speed: 0.6, colors: [8, 7], hat: 'tophat', acc: 'mustache',
    idle: ['Back in my day, malls had fountains.', 'Where did I park my car?', 'What year is it?'],
    hit: ['Whippersnapper!', 'My hip!', 'I fought in a war for this?'],
    near: ['Hello, sonny.', 'Have you seen my car?', 'You remind me of my nephew.'],
    confused: ['Is this {item} mine?', 'Hmm... a {item}. In MY day...'] },
  influencer: { speed: 1.1, colors: [6, 2], hat: 'none', acc: 'headphones',
    idle: ['Hey guys, welcome back to my channel!', 'Smash that like button!', 'This lighting is SO good.'],
    hit: ['That\'s going in the video!', 'Content! CONTENT!', 'Ugh, my followers!'],
    near: ['Wanna be in my vlog?', 'Say hi to the fans!', 'You\'re so random lol.'],
    confused: ['A {item}? This is going viral.', 'Wait, is this {item} a trend?'] },
};

// ---- Update 2 characters. model: uploaded GLB to use (null = blocky). behavior: special AI routine ----
Object.assign(PERSONALITIES, {
  grandma: { speed: 0.7, colors: [6, 8], hat: 'none', acc: 'none', behavior: 'cart', hunch: 0.25,
    idle: ['Prices were a nickel in my day.', 'Where are the prunes?', 'My grandson plays these video games.'],
    hit: ['I have a BLACK BELT, sweetie!', 'You rascal!', 'My CART!'],
    near: ['Out of the way, sweetie!', 'Coming through! Old lady with a cart!', 'Hello dear. MOVE.'],
    confused: ['Is this {item} on sale?', 'Who dropped this {item}? Kids these days.'] },
  oldman: { model: 'man', speed: 0.65, colors: [7, 8], hat: 'tophat', acc: 'mustache', behavior: 'stare',
    idle: ['Hmm.', 'Mmhm.', 'I used to own this mall. Probably.'],
    hit: ['...', 'Rude.', 'I felt that in 1974.'],
    near: ['...', '*stares*', 'Hm.'],
    confused: ['A {item}. Fascinating.', '...{item}.'] },
  angry: { model: 'man', speed: 1.2, colors: [0, 7], hat: 'cap', acc: 'none', behavior: 'complain', dramatic: true,
    idle: ['This mall is a DISGRACE.', 'I want a REFUND. For everything.', 'Who designed this place?!'],
    hit: ['THAT\'S IT! I\'M LEAVING!', 'One star! ONE STAR!', 'YOU WILL HEAR FROM MY LAWYER!'],
    near: ['What are YOU looking at?', 'Don\'t even.', 'Get your own aisle!'],
    confused: ['Who left a {item} here?! UNBELIEVABLE.', 'A {item}?! In THIS economy?!'],
    complain: ['And ANOTHER thing!', 'The music is too loud!', 'The floors are too shiny!', 'I hate fountains!', 'Nobody respects me!'] },
  confused: { model: 'girl', speed: 0.9, colors: [3, 4], hat: 'none', acc: 'none', behavior: 'lost',
    idle: ['Where is the exit?', 'Did I park in level 3? There is no level 3.', 'Which way is north?'],
    hit: ['Ow! Was that the exit?', 'Huh?!', 'Is this a store?'],
    near: ['Do you work here? Where am I?', 'Is this the cinema?', 'Hi! I\'m lost!'],
    confused: ['Is this {item} a map?', 'Oh! A {item}! ...Why?'],
    employee: ['Is... that part of your job?', 'Should you be doing that?', 'I don\'t think that\'s allowed.'] },
  guard: { model: 'guard', speed: 1.1, colors: [4, 7], hat: 'cap', acc: 'badge', behavior: 'investigate',
    idle: ['Everything is under control.', 'I\'m watching you. All of you.', 'Mall cop. Not mall flop.'],
    hit: ['ASSAULTING AN OFFICER?!', 'That\'s going in my report!', 'I\'m calling for backup! ...Backup?'],
    near: ['Move along, citizen.', 'Keep it moving.', 'You look suspicious.'],
    confused: ['Hmm. A {item}. Evidence.', 'Suspicious {item} detected.'] },
  trainee: { speed: 1.0, colors: [1, 7], hat: 'cap', acc: 'none', behavior: 'trainee',
    idle: ['Welcome to the mall! Please don\'t.', 'It\'s my first day!', 'I\'m not paid enough for this.'],
    hit: ['I\'m just a TRAINEE!', 'This is a workplace!', 'HR! HR!'],
    near: ['Can I help you? Please say no.', 'Hi! Do you know how the register works?', 'Have you seen my manager?'],
    confused: ['Was I supposed to stock this {item}?', 'Oops, my {item}.'] },
  tourist: { model: 'girl', speed: 0.95, colors: [2, 4], hat: 'cap', acc: 'shades', behavior: 'photos',
    idle: ['So THIS is a mall!', 'Amazing architecture!', 'My followers back home will love this!'],
    hit: ['My camera!', 'Is this a local custom?', 'Ow! Very authentic!'],
    near: ['Picture! Picture!', 'Smile, local person!', 'Is this the famous fountain?'],
    confused: ['Ooh! A {item}! Very cultural!', 'Must photograph this {item}!'] },
});
Object.assign(PERSONALITIES, {
  lazy: { speed: 0.5, colors: [1, 7], hat: 'cap', acc: 'none', behavior: 'lazy',
    idle: ['Zzz...', 'Five more minutes...', 'Is my shift over?'],
    hit: ['I\'M AWAKE! I\'m awake.', 'I was resting my eyes!', 'Ow. Anyway, zzz...'],
    near: ['Mmf. What.', 'Store\'s closed. ...For me.', 'Ask someone else.'],
    confused: ['A {item}? Not my department.', 'Somebody else will get that {item}.'] },
  manager: { speed: 1.05, colors: [7, 8], hat: 'none', acc: 'bowtie', behavior: 'manager',
    idle: ['Productivity is UP. Smiles are DOWN.', 'Synergy. SYNERGY.', 'I have a meeting about meetings.'],
    hit: ['I am WRITING THIS DOWN.', 'That is a FORMAL complaint.', 'See me in my office!'],
    near: ['Running is NOT permitted.', 'Is that a smile? Wipe it off.', 'I\'m going to need you to fill out form 27B.'],
    confused: ['Who is responsible for this {item}?!', 'This {item} is a violation.'],
    lecture: ['This is a PLACE OF BUSINESS.', 'I\'m writing you up.', 'Do you have a receipt for that attitude?', 'Policy 4.2: no fun.', 'I\'ve called your mother.'] },
  brat: { speed: 1.7, colors: [6, 2], hat: 'propeller', acc: 'none', small: true, behavior: 'brat',
    idle: ['I\'M BORED!', 'Buy me something!', 'Are we done yet?!'],
    hit: ['WAAAAAH!', 'I\'M TELLING MY MOM!', 'You\'re a MEANIE!'],
    near: ['Whatcha doing? Whatcha doing?', 'Can I have that?', 'Why? Why? Why?', 'MOM! This person is weird!', 'Are you a robot? Prove it.'],
    confused: ['A {item}! Can I lick it?', 'I\'m keeping this {item}.'] },
  weird: { speed: 0.8, colors: [5, 9], hat: 'cone', acc: 'nose', behavior: 'weird',
    idle: ['The cereal speaks to me.', 'I\'m shopping for a new personality.', 'Have you ever... smelled a cart?', 'I come here to feel things.'],
    hit: ['Thank you. I needed that.', 'Again, please. For science.', 'Ow. Delightful.'],
    near: ['You have the aura of a rotisserie chicken.', 'Hello. I am a normal customer.', 'Do you also hear the fluorescent lights?'],
    confused: ['Hello, {item}. Long time no see.', 'This {item} owes me money.'] },
  cashier: { speed: 0.8, colors: [3, 7], hat: 'cap', acc: 'none', behavior: 'cashier',
    idle: ['Next!', 'Did you find everything okay? Don\'t answer.', 'Paper or plastic? Trick question.'],
    hit: ['I\'m on the CLOCK!', 'Manager! MANAGER!', 'Price check on my DIGNITY!'],
    near: ['Next in line!', 'Put it on the belt.', 'Would you like to donate a dollar to my vacation?'],
    confused: ['Is this {item} yours?', 'Does this {item} have a barcode?'] },
});
// [personality, floor (0 = ground, 1 = L2), area hint] — NPCs spawn at a random point of interest on their floor
export const NPC_ROSTER = [
  ['grandma', 0, 'market'], ['grandma', 0, 'market'], ['weird', 0, 'market'], ['trainee', 0, 'market'], ['manager', 0, 'market'], ['brat', 0, 'market'],
  ['cashier', 0, 'lane3'], ['cashier', 0, 'lane4'],
  ['oldman', 0], ['angry', 0], ['confused', 0], ['guard', 0], ['guard', 0], ['tourist', 0], ['karen', 0], ['kid', 0], ['chill', 0], ['nervous', 0], ['lazy', 0, 'electronics'], ['influencer', 0],
  ['chill', 1], ['nervous', 1], ['lazy', 1, 'cafe'], ['tourist', 1, null, 'nomodel'],
];

export const ANNOUNCEMENTS = [
  'Attention shoppers: would the owner of a blue shopping cart please stop letting it roam free.',
  'Reminder: the fountain is not a hot tub.',
  'Lost child at the Toy Tornado. He says his name is Captain Thunderpants.',
  'Mega Mart is now offering a two-for-one deal on suspicious bananas.',
  'Please do not feed the security guards.',
  'The food court would like to remind you that the meat is probably meat.',
  'Attention: someone has stacked forty cereal boxes in aisle three. We are impressed.',
  'The arcade claw machine is not legally responsible for your feelings.',
  'Shoppers are reminded that throwing watermelons is frowned upon. But allowed.',
];

export const NAME_A = ['Sneaky', 'Turbo', 'Soggy', 'Mega', 'Crispy', 'Wobbly', 'Spicy', 'Lil', 'Captain', 'Funky', 'Sir', 'Chunky'];
export const NAME_B = ['Bagel', 'Pickle', 'Noodle', 'Taco', 'Waffle', 'Nugget', 'Gremlin', 'Muffin', 'Llama', 'Burrito', 'Goose', 'Potato'];
